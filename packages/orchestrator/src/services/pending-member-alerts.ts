import type { RunState, WakeReason } from '@ujima/shared';

export interface PendingMemberAlert {
  organizationId: string;
  memberId: string;
  threadId: string;
  channelId?: string;
  messageId: string;
  byMemberId: string;
  reason: string;
  wakeReason: WakeReason;
}

const pendingByThread = new Map<string, PendingMemberAlert>();

function pendingKey(organizationId: string, memberId: string, threadId: string): string {
  return `${organizationId}:${memberId}:${threadId}`;
}

export function enqueuePendingMemberAlert(alert: PendingMemberAlert): void {
  const key = pendingKey(alert.organizationId, alert.memberId, alert.threadId);
  // A successor run reads current thread state, so replaying every wake adds
  // no context. Keep only the newest signal and bound memory per active key.
  pendingByThread.set(key, alert);
}

export function takePendingMemberAlert(
  organizationId: string,
  memberId: string,
  threadId: string,
): PendingMemberAlert | undefined {
  const key = pendingKey(organizationId, memberId, threadId);
  const pending = pendingByThread.get(key);
  pendingByThread.delete(key);
  return pending;
}

const TERMINAL_RUN_STATUSES = new Set<RunState['status']>(['completed', 'failed', 'cancelled']);

export async function drainPendingMemberAlertAfterRun(
  run: RunState,
  wake: (input: PendingMemberAlert) => Promise<void>,
): Promise<void> {
  if (!TERMINAL_RUN_STATUSES.has(run.status) || !run.threadId) return;
  const pending = takePendingMemberAlert(run.organizationId, run.agentId, run.threadId);
  if (!pending) return;
  // Detach the successor from the completed run's promise chain. Otherwise
  // every autonomous follow-up retains its predecessor until the chain ends.
  queueMicrotask(() => {
    void wake(pending).catch((error) => {
      console.error(
        'pending-member-alert successor failed',
        error instanceof Error ? error.stack ?? error.message : String(error),
      );
    });
  });
}

export function hasPendingMemberAlert(
  organizationId: string,
  memberId: string,
  threadId: string,
  messageId: string,
): boolean {
  const key = pendingKey(organizationId, memberId, threadId);
  return pendingByThread.get(key)?.messageId === messageId;
}

export function clearPendingMemberAlertsForTests(): void {
  pendingByThread.clear();
}
