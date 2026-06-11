import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunState } from '@ujima/shared';
import {
  clearPendingMemberAlertsForTests,
  drainPendingMemberAlertAfterRun,
  enqueuePendingMemberAlert,
  takePendingMemberAlert,
} from './pending-member-alerts.js';
import {
  clearRunInterruptCursorsForTests,
  recordRunInterruptCursor,
} from '../utils/interrupt-run-state.js';

const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(() => resolve()));

describe('pending-member-alerts', () => {
  beforeEach(() => {
    clearPendingMemberAlertsForTests();
    clearRunInterruptCursorsForTests();
  });

  it('queues distinct alerts per org/member/thread', () => {
    enqueuePendingMemberAlert({
      organizationId: 'org-1',
      memberId: 'agent-1',
      threadId: 'thread-1',
      messageId: 'msg-1',
      byMemberId: 'peer-1',
      reason: 'dm',
      wakeReason: 'dm',
    });
    enqueuePendingMemberAlert({
      organizationId: 'org-1',
      memberId: 'agent-1',
      threadId: 'thread-1',
      messageId: 'msg-2',
      byMemberId: 'peer-1',
      reason: 'dm',
      wakeReason: 'dm',
    });
    expect(takePendingMemberAlert('org-1', 'agent-1', 'thread-1')?.messageId).toBe('msg-1');
    expect(takePendingMemberAlert('org-1', 'agent-1', 'thread-1')?.messageId).toBe('msg-2');
    expect(takePendingMemberAlert('org-1', 'agent-1', 'thread-1')).toBeUndefined();
  });

  it('drains a pending alert after a terminal run completes', async () => {
    const wake = vi.fn(async () => undefined);
    enqueuePendingMemberAlert({
      organizationId: 'org-1',
      memberId: 'agent-1',
      threadId: 'thread-1',
      messageId: 'msg-queued',
      byMemberId: 'peer-1',
      reason: 'dm',
      wakeReason: 'dm',
    });
    const run = {
      id: 'run-1',
      organizationId: 'org-1',
      agentId: 'agent-1',
      threadId: 'thread-1',
      status: 'completed',
      step: 'completed',
      summary: 'done',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    } as RunState;

    await drainPendingMemberAlertAfterRun(run, wake);
    await flushMicrotasks();

    expect(wake).toHaveBeenCalledTimes(1);
    expect(wake).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'msg-queued' }),
    );
    expect(takePendingMemberAlert('org-1', 'agent-1', 'thread-1')).toBeUndefined();
  });

  it.each(['failed', 'cancelled'] as const)(
    'drains a pending alert after a terminal run with status %s',
    async (status) => {
      const wake = vi.fn(async () => undefined);
      enqueuePendingMemberAlert({
        organizationId: 'org-1',
        memberId: 'agent-1',
        threadId: 'thread-1',
        messageId: 'msg-queued',
        byMemberId: 'peer-1',
        reason: 'dm',
        wakeReason: 'dm',
      });
      const run = {
        id: 'run-1',
        organizationId: 'org-1',
        agentId: 'agent-1',
        threadId: 'thread-1',
        status,
        step: status,
        summary: status === 'failed' ? 'error' : 'Stopped by user',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      } as RunState;

      await drainPendingMemberAlertAfterRun(run, wake);
      await flushMicrotasks();

      expect(wake).toHaveBeenCalledTimes(1);
      expect(takePendingMemberAlert('org-1', 'agent-1', 'thread-1')).toBeUndefined();
    },
  );

  it('drops pending alerts already seen by the finished run and wakes the next one', async () => {
    const wake = vi.fn(async () => undefined);
    recordRunInterruptCursor('run-1', {
      createdAt: '2026-01-01T00:00:02.000Z',
      id: 'msg-cursor',
    });
    enqueuePendingMemberAlert({
      organizationId: 'org-1',
      memberId: 'agent-1',
      threadId: 'thread-1',
      messageId: 'msg-old',
      messageCreatedAt: '2026-01-01T00:00:01.000Z',
      byMemberId: 'peer-1',
      reason: 'dm',
      wakeReason: 'dm',
    });
    enqueuePendingMemberAlert({
      organizationId: 'org-1',
      memberId: 'agent-1',
      threadId: 'thread-1',
      messageId: 'msg-new',
      messageCreatedAt: '2026-01-01T00:00:03.000Z',
      byMemberId: 'peer-1',
      reason: 'dm',
      wakeReason: 'dm',
    });
    const run = {
      id: 'run-1',
      organizationId: 'org-1',
      agentId: 'agent-1',
      threadId: 'thread-1',
      status: 'completed',
      step: 'completed',
      summary: 'done',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    } as RunState;

    await drainPendingMemberAlertAfterRun(run, wake);
    await flushMicrotasks();

    expect(wake).toHaveBeenCalledTimes(1);
    expect(wake).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'msg-new' }));
    expect(takePendingMemberAlert('org-1', 'agent-1', 'thread-1')).toBeUndefined();
  });
});
