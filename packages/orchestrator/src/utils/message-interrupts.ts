import type { Message } from '@ujima/shared';

export interface MessageCursor {
  createdAt: string;
  id: string;
}

export function createMessageCursor(messages: Message[]): MessageCursor {
  const latest = messages[messages.length - 1];
  return latest ? { createdAt: latest.createdAt, id: latest.id } : { createdAt: '', id: '' };
}

export function isMessageAfterCursor(message: Message, cursor: MessageCursor): boolean {
  if (message.createdAt > cursor.createdAt) return true;
  return message.createdAt === cursor.createdAt && message.id > cursor.id;
}

export function moveCursor(cursor: MessageCursor, message: Message): void {
  if (isMessageAfterCursor(message, cursor)) {
    cursor.createdAt = message.createdAt;
    cursor.id = message.id;
  }
}
