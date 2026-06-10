import type { Message } from '@ujima/shared';
import { sortByCreatedAt } from './message-sort.js';

export interface MessageCursor {
  createdAt: string;
  id: string;
}

export function createMessageCursor(messages: Message[]): MessageCursor {
  const sorted = sortByCreatedAt(messages);
  const latest = sorted[sorted.length - 1];
  return latest
    ? { createdAt: latest.createdAt, id: latest.id }
    : { createdAt: '', id: '' };
}

function isMessageAfterCursor(message: Message, cursor: MessageCursor): boolean {
  if (message.createdAt > cursor.createdAt) return true;
  return message.createdAt === cursor.createdAt && message.id > cursor.id;
}

export function collectInterruptMessages(
  messages: Message[],
  cursor: MessageCursor,
  selfId: string,
): Message[] {
  const sorted = sortByCreatedAt(messages);
  const interrupts = sorted.filter(
    (message) =>
      message.senderId !== selfId && isMessageAfterCursor(message, cursor),
  );
  const latest = sorted[sorted.length - 1];
  if (latest) {
    moveCursor(cursor, latest);
  }
  return interrupts;
}

function moveCursor(cursor: MessageCursor, message: Message): void {
  if (isMessageAfterCursor(message, cursor)) {
    cursor.createdAt = message.createdAt;
    cursor.id = message.id;
  }
}
