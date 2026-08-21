import type { MessageToolCall } from '@ujima/shared';
import { extractReasoningChunk } from '../utils/extract-reasoning.js';
import { normalizeRunStepToolCalls } from '../utils/step-tool-calls.js';
import { appendArtifactFileToolCall } from './artifact-file-card.js';
import { appendGoalTaskToolCalls } from './goal-task-card.js';
import { appendScheduleToolCalls } from './schedule-card.js';
import { buildAgentMessage } from './message-factory.js';
import type { AgentLoopStep } from './agent-loop.js';
import { normalizeToDottedToolName, runUsedThreadPublishingTool, stepContainsSilentTerminator } from './run-reply-guard.js';

export interface StepPublicationTerminatorState {
  sawTerminatingTool: boolean;
}

export interface PrepareAgentStepPublicationInput {
  step: AgentLoopStep;
  teamRoot: string;
  reasoningFallback?: string;
  allowEmptyWithoutArtifact?: boolean;
  suppressSilentTerminatorText?: boolean;
  terminatorState?: StepPublicationTerminatorState;
  resolveRunStepArtifact?: (lastToolCallId?: string) => Promise<MessageToolCall | undefined>;
  isStepTerminated?: (step: AgentLoopStep) => boolean;
}

export interface PreparedAgentStepPublication {
  content: string;
  contentParts: string[];
  stepToolCalls: MessageToolCall[];
  cards: MessageToolCall[];
  artifact?: MessageToolCall;
  reasoningContent?: string;
  artifactPublished: boolean;
  stepText: string;
  toolCallCount: number;
}

export function composedStepToolCalls(prepared: PreparedAgentStepPublication): MessageToolCall[] {
  // Dedup: when a card wrapper exists for a raw tool call (e.g. card.schedule for schedule),
  // include only the card, not the raw tool call. The raw call's data is subsumed by the card.
  const cardToolNames = new Set(
    prepared.cards.map((c) => normalizeToDottedToolName(c.toolName).replace(/^card\./, '')),
  );
  const filteredStepCalls = prepared.stepToolCalls.filter(
    (call) => !cardToolNames.has(normalizeToDottedToolName(call.toolName)),
  );
  return [
    ...filteredStepCalls,
    ...prepared.cards,
    ...(prepared.artifact ? [prepared.artifact] : []),
  ];
}

/**
 * The single step→messages assembler used by every publication path
 * (spirit bubbles, direct-run live steps, final reply trace). Splits
 * content parts, gates tool calls and reasoning onto the last part,
 * and stamps the shared metadata. Callers only choose the transport.
 */
export function buildAgentStepMessages(input: {
  organizationId: string;
  threadId: string;
  channelId?: string;
  senderId: string;
  runId: string;
  prepared: PreparedAgentStepPublication;
  toolCalls: MessageToolCall[];
  metadata: Record<string, unknown>;
}): ReturnType<typeof buildAgentMessage>[] {
  const parts = input.prepared.contentParts.length > 0 ? input.prepared.contentParts : [input.prepared.content];
  return parts.map((content, partIndex) => {
    const isLastPart = partIndex === parts.length - 1;
    return buildAgentMessage({
      organizationId: input.organizationId,
      threadId: input.threadId,
      channelId: input.channelId,
      senderId: input.senderId,
      content,
      metadata: input.metadata,
      ...(isLastPart && input.toolCalls.length > 0 ? { toolCalls: input.toolCalls } : {}),
      ...(isLastPart && input.prepared.reasoningContent ? { reasoningContent: input.prepared.reasoningContent } : {}),
    });
  });
}

export async function prepareAgentStepPublication(
  input: PrepareAgentStepPublicationInput,
): Promise<PreparedAgentStepPublication | null> {
  const stepText = typeof input.step.text === 'string' ? input.step.text.trim() : '';
  const contentParts = stepTextParts(input.step);
  const contentItems = Array.isArray(input.step.content) ? input.step.content : [];
  const contentToolCalls = contentItems.filter(
    (part): part is { toolCallId?: string; toolName?: string; input?: unknown } => part?.type === 'tool-call',
  );
  const contentToolResults = contentItems.filter(
    (part): part is { toolCallId?: string; output?: unknown; result?: unknown } => part?.type === 'tool-result',
  );
  const stepToolCalls = [
    ...(Array.isArray(input.step.toolCalls) ? input.step.toolCalls : []),
    ...contentToolCalls,
  ];
  const stepToolResults = [
    ...(Array.isArray(input.step.toolResults) ? input.step.toolResults : []),
    ...contentToolResults,
  ];
  if (!stepText && stepToolCalls.length === 0) return null;

  let artifact: MessageToolCall | undefined;
  let cards: MessageToolCall[] = [];
  let hasScheduleCard = false;
  if (stepToolCalls.length > 0) {
    const goalCards = appendGoalTaskToolCalls(stepToolCalls, stepToolResults);
    const scheduleCards = appendScheduleToolCalls(stepToolCalls, stepToolResults);
    cards = [...goalCards, ...scheduleCards];
    hasScheduleCard = scheduleCards.length > 0;
    artifact = await appendArtifactFileToolCall(stepToolCalls, input.teamRoot, stepToolResults);
    if (!artifact && input.resolveRunStepArtifact) {
      artifact = await input.resolveRunStepArtifact(stepToolCalls.at(-1)?.toolCallId);
    }
  }

  const stepTerminatedRun = input.isStepTerminated
    ? input.isStepTerminated(input.step)
    : runUsedThreadPublishingTool({ steps: [input.step] });
  const terminatorState = input.terminatorState;
  if (terminatorState) {
    if (terminatorState.sawTerminatingTool || (stepTerminatedRun && !artifact && cards.length === 0)) {
      if (stepTerminatedRun) terminatorState.sawTerminatingTool = true;
      return null;
    }
    if (stepTerminatedRun) terminatorState.sawTerminatingTool = true;
  }

  if (input.suppressSilentTerminatorText && stepContainsSilentTerminator(input.step)) {
    return null;
  }

  if (!stepText && !artifact && cards.length === 0 && !input.allowEmptyWithoutArtifact) {
    return null;
  }

  const content =
    stepText ||
    (artifact ? 'Artifact updated.' : hasScheduleCard ? 'Schedule updated.' : cards.length > 0 ? 'Task board updated.' : '');
  const normalizedToolCalls = normalizeRunStepToolCalls(stepToolCalls, stepToolResults);
  const reasoningContent = extractReasoningChunk(input.step) ?? input.reasoningFallback;

  return {
    content,
    contentParts: contentParts.length > 0 ? contentParts : [content],
    stepToolCalls: normalizedToolCalls,
    cards,
    artifact,
    reasoningContent,
    artifactPublished: Boolean(artifact),
    stepText,
    toolCallCount: normalizedToolCalls.length,
  };
}

function stepTextParts(step: AgentLoopStep): string[] {
  const content = Array.isArray(step.content) ? step.content : [];
  const parts = content
    .filter((part): part is { type: string; text: string } =>
      part?.type === 'text' && typeof (part as { text?: unknown }).text === 'string',
    )
    .map((part) => part.text.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [];
}
