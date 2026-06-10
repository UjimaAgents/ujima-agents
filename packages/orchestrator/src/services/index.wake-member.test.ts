import { describe, expect, it, vi } from 'vitest';
import { SocketEventNames, type RunState } from '@ujima/shared';
import { wakeMemberWithFailureEvents } from './index.js';

// saveRun got added to WakeMemberDeps['repo'] in the d3d4b38 commit
// so the index.ts can mutate an existing run's wakeReason on a
// mention-while-active path. Tests need to provide the stub; absent
// it the calling branch throws "saveRun is not a function" and
// 2 tests fail. Defaulted to vi.fn() here so per-test stubs only
// override what they actually inspect.
const noopRepo = {
  findActiveRunForMemberThread: vi.fn(() => null),
  saveRun: vi.fn(),
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

  it('emits run_failed when run returns failed status', async () => {
    const emit = vi.fn();
    await wakeMemberWithFailureEvents(
      {
        spirits: {
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
        repo: noopRepo,
      },
      baseInput,
    );

    // Loophole-fix Phase 4 — every wake also emits `spirit:dispatch`
    // for observability (was previously invisible). The mandatory
    // failure event is the LAST call when run_failed.
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0]?.[0]).toBe(SocketEventNames.spiritDispatch);
    expect(emit.mock.calls[1]?.[0]).toBe(SocketEventNames.memberAlertFailed);
    expect(emit.mock.calls[1]?.[1]).toMatchObject({
      stage: 'run_failed',
      runId: 'run-1',
      error: 'Tool action blocked',
    });
  });

  it('emits run_create failure when run creation throws', async () => {
    const emit = vi.fn();
    await wakeMemberWithFailureEvents(
      {
        spirits: {
          handleAlert: vi.fn(async () => ({ kind: 'no-active-spirit' as const })),
        },
        runs: {
          createRun: vi.fn(async () => {
            throw new Error('database locked');
          }),
        },
        realtime: { emit },
        repo: noopRepo,
      },
      baseInput,
    );

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0]?.[0]).toBe(SocketEventNames.spiritDispatch);
    expect(emit.mock.calls[1]?.[0]).toBe(SocketEventNames.memberAlertFailed);
    expect(emit.mock.calls[1]?.[1]).toMatchObject({
      stage: 'run_create',
      error: 'database locked',
    });
  });

  it('queues a pending alert when an active run already exists for member+thread', async () => {
    const createRun = vi.fn();
    const emit = vi.fn();
    const repo = {
      saveRun: vi.fn(),
      findActiveRunForMemberThread: vi.fn(() => ({
        id: 'existing',
        organizationId: baseInput.organizationId,
        agentId: baseInput.memberId,
        threadId: baseInput.threadId,
        status: 'waiting_for_approval' as const,
        step: 'waiting_for_approval',
        summary: 'Waiting',
        startedAt: '2026-01-01T00:00:00.000Z',
      })),
    };
    await wakeMemberWithFailureEvents(
      {
        spirits: {
          handleAlert: vi.fn(async () => ({ kind: 'no-active-spirit' as const })),
        },
        runs: { createRun },
        realtime: { emit },
        repo,
      },
      baseInput,
    );
    expect(createRun).not.toHaveBeenCalled();
    // spirit:dispatch is always emitted now (Phase 4 observability),
    // even when there's an active run and we short-circuit out.
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0]).toBe(SocketEventNames.spiritDispatch);
  });

  // L10 — when two near-simultaneous wakes hit the same
  // (org, member, threadId), the createRun mutex must serialize
  // them so only ONE run is spawned. Without the mutex,
  // findActiveRunForMemberThread is TOCTOU and both callers see
  // "no run" and each fire createRun.
  it('coalesces two concurrent wakes into a single createRun (L10 mutex)', async () => {
    const emit = vi.fn();
    // Track the side-effects across calls. The first createRun
    // should "create" a run; subsequent findActiveRunForMemberThread
    // calls should see it (simulating real repo behaviour where
    // saveRun → next find returns the row).
    let activeRun: RunState | null = null;
    const createRun = vi.fn(async () => {
      // Tiny artificial delay to widen the race window.
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
      saveRun: vi.fn(),
      findActiveRunForMemberThread: vi.fn(() => activeRun),
    };
    const deps = {
      spirits: {
        handleAlert: vi.fn(async () => ({ kind: 'no-active-spirit' as const })),
      },
      runs: { createRun },
      realtime: { emit },
      repo,
    };

    // Two concurrent calls. Mutex must serialize → only one createRun.
    await Promise.all([
      wakeMemberWithFailureEvents(deps, baseInput),
      wakeMemberWithFailureEvents(deps, baseInput),
    ]);

    expect(createRun).toHaveBeenCalledTimes(1);
  });
});
