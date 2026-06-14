import type { Message } from '@ujima/shared';
import { filterVisibleMessages } from './message-visibility.js';
import { isCompactionSummarySystemMessage } from '../services/conversation-summary.js';

export const PROMPT_CONTEXT_CHAR_BUDGET = 32_000;
export const PROMPT_MESSAGE_CHAR_LIMIT = 12_000;

export function selectPromptContextMessages(
  messages: Message[],
  recentCount = 20,
  charBudget = PROMPT_CONTEXT_CHAR_BUDGET,
): Message[] {
  const visible = filterVisibleMessages(messages);
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const message = visible[index];
    if (message && isCompactionSummarySystemMessage(message)) {
      const recent = visible.slice(index + 1);
      return fitPromptBudget([
        message,
        ...(recent.length > recentCount ? recent.slice(-recentCount) : recent),
      ], charBudget);
    }
  }

  return fitPromptBudget(
    visible.length > recentCount ? visible.slice(-recentCount) : visible,
    charBudget,
  );
}

function fitPromptBudget(messages: Message[], charBudget: number): Message[] {
  const compacted = messages.map(limitMessageContent);
  const summary = compacted[0]?.kind === 'system' ? compacted[0] : undefined;
  const recent = summary ? compacted.slice(1) : compacted;
  const selected: Message[] = [];
  let used = summary?.content.length ?? 0;

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    if (!message) continue;
    if (selected.length > 0 && used + message.content.length > charBudget) {
      break;
    }
    selected.unshift(message);
    used += message.content.length;
  }

  return summary ? [summary, ...selected] : selected;
}

function limitMessageContent(message: Message): Message {
  if (message.content.length <= PROMPT_MESSAGE_CHAR_LIMIT) return message;
  const side = Math.floor((PROMPT_MESSAGE_CHAR_LIMIT - 80) / 2);
  return {
    ...message,
    content: [
      message.content.slice(0, side),
      '\n\n[Earlier message truncated for prompt size]\n\n',
      message.content.slice(-side),
    ].join(''),
  };
}
