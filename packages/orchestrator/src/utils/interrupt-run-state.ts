import type { MessageCursor } from './message-interrupts.js';

const interruptCursorByRunId = new Map<string, MessageCursor>();

export function recordRunInterruptCursor(runId: string, cursor: MessageCursor): void {
  interruptCursorByRunId.set(runId, { ...cursor });
}

export function getRunInterruptCursor(runId: string): MessageCursor | undefined {
  const cursor = interruptCursorByRunId.get(runId);
  return cursor ? { ...cursor } : undefined;
}

export function clearRunInterruptCursor(runId: string): void {
  interruptCursorByRunId.delete(runId);
}

export function clearRunInterruptCursorsForTests(): void {
  interruptCursorByRunId.clear();
}
