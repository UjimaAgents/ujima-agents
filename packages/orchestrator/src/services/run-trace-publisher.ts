import { randomUUID } from 'node:crypto';
import { type MessageToolCall, type RunState } from '@ujima/shared';
import type { AiService } from '../ai-service.js';
import { extractReasoningChunk } from '../utils/extract-reasoning.js';
import type { ConversationService } from './conversation.js';
import { appendArtifactFileToolCall, buildArtifactFileMessage } from './artifact-file-card.js';
import { buildAgentMessage } from './message-factory.js';
import type { ApiRepository } from './repository-reader.js';
import {
  findTerminatingTool,
  findTerminatingToolFromRunSteps,
  runUsedThreadPublishingTool,
} from './run-reply-guard.js';
import { isToolCardError } from './spirit-run-detail.js';
import { hasTokenUsage, normalizeTokenUsage } from './token-usage.js';

export type RunReplyResult = Awaited<ReturnType<AiService['generateRunReply']>>;
export interface StreamedRunTrace {
  text: string;
  reasoning: string;
}
export type StreamedTraceOutcome = 'failed' | 'stopped';
type ArtifactFileToolCallLike = Parameters<typeof appendArtifactFileToolCall>[0][number];
interface RunStepToolCall {
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
}

interface RunStepToolResult {
  toolCallId?: string;
  output?: unknown;
}

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

export function normalizeRunStepToolCalls(
  stepToolCalls: readonly RunStepToolCall[],
  stepToolResults: readonly RunStepToolResult[],
): MessageToolCall[] {
  const resultsById = new Map<string, unknown>();
  for (const result of stepToolResults) {
    if (typeof result.toolCallId === 'string') resultsById.set(result.toolCallId, result.output);
  }
  return stepToolCalls.map((call) => {
    const toolCallId = call.toolCallId ?? randomUUID();
    const result = resultsById.get(toolCallId);
    return {
      toolCallId,
      toolName: call.toolName ?? 'unknown',
      args: call.input && typeof call.input === 'object' ? (call.input as Record<string, unknown>) : {},
      ...(result !== undefined ? { result } : {}),
      isError: isToolCardError(result),
    };
  });
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
  const publishOptions = input.suppressDmAlerts ? { suppressDmAlerts: true } : undefined;
  const metadata = input.failureTrace
    ? { runId: input.run.id, failedTrace: true }
    : { runId: input.run.id };
  const usage = normalizeTokenUsage(input.result.usage);
  let publishedArtifactFile = input.publishedArtifactFile ?? false;
  const publishedContent = input.publishedContent ?? new Set<string>();
  let publishedAnyText = input.publishedAnyText ?? false;

  for (const [index, step] of input.result.steps.entries()) {
    const stepText = typeof step.text === 'string' ? step.text.trim() : '';
    const stepToolCalls = Array.isArray(step.toolCalls) ? (step.toolCalls as RunStepToolCall[]) : [];
    const stepToolResults = Array.isArray(step.toolResults) ? step.toolResults : [];
    if (!stepText && stepToolCalls.length === 0) continue;

    const stepArtifactFileToolCall =
      stepToolCalls.length > 0
        ? (await appendArtifactFileToolCall(stepToolCalls, input.teamRoot, stepToolResults)) ??
          (await appendArtifactFileFromRunSteps(
            input.repo,
            input.run,
            input.teamRoot,
            stepToolCalls.at(-1)?.toolCallId,
          ))
        : undefined;
    if (stepArtifactFileToolCall) publishedArtifactFile = true;

    if (runUsedThreadPublishingTool({ steps: [step] }) && !stepArtifactFileToolCall) continue;
    if (!stepText && !stepArtifactFileToolCall && !input.failureTrace) continue;

    if (stepText) {
      publishedAnyText = true;
    }

    const content = stepText || (stepArtifactFileToolCall ? 'Artifact updated.' : 'Tool actions recorded.');
    const toolCalls = [
      ...normalizeRunStepToolCalls(stepToolCalls, stepToolResults),
      ...(stepArtifactFileToolCall ? [stepArtifactFileToolCall] : []),
    ];
    const stepReasoning =
      extractReasoningChunk(step) ??
      (index === input.result.steps.length - 1 ? input.reasoningContent : undefined);
    const attachTokens = index === input.result.steps.length - 1 && hasTokenUsage(usage);

    input.conversations?.publishMessage(
      buildAgentMessage({
        organizationId: input.run.organizationId,
        threadId,
        channelId,
        senderId: input.run.agentId,
        content,
        metadata,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(stepReasoning ? { reasoningContent: stepReasoning } : {}),
        ...(attachTokens ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : {}),
      }),
      undefined,
      undefined,
      publishOptions,
    );
    publishedContent.add(content);
  }

  const runSteps = input.repo.listRunSteps?.(input.run.organizationId, input.run.id) ?? [];
  const terminatingTool = findTerminatingTool(input.result) ?? findTerminatingToolFromRunSteps(runSteps);
  const usedTerminator = terminatingTool !== null;
  const finalArtifactMessageNeeded = !!input.artifactFileToolCall && !publishedArtifactFile;

  if (
    input.reply.length > 0 &&
    !publishedAnyText &&
    !usedTerminator &&
    !finalArtifactMessageNeeded &&
    !publishedContent.has(input.reply)
  ) {
    input.conversations?.publishMessage(
      buildAgentMessage({
        organizationId: input.run.organizationId,
        threadId,
        channelId,
        senderId: input.run.agentId,
        content: input.reply,
        metadata,
        ...(input.reasoningContent ? { reasoningContent: input.reasoningContent } : {}),
        ...(hasTokenUsage(usage) ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : {}),
      }),
      undefined,
      undefined,
      publishOptions,
    );
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
