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

  it('starts concurrent runs for human channel fanout wakes', async () => {
    const emit = vi.fn();
    let inFlight = 0;
    let maxInFlight = 0;
    const createRun = vi.fn(async (input: { agentId: string }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return {
        id: `run-${input.agentId}`,
        organizationId: baseInput.organizationId,
        agentId: input.agentId,
        threadId: baseInput.threadId,
        status: 'queued' as const,
        step: 'queued',
        summary: 'queued',
        startedAt: new Date().toISOString(),
      };
    });
    const repo = {
      listActiveRuns: vi.fn(() => [
        {
          id: 'existing-run',
          organizationId: baseInput.organizationId,
          agentId: 'agent-0',
          threadId: baseInput.threadId,
          status: 'running' as const,
          step: 'running',
          summary: 'running',
          startedAt: new Date().toISOString(),
        },
      ]),
      getMessage: vi.fn(() => ({ senderKind: 'human' })),
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
      wakeMemberWithFailureEvents(deps, { ...baseInput, wakeReason: 'channel-read' }),
      wakeMemberWithFailureEvents(deps, { ...baseInput, memberId: 'agent-2', messageId: 'msg-2', wakeReason: 'channel-read' }),
    ]);

    expect(createRun).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(2);
  });

  it('coalesces concurrent wakes from agent messages in one thread into a single createRun', async () => {
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
      getMessage: vi.fn(() => ({ senderKind: 'agent' })),
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
      wakeMemberWithFailureEvents(deps, { ...baseInput, byMemberId: 'agent-0' }),
      wakeMemberWithFailureEvents(deps, { ...baseInput, byMemberId: 'agent-0', memberId: 'agent-2', messageId: 'msg-2' }),
    ]);

    expect(createRun).toHaveBeenCalledTimes(1);
  });
});
