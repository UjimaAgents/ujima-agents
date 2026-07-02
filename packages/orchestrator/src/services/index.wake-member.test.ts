import { describe, expect, it, vi } from 'vitest';
import { SocketEventNames, type RunState } from '@ujima/shared';
import { wakeMemberWithFailureEvents } from './index.js';

const noopRepo = {
  listActiveRuns: vi.fn(() => []),
};

const baseInput = {
  organizationId: 'org-1',
  memberId: 'agent-1',
  threadId: 'thread-1',
  channelId: 'general',
  messageId: 'msg-1',
  byMemberId: 'human-1',
  reason: 'mention',
  wakeReason: 'mention' as const,
};

describe('wakeMemberWithFailureEvents', () => {
  it('emits supervisor_dispatch failure when supervisor throws', async () => {
    const emit = vi.fn();
    await wakeMemberWithFailureEvents(
      {
        spirits: {
          handleAlert: vi.fn(async () => {
            throw new Error('supervisor exploded');
          }),
        },
        runs: {
          createRun: vi.fn(),
        },
        realtime: { emit },
        repo: noopRepo,
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

  it('coalesces concurrent wakes in one thread into a single createRun', async () => {
    const emit = vi.fn();
    let activeRun: RunState | null = null;
    const createRun = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeRun = {
        id: 'run-coalesce',
        organizationId: baseInput.organizationId,
        agentId: baseInput.memberId,
        threadId: baseInput.threadId,
        status: 'running',
        step: 'running',
        summary: 'running',
        startedAt: new Date().toISOString(),
      };
      return {
        ...activeRun,
        status: 'queued' as const,
        step: 'queued',
        summary: 'queued',
      };
    });
    const repo = {
      listActiveRuns: vi.fn(() => activeRun ? [activeRun] : []),
    };
    const deps = {
      spirits: {
        handleAlert: vi.fn(async () => ({ kind: 'no-active-spirit' as const })),
      },
      runs: { createRun },
      realtime: { emit },
      repo,
    };

    await Promise.all([
      wakeMemberWithFailureEvents(deps, baseInput),
      wakeMemberWithFailureEvents(deps, { ...baseInput, memberId: 'agent-2', messageId: 'msg-2' }),
    ]);

    expect(createRun).toHaveBeenCalledTimes(1);
  });
});
