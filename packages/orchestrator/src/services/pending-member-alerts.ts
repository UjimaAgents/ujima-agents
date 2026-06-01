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

const pendingByThread = new Map<string, PendingMemberAlert[]>();

function pendingKey(organizationId: string, memberId: string, threadId: string): string {
  return `${organizationId}:${memberId}:${threadId}`;
}

export function enqueuePendingMemberAlert(alert: PendingMemberAlert): void {
  const key = pendingKey(alert.organizationId, alert.memberId, alert.threadId);
  const queue = pendingByThread.get(key);
  if (queue) {
    queue.push(alert);
  } else {
    pendingByThread.set(key, [alert]);
  }
}

export function takePendingMemberAlert(
  organizationId: string,
  memberId: string,
  threadId: string,
): PendingMemberAlert | undefined {
  const key = pendingKey(organizationId, memberId, threadId);
  const queue = pendingByThread.get(key);
  if (!queue || queue.length === 0) {
    pendingByThread.delete(key);
    return undefined;
  }
  const pending = queue.shift();
  if (queue.length === 0) {
    pendingByThread.delete(key);
  }
  return pending;
}

const TERMINAL_RUN_STATUSES = new Set<RunState['status']>(['completed', 'failed', 'cancelled']);

export async function drainPendingMemberAlertAfterRun(
  run: RunState,
  wake: (input: PendingMemberAlert) => Promise<void>,
): Promise<void> {
  if (!TERMINAL_RUN_STATUSES.has(run.status) || !run.threadId) return;
  let pending: PendingMemberAlert | undefined;
  while ((pending = takePendingMemberAlert(run.organizationId, run.agentId, run.threadId))) {
    await wake(pending);
  }
}

export function hasPendingMemberAlert(
  organizationId: string,
  memberId: string,
  threadId: string,
  messageId: string,
): boolean {
  const key = pendingKey(organizationId, memberId, threadId);
  const queue = pendingByThread.get(key);
  if (!queue) return false;
  return queue.some((alert) => alert.messageId === messageId);
}

export function clearPendingMemberAlertsForTests(): void {
  pendingByThread.clear();
}
