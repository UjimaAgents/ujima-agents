import type { Message, MessageToolCall, RunStep } from '@ujima/shared';
import type { AssistantContent, ModelMessage, ToolContent } from 'ai';
import { toModelToolName } from '../tools/names.js';
import { sortByCreatedAt } from './message-sort.js';
import {
  buildAssistantToolRoundMessages,
  resolveToolCallPayload,
  type ToolRoundCall,
} from './model-tool-round.js';

export { resolveToolCallPayload, toToolResultOutput } from './model-tool-round.js';

/**
 * Append structured assistant/tool pairs for in-flight run steps that are
 * not already represented in persisted thread messages (e.g. tool-only
 * steps that never published a channel bubble).
 */
export function appendMissingRunStepMessages(
  messages: ModelMessage[],
  threadMessages: readonly Message[],
  steps: readonly RunStep[],
): void {
  if (!steps.length) return;
  const knownIds = extractToolCallIdsFromMessages(threadMessages);
  const missing = sortByCreatedAt(
    steps.filter((step) => !knownIds.has(step.toolCallId)),
  );
  if (!missing.length) return;
  messages.push(...runStepsToModelMessages(missing));
}

export function extractToolCallIdsFromMessages(messages: readonly Message[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const call of message.toolCalls) {
      if (call.toolCallId && call.result !== undefined) ids.add(call.toolCallId);
    }
  }
  return ids;
}

export function runStepsToModelMessages(steps: readonly RunStep[]): ModelMessage[] {
  return steps.filter((step) => step.output !== undefined).flatMap((step) => {
    const call: ToolRoundCall = {
      toolCallId: step.toolCallId,
      toolName: toModelToolName(step.toolId),
      args: step.input,
      result: step.output,
      isError: step.status !== 'ok',
    };
    return buildAssistantToolRoundMessages({
      toolCalls: [call],
      splitPerCall: true,
    });
  });
}

export function messageToolCallsToModelMessages(
  text: string | undefined,
  reasoning: string | undefined,
  toolCalls: readonly MessageToolCall[],
): ModelMessage[] {
  const resolved = toolCalls.map((call) => {
    const payload = resolveToolCallPayload(call);
    return {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      args: payload.args,
      result: payload.result,
      isError: payload.isError,
    };
  });
  return buildAssistantToolRoundMessages({
    text,
    reasoning,
    toolCalls: resolved,
  });
}

export function sanitizeModelMessages(messages: readonly ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  let pendingToolCallIds = new Set<string>();

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === 'assistant') {
      const sanitized = sanitizeAssistantMessage(message, toolResultIdsFor(messages[index + 1]));
      pendingToolCallIds = sanitized ? toolCallIdsFor(sanitized.content) : new Set<string>();
      if (sanitized) out.push(sanitized);
      continue;
    }

    if (message.role === 'tool') {
      const sanitized = sanitizeToolMessage(message, pendingToolCallIds);
      pendingToolCallIds = new Set<string>();
      if (sanitized) out.push(sanitized);
      continue;
    }

    pendingToolCallIds = new Set<string>();
    out.push(message);
  }

  return out;
}

function sanitizeAssistantMessage(
  message: Extract<ModelMessage, { role: 'assistant' }>,
  nextToolResultIds: Set<string>,
): Extract<ModelMessage, { role: 'assistant' }> | null {
  if (!Array.isArray(message.content)) return message;
  const content: AssistantContent = [];
  let changed = false;
  for (const part of message.content) {
    if (isToolCallPart(part) && !nextToolResultIds.has(part.toolCallId)) {
      changed = true;
      continue;
    }
    content.push(part);
  }
  if (!changed) return message;
  if (content.length === 0) return null;
  return { ...message, content };
}

function sanitizeToolMessage(
  message: Extract<ModelMessage, { role: 'tool' }>,
  pendingToolCallIds: Set<string>,
): Extract<ModelMessage, { role: 'tool' }> | null {
  if (!Array.isArray(message.content)) return null;
  if (pendingToolCallIds.size === 0) return null;
  const content: ToolContent = [];
  for (const part of message.content) {
    if (isToolResultPart(part) && pendingToolCallIds.has(part.toolCallId)) {
      content.push(part);
    }
  }
  if (content.length === 0) return null;
  return { ...message, content };
}

function toolCallIdsFor(content: AssistantContent | string): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(content)) return ids;
  for (const part of content) {
    if (isToolCallPart(part)) {
      ids.add(part.toolCallId);
    }
  }
  return ids;
}

function toolResultIdsFor(message: ModelMessage | undefined): Set<string> {
  const ids = new Set<string>();
  if (!message || message.role !== 'tool' || !Array.isArray(message.content)) return ids;
  for (const part of message.content) {
    if (isToolResultPart(part)) {
      ids.add(part.toolCallId);
    }
  }
  return ids;
}

function isToolCallPart(part: unknown): part is { type: 'tool-call'; toolCallId: string } {
  return (
    typeof part === 'object' &&
    part !== null &&
    (part as { type?: unknown }).type === 'tool-call' &&
    typeof (part as { toolCallId?: unknown }).toolCallId === 'string'
  );
}

function isToolResultPart(part: unknown): part is { type: 'tool-result'; toolCallId: string } {
  return (
    typeof part === 'object' &&
    part !== null &&
    (part as { type?: unknown }).type === 'tool-result' &&
    typeof (part as { toolCallId?: unknown }).toolCallId === 'string'
  );
}
