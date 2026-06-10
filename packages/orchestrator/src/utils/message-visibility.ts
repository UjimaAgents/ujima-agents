import type { Message } from '@ujima/shared';

export function isTraceOnlyMessage(message: Message): boolean {
  return message.metadata?.traceOnly === true;
}

export function filterVisibleMessages(messages: Message[]): Message[] {
  return messages.filter((message) => !isTraceOnlyMessage(message));
}
