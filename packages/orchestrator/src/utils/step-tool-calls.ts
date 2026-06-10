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
}

export function normalizeRunStepToolCalls(
  stepToolCalls: readonly RunStepToolCallLike[],
  stepToolResults: readonly RunStepToolResultLike[],
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
