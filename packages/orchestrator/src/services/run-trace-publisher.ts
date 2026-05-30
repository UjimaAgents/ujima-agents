import { randomUUID } from 'node:crypto';
import { AGENT_KIND, MessageSchema, type MessageToolCall, type RunState } from '@ujima/shared';
import type { AiService } from '../ai-service.js';
import { extractReasoningChunk } from '../utils/extract-reasoning.js';
import type { ConversationService } from './conversation.js';
import { appendArtifactFileToolCall, buildArtifactFileMessage } from './artifact-file-card.js';
import type { ApiRepository } from './repository-reader.js';
import {
  findTerminatingTool,
  findTerminatingToolFromRunSteps,
  runUsedThreadPublishingTool,
} from './run-reply-guard.js';

export type RunReplyResult = Awaited<ReturnType<AiService['generateRunReply']>>;
export interface StreamedRunTrace {
  text: string;
  reasoning: string;
}
export type StreamedTraceOutcome = 'failed' | 'stopped';
type ArtifactFileToolCallLike = Parameters<typeof appendArtifactFileToolCall>[0][number];

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
  result: Pick<RunReplyResult, 'steps' | 'toolResults'>;
  reply: string;
  reasoningContent?: string;
  teamRoot: string;
  artifactFileToolCall?: MessageToolCall;

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
  let publishedArtifactFile = false;
  let publishedMessages = 0;

  for (const [index, step] of input.result.steps.entries()) {
    const stepText = typeof step.text === 'string' ? step.text.trim() : '';
    const stepToolCalls = Array.isArray(step.toolCalls) ? (step.toolCalls as MessageToolCall[]) : [];
    if (!stepText && stepToolCalls.length === 0) continue;

    const stepArtifactFileToolCall =
      stepToolCalls.length > 0
        ? (await appendArtifactFileToolCall(stepToolCalls, input.teamRoot)) ??
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

    const content = stepText || (stepArtifactFileToolCall ? 'Artifact updated.' : 'Tool actions recorded.');
    const toolCalls = [...stepToolCalls, ...(stepArtifactFileToolCall ? [stepArtifactFileToolCall] : [])];
    const stepReasoning =
      extractReasoningChunk(step) ??
      (index === input.result.steps.length - 1 ? input.reasoningContent : undefined);

    input.conversations?.publishMessage(
      MessageSchema.parse({
        id: randomUUID(),
        organizationId: input.run.organizationId,
        threadId,
        ...(channelId ? { channelId } : {}),
        senderId: input.run.agentId,
        senderKind: AGENT_KIND,
        kind: AGENT_KIND,
        content,
        metadata,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(stepReasoning ? { reasoningContent: stepReasoning } : {}),
        createdAt: new Date().toISOString(),
      }),
      undefined,
      undefined,
      publishOptions,
    );
    publishedMessages++;
  }

  // Fallback: if the per-step loop published nothing (e.g. the AI
  // returned text with zero steps) and we have reply text, publish a
  // single message so the reply is visible in the thread.
  // Do not publish if a terminating/thread-publishing tool was fired.
  const runSteps = input.repo.listRunSteps?.(input.run.organizationId, input.run.id) ?? [];
  const terminatingTool = findTerminatingTool(input.result) ?? findTerminatingToolFromRunSteps(runSteps);
  const usedTerminator = terminatingTool !== null;
  if (publishedMessages === 0 && input.reply.length > 0 && !usedTerminator) {
    input.conversations?.publishMessage(
      MessageSchema.parse({
        id: randomUUID(),
        organizationId: input.run.organizationId,
        threadId,
        ...(channelId ? { channelId } : {}),
        senderId: input.run.agentId,
        senderKind: AGENT_KIND,
        kind: AGENT_KIND,
        content: input.reply,
        metadata,
        ...(input.reasoningContent ? { reasoningContent: input.reasoningContent } : {}),
        createdAt: new Date().toISOString(),
      }),
      undefined,
      undefined,
      publishOptions,
    );
  }


  const finalArtifactMessageNeeded = !!input.artifactFileToolCall && !publishedArtifactFile;
  if (finalArtifactMessageNeeded && input.artifactFileToolCall) {
    input.conversations?.publishMessage(
      buildArtifactFileMessage({
        artifactFileToolCall: input.artifactFileToolCall,
        organizationId: input.run.organizationId,
        threadId,
        channelId,
        senderId: input.run.agentId,
        senderKind: AGENT_KIND,
        kind: AGENT_KIND,
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
    MessageSchema.parse({
      id: randomUUID(),
      organizationId: input.run.organizationId,
      threadId,
      ...(channelId ? { channelId } : {}),
      senderId: input.run.agentId,
      senderKind: AGENT_KIND,
      kind: AGENT_KIND,
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
      createdAt: new Date().toISOString(),
    }),
    undefined,
    undefined,
    { suppressDmAlerts: true },
  );
}
