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
  pendingByThread.set(pendingKey(alert.organizationId, alert.memberId, alert.threadId), alert);
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
  if (pending) await wake(pending);
}

export function clearPendingMemberAlertsForTests(): void {
  pendingByThread.clear();
}
