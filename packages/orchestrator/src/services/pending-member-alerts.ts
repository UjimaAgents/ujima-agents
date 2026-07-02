import type { RunState, WakeReason } from '@ujima/shared';
import { clearRunInterruptCursor, getRunInterruptCursor } from '../utils/interrupt-run-state.js';

export interface PendingThreadAlert {
  organizationId: string;
  memberId: string;
  threadId: string;
  channelId?: string;
  messageId: string;
  messageCreatedAt?: string;
  byMemberId: string;
  reason: string;
  wakeReason: WakeReason;
}

const pendingByThread = new Map<string, PendingThreadAlert[]>();

function pendingKey(organizationId: string, threadId: string): string {
  return `${organizationId}:${threadId}`;
}

export function enqueuePendingThreadAlert(alert: PendingThreadAlert): void {
  const key = pendingKey(alert.organizationId, alert.threadId);
  const queue = pendingByThread.get(key) ?? [];
  if (queue.some((pending) => pending.memberId === alert.memberId && pending.messageId === alert.messageId)) return;
  queue.push(alert);
  pendingByThread.set(key, queue);
}

export function takePendingThreadAlert(
  organizationId: string,
  threadId: string,
): PendingThreadAlert | undefined {
  const key = pendingKey(organizationId, threadId);
  const queue = pendingByThread.get(key);
  if (!queue?.length) return undefined;
  const mentionIndex = queue.findIndex((pending) => pending.wakeReason === 'mention');
  const index = mentionIndex >= 0 ? mentionIndex : 0;
  const [pending] = queue.splice(index, 1);
  if (queue.length === 0) {
    pendingByThread.delete(key);
  } else {
    pendingByThread.set(key, queue);
  }
  return pending;
}

export function clearPendingThreadAlerts(
  organizationId: string,
  threadId: string,
): void {
  pendingByThread.delete(pendingKey(organizationId, threadId));
}

const DRAINABLE_RUN_STATUSES = new Set<RunState['status']>([
  'completed',
  'failed',
  'waiting_for_approval',
  'waiting_for_input',
]);

export async function drainPendingThreadAlertAfterRun(
  run: RunState,
  wake: (input: PendingThreadAlert) => Promise<void>,
): Promise<void> {
  if (run.status === 'cancelled') {
    if (run.threadId) clearPendingThreadAlerts(run.organizationId, run.threadId);
    clearRunInterruptCursor(run.id);
    return;
  }
  if (!DRAINABLE_RUN_STATUSES.has(run.status) || !run.threadId) {
    clearRunInterruptCursor(run.id);
    return;
  }
  const cursor = getRunInterruptCursor(run.id);
  try {
    while (true) {
      const pending = takePendingThreadAlert(run.organizationId, run.threadId);
      if (!pending) return;
      if (cursor && pending.messageCreatedAt) {
        const isAfterCursor =
          pending.messageCreatedAt > cursor.createdAt ||
          (pending.messageCreatedAt === cursor.createdAt && pending.messageId > cursor.id);
        if (!isAfterCursor) continue;
      }
      if (cursor && !pending.messageCreatedAt) {
        continue;
      }
      // Detach the successor from the current run's promise chain. Otherwise
      // every autonomous follow-up retains its predecessor until the chain ends.
      queueMicrotask(() => {
        void wake(pending).catch((error) => {
          console.error(
            'pending-thread-alert successor failed',
            error instanceof Error ? error.stack ?? error.message : String(error),
          );
        });
      });
      return;
    }
  } finally {
    clearRunInterruptCursor(run.id);
  }
}

export function hasPendingThreadAlert(
  organizationId: string,
  memberId: string,
  threadId: string,
  messageId: string,
): boolean {
  const key = pendingKey(organizationId, threadId);
  return pendingByThread.get(key)?.some((pending) => pending.memberId === memberId && pending.messageId === messageId) ?? false;
}

export function clearPendingThreadAlertsForTests(): void {
  pendingByThread.clear();
}
