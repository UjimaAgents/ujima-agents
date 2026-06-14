import type { Message } from '@ujima/shared';
import { filterVisibleMessages } from './message-visibility.js';
import { isCompactionSummarySystemMessage } from '../services/conversation-summary.js';
import { sortByCreatedAt } from './message-sort.js';

export function selectPromptContextMessages(
  messages: Message[],
  recentCount?: number,
): Message[] {
  const visible = sortByCreatedAt(filterVisibleMessages(messages));
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const message = visible[index];
    if (message && isCompactionSummarySystemMessage(message)) {
      const recent = visible.slice(index + 1);
      return [
        message,
        ...(recentCount && recent.length > recentCount ? recent.slice(-recentCount) : recent),
      ];
    }
  }

  return recentCount && visible.length > recentCount ? visible.slice(-recentCount) : visible;
}
