import { describe, expect, it, vi } from 'vitest';
import { SocketEventNames } from '@ujima/shared';
import { wakeMemberWithFailureEvents } from './index.js';

const baseInput = {
  organizationId: 'org-1',
  memberId: 'agent-1',
  threadId: 'thread-1',
  channelId: 'general',
  messageId: 'msg-1',
  byMemberId: 'human-1',
  reason: 'mention',
};

describe('wakeMemberWithFailureEvents', () => {
  it('emits supervisor_dispatch failure when supervisor throws', async () => {
    const emit = vi.fn();
    await wakeMemberWithFailureEvents(
      {
        supervisor: {
          handleAlert: vi.fn(async () => {
            throw new Error('supervisor exploded');
          }),
        },
        runs: {
          createRun: vi.fn(),
        },
        realtime: { emit },
      },
      baseInput,
    );

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0]).toBe(SocketEventNames.memberAlertFailed);
    expect(emit.mock.calls[0]?.[1]).toMatchObject({
      organizationId: baseInput.organizationId,
      memberId: baseInput.memberId,
      messageId: baseInput.messageId,
      stage: 'supervisor_dispatch',
      error: 'supervisor exploded',
    });
  });

  it('emits run_failed when run returns failed status', async () => {
    const emit = vi.fn();
    await wakeMemberWithFailureEvents(
      {
        supervisor: {
          handleAlert: vi.fn(async () => ({ kind: 'no-active-spirit' as const })),
        },
        runs: {
          createRun: vi.fn(async () => ({
            id: 'run-1',
            organizationId: 'org-1',
            agentId: 'agent-1',
            threadId: 'thread-1',
            status: 'failed' as const,
            step: 'failed',
            summary: 'Tool action blocked',
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
          })),
        },
        realtime: { emit },
      },
      baseInput,
    );

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0]).toBe(SocketEventNames.memberAlertFailed);
    expect(emit.mock.calls[0]?.[1]).toMatchObject({
      stage: 'run_failed',
      runId: 'run-1',
      error: 'Tool action blocked',
    });
  });

  it('emits run_create failure when run creation throws', async () => {
    const emit = vi.fn();
    await wakeMemberWithFailureEvents(
      {
        supervisor: {
          handleAlert: vi.fn(async () => ({ kind: 'no-active-spirit' as const })),
        },
        runs: {
          createRun: vi.fn(async () => {
            throw new Error('database locked');
          }),
        },
        realtime: { emit },
      },
      baseInput,
    );

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0]).toBe(SocketEventNames.memberAlertFailed);
    expect(emit.mock.calls[0]?.[1]).toMatchObject({
      stage: 'run_create',
      error: 'database locked',
    });
  });
});
