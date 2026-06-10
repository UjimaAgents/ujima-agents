import type { Message, MessageToolCall, RunStep } from '@ujima/shared';
import type { ModelMessage } from 'ai';
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
      if (call.toolCallId) ids.add(call.toolCallId);
    }
  }
  return ids;
}

export function runStepsToModelMessages(steps: readonly RunStep[]): ModelMessage[] {
  return steps.flatMap((step) => {
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
