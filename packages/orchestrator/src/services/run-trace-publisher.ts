import { type MessageToolCall, type RunState } from '@ujima/shared';
import type { ConversationService, PublishMessageOptions } from './conversation.js';
import { appendArtifactFileToolCall, buildArtifactFileMessage } from './artifact-file-card.js';
import { buildAgentMessage } from './message-factory.js';
import type { ApiRepository } from './repository-reader.js';
import { findTerminatingTool, findTerminatingToolFromRunSteps, normalizeToDottedToolName } from './run-reply-guard.js';
import type { runAgentLoop } from './agent-loop.js';
import { stepPausesRun } from './agent-loop.js';
import { normalizeTokenUsage, persistMessageTokens } from './token-usage.js';
import { composedStepToolCalls, prepareAgentStepPublication } from './agent-step-publish.js';

export { normalizeRunStepToolCalls } from '../utils/step-tool-calls.js';

export type RunReplyResult = Awaited<ReturnType<typeof runAgentLoop>>;
export interface StreamedRunTrace {
  text: string;
  reasoning: string;
}
export type StreamedTraceOutcome = 'failed' | 'stopped';
type ArtifactFileToolCallLike = Parameters<typeof appendArtifactFileToolCall>[0][number];
const WAKEABLE_AGENT_DM_TERMINATORS = new Set(['message', 'channel.reply', 'channel.post', 'channel.handoff']);

export function collectToolStatuses(result: Pick<RunReplyResult, 'toolResults' | 'steps'>): string[] {
  return [
    ...result.toolResults,
    ...result.steps.flatMap((step) => step?.toolResults ?? []),
  ]
    .map((toolResult) => (toolResult?.output as { status?: string } | undefined)?.status)
    .filter((status): status is string => typeof status === 'string');
}

export function collectRunStepToolCalls(result: Pick<RunReplyResult, 'steps'>): ArtifactFileToolCallLike[] {
  return result.steps.flatMap((step) =>
    Array.isArray(step.toolCalls) ? (step.toolCalls as ArtifactFileToolCallLike[]) : [],
  );
}

export function collectRunStepToolResults(result: Pick<RunReplyResult, 'steps'>): NonNullable<RunReplyResult['steps'][number]>['toolResults'] {
  return result.steps.flatMap((step) => (Array.isArray(step.toolResults) ? step.toolResults : []));
}

export async function appendArtifactFileFromRunSteps(
  repo: ApiRepository,
  run: RunState,
  workspaceRoot: string,
  toolCallId?: string,
): Promise<MessageToolCall | undefined> {
  const runSteps = repo.listRunSteps?.(run.organizationId, run.id) ?? [];
  const steps = toolCallId ? runSteps.filter((step) => step.toolCallId === toolCallId) : runSteps;
  return appendArtifactFileToolCall(
    steps.map((step) => ({
      toolCallId: step.toolCallId,
      toolName: step.toolId,
      input: {
        action: step.action,
        resourcePath: step.resourcePath,
        ...step.input,
      },
    })),
    workspaceRoot,
  );
}

