import type { Message } from '@ujima/shared';
import {
  isCompactedConversation,
  isCompactedSelfNote,
  isArchivedConversation,
} from '../services/conversation-summary.js';

export function isTraceOnlyMessage(message: Message): boolean {
  return message.metadata?.traceOnly === true;
}

export function isCompactedSourceMessage(message: Message): boolean {
  if (message.metadata?.compactedInto) return true;
  if (isCompactedSelfNote(message) || isCompactedConversation(message)) return true;
  return isArchivedConversation(message) && message.content.includes('compactedInto=');
}

export function filterVisibleMessages(messages: Message[]): Message[] {
  return messages.filter((message) => !isTraceOnlyMessage(message) && !isCompactedSourceMessage(message));
}
