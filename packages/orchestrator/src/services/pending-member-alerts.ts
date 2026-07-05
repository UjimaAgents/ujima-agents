import { isOneToOneThread, type RunState, type WakeReason } from '@ujima/shared';
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

interface WakeIntentRecord extends PendingThreadAlert {
  id: string;
  status: 'pending' | 'dispatched' | 'dropped';
  messageCreatedAt: string;
  createdAt: string;
}

export interface PendingThreadAlertRepository {
  enqueueWakeIntent(input: PendingThreadAlert & { messageCreatedAt: string }): WakeIntentRecord;
  listPendingWakeIntents(organizationId: string, threadId: string): WakeIntentRecord[];
  markWakeIntentDispatched(organizationId: string, intentId: string): void;
  markWakeIntentDropped(organizationId: string, intentId: string): void;
  clearPendingWakeIntents(organizationId: string, threadId: string): void;
  hasPendingWakeIntent(
    organizationId: string,
    memberId: string,
    threadId: string,
    messageId: string,
  ): boolean;
  listActiveRuns?(organizationId: string): RunState[];
  getChannel?(organizationId: string, channelId: string): { kind?: string } | null;
  getThread?(organizationId: string, threadId: string): { channelId?: string; memberIds?: string[] } | null;
}

function ensureMessageCreatedAt(alert: PendingThreadAlert): PendingThreadAlert & { messageCreatedAt: string } {
  return {
    ...alert,
    messageCreatedAt: alert.messageCreatedAt ?? new Date().toISOString(),
  };
}

function toPendingAlert(intent: WakeIntentRecord): PendingThreadAlert {
  return {
    organizationId: intent.organizationId,
    memberId: intent.memberId,
    threadId: intent.threadId,
    channelId: intent.channelId,
    messageId: intent.messageId,
    messageCreatedAt: intent.messageCreatedAt,
    byMemberId: intent.byMemberId,
    reason: intent.reason,
    wakeReason: intent.wakeReason,
  };
}

function isAfterCursor(
  intent: WakeIntentRecord,
  cursor: { createdAt: string; id: string } | undefined,
): boolean {
  if (!cursor) return true;
  return (
    intent.messageCreatedAt > cursor.createdAt ||
    (intent.messageCreatedAt === cursor.createdAt && intent.messageId > cursor.id)
  );
}

function parallelDrainMode(
  repo: PendingThreadAlertRepository,
  organizationId: string,
  threadId: string,
  alert?: PendingThreadAlert,
): boolean {
  if (isOneToOneThread(threadId)) return false;
  const thread = repo.getThread?.(organizationId, threadId);
  const channelId = alert?.channelId ?? thread?.channelId ?? threadId;
  const channel = repo.getChannel?.(organizationId, channelId);
  if (channel?.kind === 'dm' || channel?.kind === 'self') return false;
  if (channel?.kind === 'general' || channel?.kind === 'group' || channel?.kind === 'task-run') return true;
  return (thread?.memberIds?.length ?? 0) > 2;
}

function activeAgentsInThread(
  repo: PendingThreadAlertRepository,
  organizationId: string,
  threadId: string,
): Set<string> {
  return new Set(
    repo
      .listActiveRuns?.(organizationId)
      .filter((run) => run.threadId === threadId)
      .map((run) => run.agentId) ?? [],
  );
}

export function enqueuePendingThreadAlert(
  repo: PendingThreadAlertRepository,
  alert: PendingThreadAlert,
): void {
  repo.enqueueWakeIntent(ensureMessageCreatedAt(alert));
}

export function takePendingThreadAlert(
  repo: PendingThreadAlertRepository,
  organizationId: string,
  threadId: string,
): PendingThreadAlert | undefined {
  const intent = repo.listPendingWakeIntents(organizationId, threadId)[0];
  if (!intent) return undefined;
  repo.markWakeIntentDispatched(organizationId, intent.id);
  return toPendingAlert(intent);
}

export function clearPendingThreadAlerts(
  repo: PendingThreadAlertRepository,
  organizationId: string,
  threadId: string,
): void {
  repo.clearPendingWakeIntents(organizationId, threadId);
}

const DRAINABLE_RUN_STATUSES = new Set<RunState['status']>([
  'completed',
  'failed',
  'waiting_for_approval',
  'waiting_for_input',
]);

export async function drainPendingThreadAlertAfterRun(
  repo: PendingThreadAlertRepository,
  run: RunState,
  wake: (input: PendingThreadAlert) => Promise<void>,
): Promise<void> {
  if (run.status === 'cancelled') {
    if (run.threadId) clearPendingThreadAlerts(repo, run.organizationId, run.threadId);
    clearRunInterruptCursor(run.id);
    return;
  }
  if (!DRAINABLE_RUN_STATUSES.has(run.status) || !run.threadId) {
    clearRunInterruptCursor(run.id);
    return;
  }
  const cursor = getRunInterruptCursor(run.id);
  try {
    const intents = repo.listPendingWakeIntents(run.organizationId, run.threadId);
    const runnable = intents.filter((intent) => {
      if (isAfterCursor(intent, cursor)) return true;
      repo.markWakeIntentDropped(run.organizationId, intent.id);
      return false;
    });
    if (!runnable.length) return;

    const first = runnable[0];
    if (!first) return;
    const activeAgents = activeAgentsInThread(repo, run.organizationId, run.threadId);
    const parallel = parallelDrainMode(repo, run.organizationId, run.threadId, first);
    const selected: WakeIntentRecord[] = [];
    if (parallel) {
      const selectedAgents = new Set<string>();
      for (const intent of runnable) {
        if (activeAgents.has(intent.memberId) || selectedAgents.has(intent.memberId)) continue;
        selected.push(intent);
        selectedAgents.add(intent.memberId);
      }
    } else if (activeAgents.size === 0) {
      selected.push(first);
    }

    for (const intent of selected) {
      const pending = toPendingAlert(intent);
      repo.markWakeIntentDispatched(run.organizationId, intent.id);
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
    }
  } finally {
    clearRunInterruptCursor(run.id);
  }
}

export function hasPendingThreadAlert(
  repo: PendingThreadAlertRepository,
  organizationId: string,
  memberId: string,
  threadId: string,
  messageId: string,
): boolean {
  return repo.hasPendingWakeIntent(organizationId, memberId, threadId, messageId);
}

export function clearPendingThreadAlertsForTests(): void {
  // Durable wake intents live in the repository. Tests should reset their repo.
}