export async function publishRunReplyTrace(input: {
  repo: ApiRepository;
  conversations?: ConversationService;
  run: RunState;
  result: Pick<RunReplyResult, 'steps' | 'toolResults' | 'usage'>;
  reply: string;
  reasoningContent?: string;
  teamRoot: string;
  artifactFileToolCall?: MessageToolCall;
  publishedArtifactFile?: boolean;
  publishedContent?: Set<string>;
  publishedAnyText?: boolean;

  suppressDmAlerts?: boolean;
  failureTrace?: boolean;
}): Promise<void> {
  const threadId = input.run.threadId;
  if (!threadId) return;

  const channelId = input.repo.getThread(input.run.organizationId, threadId)?.channelId;
  const publishOptions: PublishMessageOptions | undefined = input.suppressDmAlerts ? { suppressDmAlerts: true } : undefined;
  const baseMetadata = input.failureTrace
    ? { runId: input.run.id, failedTrace: true }
    : { runId: input.run.id };
  const usage = normalizeTokenUsage(input.result.usage);
  let publishedArtifactFile = input.publishedArtifactFile ?? false;
  const publishedContent = input.publishedContent ?? new Set<string>();
  let publishedAnyText = input.publishedAnyText ?? false;
  const runSteps = input.repo.listRunSteps?.(input.run.organizationId, input.run.id) ?? [];
  const terminatingTool = findTerminatingTool(input.result) ?? findTerminatingToolFromRunSteps(runSteps);
  let sawTerminatingTool = findTerminatingToolFromRunSteps(runSteps) !== null;

  const terminatorState = { sawTerminatingTool };
  for (const [index, step] of input.result.steps.entries()) {
    if (stepPausesRun(step)) continue;

    const prepared = await prepareAgentStepPublication({
      step,
      teamRoot: input.teamRoot,
      allowEmptyWithoutArtifact: input.failureTrace,
      terminatorState,
      reasoningFallback:
        index === input.result.steps.length - 1 ? input.reasoningContent : undefined,
      resolveRunStepArtifact: (toolCallId) =>
        appendArtifactFileFromRunSteps(input.repo, input.run, input.teamRoot, toolCallId),
    });
    sawTerminatingTool = terminatorState.sawTerminatingTool;
    if (!prepared) continue;

    if (prepared.artifactPublished) publishedArtifactFile = true;
    if (prepared.stepText) publishedAnyText = true;

    const isLastStep = index === input.result.steps.length - 1;
    const toolCalls = composedStepToolCalls(prepared);
    const hasWakeableTerminator = toolCalls.some((call) =>
      WAKEABLE_AGENT_DM_TERMINATORS.has(normalizeToDottedToolName(call.toolName)),
    );
    const metadata =
      hasWakeableTerminator || (isLastStep && toolCalls.length === 0 && !terminatingTool)
        ? baseMetadata
        : { ...baseMetadata, runProgress: true };
    const stepPublishOptions: PublishMessageOptions | undefined =
      metadata === baseMetadata ? publishOptions : { ...publishOptions, wakePolicy: 'never' };
    const parts = prepared.contentParts.length > 0 ? prepared.contentParts : [prepared.content];
    let lastPublished: ReturnType<ConversationService['publishMessage']> | undefined;
    for (const [partIndex, content] of parts.entries()) {
      const isLastPart = partIndex === parts.length - 1;
      lastPublished = input.conversations?.publishMessage(buildAgentMessage({
        organizationId: input.run.organizationId,
        threadId,
        channelId,
        senderId: input.run.agentId,
        content,
        metadata,
        ...(isLastPart && toolCalls.length > 0 ? { toolCalls } : {}),
        ...(isLastPart && prepared.reasoningContent ? { reasoningContent: prepared.reasoningContent } : {}),
      }), undefined, undefined, stepPublishOptions);
      publishedContent.add(content);
    }
    if (isLastStep && lastPublished) {
      persistMessageTokens(input.repo, lastPublished, usage);
    }
  }

  const usedTerminator = terminatingTool !== null;
  const finalArtifactMessageNeeded = !!input.artifactFileToolCall && !publishedArtifactFile;

  if (
    input.reply.length > 0 &&
    !publishedAnyText &&
    !usedTerminator &&
    !finalArtifactMessageNeeded &&
    !publishedContent.has(input.reply)
  ) {
    const published = input.conversations?.publishMessage(
      buildAgentMessage({
        organizationId: input.run.organizationId,
        threadId,
        channelId,
        senderId: input.run.agentId,
        content: input.reply,
        metadata: baseMetadata,
        ...(input.reasoningContent ? { reasoningContent: input.reasoningContent } : {}),
      }),
      undefined,
      undefined,
      publishOptions,
    );
    if (published) {
      persistMessageTokens(input.repo, published, usage);
    }
  }

  if (finalArtifactMessageNeeded && input.artifactFileToolCall) {
    input.conversations?.publishMessage(
      buildArtifactFileMessage({
        artifactFileToolCall: input.artifactFileToolCall,
        organizationId: input.run.organizationId,
        threadId,
        channelId,
        senderId: input.run.agentId,
        runId: input.run.id,
        content: input.reply,
      }),
      undefined,
      undefined,
      publishOptions,
    );
  }
}

export function publishStreamedTrace(input: {
  repo: ApiRepository;
  conversations?: ConversationService;
  run: RunState;
  trace: StreamedRunTrace;
  outcome: StreamedTraceOutcome;
}): void {
  const reply = input.trace.text.trim();
  const reasoningContent = input.trace.reasoning.trim() || undefined;
  if (!reply && !reasoningContent) return;
  const threadId = input.run.threadId;
  if (!threadId) return;
  const channelId = input.repo.getThread(input.run.organizationId, threadId)?.channelId;
  input.conversations?.publishMessage(
    buildAgentMessage({
      organizationId: input.run.organizationId,
      threadId,
      channelId,
      senderId: input.run.agentId,
      content:
        reply ||
        (input.outcome === 'failed'
          ? 'Run failed before producing a reply.'
          : 'Run stopped before producing a reply.'),
      metadata:
        input.outcome === 'failed'
          ? { runId: input.run.id, failedTrace: true }
          : { runId: input.run.id, stoppedTrace: true },
      ...(reasoningContent ? { reasoningContent } : {}),
    }),
    undefined,
    undefined,
    { suppressDmAlerts: true },
  );
}
