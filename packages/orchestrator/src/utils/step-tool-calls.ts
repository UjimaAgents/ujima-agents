import { randomUUID } from 'node:crypto';
import type { MessageCard, MessageToolCall } from '@ujima/shared';
import { isToolCardError } from '../services/spirit-run-detail.js';

export interface RunStepToolCallLike {
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
}

export interface RunStepToolResultLike {
  toolCallId?: string;
  output?: unknown;
  result?: unknown;
}

export function normalizeRunStepToolCalls(
  stepToolCalls: readonly RunStepToolCallLike[],
  stepToolResults: readonly RunStepToolResultLike[],
): MessageToolCall[] {
  const resultsById = new Map<string, unknown>();
  for (const result of stepToolResults) {
    if (typeof result.toolCallId === 'string') resultsById.set(result.toolCallId, toolResultPayload(result));
  }
  return stepToolCalls.map((call) => {
    const toolCallId = call.toolCallId ?? randomUUID();
    const result = resultsById.get(toolCallId);
    return {
      toolCallId,
      toolName: call.toolName ?? 'unknown',
      args: toolCallArgs(call.input),
      ...(result !== undefined ? { result } : {}),
      isError: isToolCardError(result),
    };
  });
}

function toolResultPayload(result: RunStepToolResultLike): unknown {
  return Object.prototype.hasOwnProperty.call(result, 'output') ? result.output : result.result;
}

function toolCallArgs(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input as Record<string, unknown>;
  if (typeof input !== 'string' || !input.trim()) return {};
  try {
    const parsed = JSON.parse(input) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function wrapToolCallsAsCards(
  calls: readonly MessageToolCall[],
  ctx: { taskSessionId?: string; runId?: string },
): MessageToolCall[] {
  return calls.map((call) => {
    const card: MessageCard = {
      kind: 'tool.call',
      cardId: randomUUID(),
      taskSessionId: ctx.taskSessionId,
      runId: ctx.runId,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      args: call.args,
      result: call.result,
      isError: call.isError,
    };
    return {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      args: call.args,
      result: card,
      isError: call.isError,
    };
  });
}
