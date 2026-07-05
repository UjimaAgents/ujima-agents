import { describe, expect, it, vi } from 'vitest';
import type { RunState } from '@ujima/shared';
import { wakeMemberWithFailureEvents } from './index.js';
import type { PendingThreadAlert } from './pending-member-alerts.js';

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

function repo(options: {
  activeRuns?: RunState[] | (() => RunState[]);
  channelKind?: string;
  threadId?: string;
} = {}) {
  const pending = new Set<string>();
  const threadId = options.threadId ?? baseInput.threadId;
  const channelKind = options.channelKind ?? 'general';
  const pendingKey = (memberId: string, msgId: string) => `${memberId}:${threadId}:${msgId}`;
  return {
    listActiveRuns: vi.fn(() =>
      typeof options.activeRuns === 'function' ? options.activeRuns() : options.activeRuns ?? [],
    ),
    getMessage: vi.fn(() => ({ createdAt: '2026-01-01T00:00:00.000Z' })),
    getThread: vi.fn(() => ({ channelId: channelKind === 'dm' ? threadId : 'general', memberIds: ['h', 'agent-1', 'agent-2'] })),
    getChannel: vi.fn(() => ({ kind: channelKind })),
    enqueueWakeIntent: vi.fn((input: PendingThreadAlert & { messageCreatedAt: string }) => {
      pending.add(`${input.memberId}:${input.threadId}:${input.messageId}`);
      return { ...input, id: 'intent-1', status: 'pending' as const, createdAt: input.messageCreatedAt };
    }),
    hasPendingWakeIntent: vi.fn((_org: string, memberId: string, _threadId: string, msgId: string) =>
      pending.has(pendingKey(memberId, msgId)),
    ),
    listPendingWakeIntents: vi.fn(() => []),
    markWakeIntentDispatched: vi.fn(),
    markWakeIntentDropped: vi.fn(),
    clearPendingWakeIntents: vi.fn(),
  };
}

function deps(repoValue: ReturnType<typeof repo>, createRun: ReturnType<typeof vi.fn>) {
  return {
    spirits: { handleAlert: vi.fn(async () => ({ kind: 'no-active-spirit' as const })) },
    runs: { createRun },
    realtime: { emit: vi.fn() },
    repo: repoValue,
  };
}

describe('wakeMemberWithFailureEvents', () => {
  it('starts shared-channel agent wakes in parallel', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const createRun = vi.fn(async (input: { agentId: string }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
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
    const d = deps(repo({ channelKind: 'general' }), createRun);

    await Promise.all([
      wakeMemberWithFailureEvents(d, { ...baseInput, byMemberId: 'agent-0' }),
      wakeMemberWithFailureEvents(d, { ...baseInput, byMemberId: 'agent-0', memberId: 'agent-2', messageId: 'msg-2' }),
    ]);

    expect(createRun).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(2);
  });

  it('dedupes same-agent wakes in shared channels', async () => {
    const activeRuns: RunState[] = [];
    const createRun = vi.fn(async (input: { agentId: string }) => {
      activeRuns.push({
        id: `run-${input.agentId}`,
        organizationId: baseInput.organizationId,
        agentId: input.agentId,
        threadId: baseInput.threadId,
        status: 'running',
        step: 'running',
        summary: 'running',
        startedAt: new Date().toISOString(),
      } as RunState);
      return { ...activeRuns[0], status: 'queued' as const, step: 'queued', summary: 'queued' };
    });
    const d = deps(repo({ activeRuns: () => activeRuns }), createRun);

    await Promise.all([
      wakeMemberWithFailureEvents(d, { ...baseInput, wakeReason: 'channel-read' }),
      wakeMemberWithFailureEvents(d, { ...baseInput, messageId: 'msg-2', wakeReason: 'channel-read' }),
    ]);

    expect(createRun).toHaveBeenCalledTimes(1);
  });

  it('serializes one-to-one DM wakes by thread', async () => {
    let activeRun: RunState | null = null;
    const threadId = 'dm:agent-0:agent-1';
    const createRun = vi.fn(async (input: { agentId: string }) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeRun = {
        id: `run-${input.agentId}`,
        organizationId: baseInput.organizationId,
        agentId: input.agentId,
        threadId,
        status: 'running',
        step: 'running',
        summary: 'running',
        startedAt: new Date().toISOString(),
      };
      return { ...activeRun, status: 'queued' as const, step: 'queued', summary: 'queued' };
    });
    const r = repo({ activeRuns: () => activeRun ? [activeRun] : [], channelKind: 'dm', threadId });
    const d = deps(r, createRun);

    await Promise.all([
      wakeMemberWithFailureEvents(d, { ...baseInput, threadId, channelId: threadId }),
      wakeMemberWithFailureEvents(d, { ...baseInput, threadId, channelId: threadId, memberId: 'agent-2', messageId: 'msg-2' }),
    ]);

    expect(createRun).toHaveBeenCalledTimes(1);
    expect(r.hasPendingWakeIntent(baseInput.organizationId, 'agent-2', threadId, 'msg-2')).toBe(true);
  });
});
