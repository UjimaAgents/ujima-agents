import { randomUUID } from 'node:crypto';
import { AGENT_KIND, MessageSchema, type MessageToolCall, type RunState } from '@ujima/shared';
import type { AiService } from '../ai-service.js';
import { extractReasoningChunk } from '../utils/extract-reasoning.js';
import type { ConversationService } from './conversation.js';
import { appendGoalArtifactToolCall, buildGoalArtifactMessage } from './goal-artifact-card.js';
import type { ApiRepository } from './repository-reader.js';
import { runUsedThreadPublishingTool } from './run-reply-guard.js';

export type RunReplyResult = Awaited<ReturnType<AiService['generateRunReply']>>;
export interface StreamedRunTrace {
  text: string;
  reasoning: string;
}
export type StreamedTraceOutcome = 'failed' | 'stopped';
type GoalArtifactToolCallLike = Parameters<typeof appendGoalArtifactToolCall>[0][number];

export function collectToolStatuses(result: Pick<RunReplyResult, 'toolResults' | 'steps'>): string[] {
  return [
    ...result.toolResults,
    ...result.steps.flatMap((step) => step?.toolResults ?? []),
  ]
    .map((toolResult) => (toolResult?.output as { status?: string } | undefined)?.status)
    .filter((status): status is string => typeof status === 'string');
}

export function collectRunStepToolCalls(result: Pick<RunReplyResult, 'steps'>): GoalArtifactToolCallLike[] {
  return result.steps.flatMap((step) =>
    Array.isArray(step.toolCalls) ? (step.toolCalls as GoalArtifactToolCallLike[]) : [],
  );
}

export async function appendGoalArtifactFromRunSteps(
  repo: ApiRepository,
  run: RunState,
  workspaceRoot: string,
  toolCallId?: string,
): Promise<MessageToolCall | undefined> {
  const runSteps = repo.listRunSteps?.(run.organizationId, run.id) ?? [];
  const steps = toolCallId ? runSteps.filter((step) => step.toolCallId === toolCallId) : runSteps;
  return appendGoalArtifactToolCall(
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
  result: Pick<RunReplyResult, 'steps'>;
  reply: string;
  reasoningContent?: string;
  teamRoot: string;
  goalArtifactToolCall?: MessageToolCall;
  skipFinalThreadMessage?: boolean;
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
  let publishedMessages = 0;
  let publishedGoalArtifact = false;
  let lastPublishedContent: string | undefined;

  for (const [index, step] of input.result.steps.entries()) {
    const stepText = typeof step.text === 'string' ? step.text.trim() : '';
    const stepToolCalls = Array.isArray(step.toolCalls) ? (step.toolCalls as MessageToolCall[]) : [];
    if (!stepText && stepToolCalls.length === 0) continue;

    const stepGoalArtifactToolCall =
      stepToolCalls.length > 0
        ? (await appendGoalArtifactToolCall(stepToolCalls, input.teamRoot)) ??
          (await appendGoalArtifactFromRunSteps(
            input.repo,
            input.run,
            input.teamRoot,
            stepToolCalls.at(-1)?.toolCallId,
          ))
        : undefined;
    if (stepGoalArtifactToolCall) publishedGoalArtifact = true;

    if (runUsedThreadPublishingTool({ steps: [step] }) && !stepGoalArtifactToolCall) continue;
    if (!stepText && !stepGoalArtifactToolCall && !input.failureTrace) continue;

    const content = stepText || (stepGoalArtifactToolCall ? 'Goal artifact updated.' : 'Tool actions recorded.');
    const toolCalls = [...stepToolCalls, ...(stepGoalArtifactToolCall ? [stepGoalArtifactToolCall] : [])];
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
    publishedMessages += 1;
    lastPublishedContent = content;
  }

  const finalArtifactMessageNeeded = !!input.goalArtifactToolCall && !publishedGoalArtifact;
  const shouldPublishFinalMessage =
    input.reply.length > 0 &&
    !input.skipFinalThreadMessage &&
    (publishedMessages === 0 || input.reply !== lastPublishedContent || finalArtifactMessageNeeded);

  if (shouldPublishFinalMessage) {
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

  if (finalArtifactMessageNeeded && input.goalArtifactToolCall) {
    input.conversations?.publishMessage(
      buildGoalArtifactMessage({
        goalArtifactToolCall: input.goalArtifactToolCall,
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
