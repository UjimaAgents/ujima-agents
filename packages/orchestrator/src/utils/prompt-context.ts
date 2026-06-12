import type { Message } from '@ujima/shared';
import { filterVisibleMessages } from './message-visibility.js';
import { isCompactionSummarySystemMessage } from '../services/conversation-summary.js';

export function selectPromptContextMessages(messages: Message[], recentCount = 20): Message[] {
  const visible = filterVisibleMessages(messages);
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const message = visible[index];
    if (message && isCompactionSummarySystemMessage(message)) {
      const recent = visible.slice(index + 1);
      return recent.length > recentCount ? [message, ...recent.slice(-recentCount)] : [message, ...recent];
    }
  }

  return visible.length > recentCount ? visible.slice(-recentCount) : visible;
}
