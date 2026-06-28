import type { ModelMessage } from 'ai';
import type { Message, RunStep } from '@ujima/shared';
import { sortByCreatedAt } from './message-sort.js';
import { toModelMessages } from './to-model-messages.js';
import { completedRunSteps, extractToolCallIdsFromMessages, runStepsToModelMessages } from './run-transcript.js';

export function buildPromptMessages(input: {
  historyMessages: readonly Message[];
  currentMemberId: string;
  runSteps?: readonly RunStep[];
  contextMessages?: readonly ModelMessage[];
  currentRequestMessage?: Message | null;
  currentRequest?: ModelMessage;
  includeReasoning?: boolean;
}): ModelMessage[] {
  const knownToolCallIds = extractToolCallIdsFromMessages(input.historyMessages);
  const timeline = [
    ...input.historyMessages.map((message) => ({
      createdAt: message.createdAt,
      id: message.id,
      messages: toModelMessages([message], input.currentMemberId, {
        includeReasoning: input.includeReasoning,
      }),
    })),
    ...sortByCreatedAt(
      completedRunSteps(input.runSteps ?? [])
        .filter((step) => !knownToolCallIds.has(step.toolCallId))
        .map((step) => ({
          createdAt: step.createdAt,
          id: step.id,
          messages: runStepsToModelMessages([step]),
        })),
    ),
  ].sort((left, right) => {
    const byTime = left.createdAt.localeCompare(right.createdAt);
    return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
  });

  const out = timeline.flatMap((entry) => entry.messages);
  if (input.currentRequestMessage) {
    out.push(
      ...toModelMessages([input.currentRequestMessage], input.currentMemberId, {
        includeReasoning: input.includeReasoning,
      }),
    );
  } else if (input.currentRequest) {
    out.push(input.currentRequest);
  }
  // Runtime context is not persisted. Keep it at the tail so prior user,
  // assistant, tool-call, and tool-result bytes stay in the same prefix on
  // the next wake.
  if (input.contextMessages?.length) out.push(...input.contextMessages);
  return out;
}
