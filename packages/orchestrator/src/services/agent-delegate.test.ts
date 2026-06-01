import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberSchema, MessageSchema, type Message, type RunState } from '@ujima/shared';
import { runAgentDelegateTurn } from './index.js';
import type { ApiRepository } from './repository-reader.js';
import type { ConversationService } from './conversation.js';
import { clearPendingMemberAlertsForTests, enqueuePendingMemberAlert } from './pending-member-alerts.js';

beforeEach(() => {
  clearPendingMemberAlertsForTests();
});

const orgId = 'org-1';
const caller = MemberSchema.parse({
  id: 'agent-1',
  organizationId: orgId,
  name: 'Ava',
  kind: 'agent',
  roleName: 'assistant',
  presence: 'online',
});
const target = MemberSchema.parse({
  id: 'agent-2',
  organizationId: orgId,
  name: 'Bo',
  kind: 'agent',
  roleName: 'assistant',
  presence: 'online',
});

function message(input: Partial<Message> & Pick<Message, 'id' | 'senderId' | 'content'>): Message {
  return MessageSchema.parse({
    organizationId: orgId,
    threadId: 'dm:agent-1:agent-2',
    channelId: 'dm:agent-1:agent-2',
    senderKind: 'agent',
    kind: 'agent',
    mentions: [],
    createdAt: '2026-05-31T10:00:00.000Z',
    ...input,
  });
}

function repoFixture(options: { activeRun?: RunState | null; reply?: Message | null; runs?: RunState[] } = {}) {
  const messages: Message[] = [];
  const finishedRuns = [{
    id: 'delegate-run-1',
    organizationId: orgId,
    agentId: target.id,
    threadId: 'dm:agent-1:agent-2',
    status: 'completed',
    step: 'completed',
    summary: 'completed',
    startedAt: '2026-05-31T10:00:00.000Z',
    endedAt: '2026-05-31T10:00:01.000Z',
    sourceMessageId: 'delegate-1',
  }] as RunState[];
  const repo = {
    listMembers: vi.fn(() => [caller, target]),
    listMessages: vi.fn(() => ({ data: messages, hasMore: false })),
    findActiveRunForMemberThread: vi.fn(() => options.activeRun ?? null),
    listThreadRuns: vi.fn(() => ({ data: options.runs ?? finishedRuns, hasMore: false })),
  };
  const delegateMessage = message({
    id: 'delegate-1',
    senderId: caller.id,
    content: 'please check this',
  });
  const conversations = {
    sendDirectMessage: vi.fn(() => {
      messages.push(delegateMessage);
      if (options.reply) messages.push(options.reply);
      return delegateMessage;
    }),
  };
  const createRun = vi.fn(async () => null);
  return { repo, conversations, delegateMessage, messages, createRun };
}

describe('agent delegation', () => {
  it('posts a DM, wakes the target, waits for the final target reply, and does not write again', async () => {
    const reply = message({
      id: 'reply-1',
      senderId: target.id,
      content: 'done',
      createdAt: '2026-05-31T10:00:01.000Z',
    });
    const { repo, conversations, createRun } = repoFixture({ reply });
    const wakeMember = vi.fn();

    const result = await runAgentDelegateTurn({
      repo: repo as unknown as ApiRepository,
      conversations: conversations as unknown as ConversationService,
      wakeMember,
      createRun,
      organizationId: orgId,
      fromMemberId: caller.id,
      to: target.name,
      message: 'please check this',
      runId: 'run-1',
    });

    expect(conversations.sendDirectMessage).toHaveBeenCalledTimes(1);
    expect(conversations.sendDirectMessage).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: target.id,
      ignore: true,
      metadata: expect.objectContaining({ runId: 'run-1' }),
    }));
    expect(wakeMember).toHaveBeenCalledWith(expect.objectContaining({
      memberId: target.id,
      threadId: 'dm:agent-1:agent-2',
      wakeReason: 'dm',
    }));
    expect(result).toMatchObject({
      status: 'completed',
      agent: target.name,
      agent_id: target.id,
      thread_id: 'dm:agent-1:agent-2',
      reply_id: reply.id,
      reply_content: reply.content,
    });
  });

  it('returns a same-millisecond reply by message order instead of id order', async () => {
    const reply = message({
      id: 'a-reply',
      senderId: target.id,
      content: 'same millisecond done',
      createdAt: '2026-05-31T10:00:00.000Z',
    });
    const { repo, conversations, createRun } = repoFixture({ reply });

    const result = await runAgentDelegateTurn({
      repo: repo as unknown as ApiRepository,
      conversations: conversations as unknown as ConversationService,
      wakeMember: vi.fn(),
      createRun,
      organizationId: orgId,
      fromMemberId: caller.id,
      to: target.name,
      message: 'delegate',
      runId: 'parent-run',
    });

    expect(result).toMatchObject({
      status: 'completed',
      reply_id: 'a-reply',
      reply_content: 'same millisecond done',
    });
  });

  it('allows delegating to itself through a real agent-only DM thread', async () => {
    const { repo, conversations, createRun } = repoFixture();
    repo.listMembers.mockReturnValue([caller]);
    repo.listThreadRuns.mockReturnValue({
      data: [{
        id: 'delegate-run-1',
        organizationId: orgId,
        agentId: caller.id,
        threadId: 'dm:agent-1:agent-1',
        status: 'completed',
        step: 'completed',
        summary: 'completed',
        startedAt: '2026-05-31T10:00:00.000Z',
        endedAt: '2026-05-31T10:00:01.000Z',
        sourceMessageId: 'delegate-1',
      } as RunState],
      hasMore: false,
    });
    const wakeMember = vi.fn();

    const result = await runAgentDelegateTurn({
      repo: repo as unknown as ApiRepository,
      conversations: conversations as unknown as ConversationService,
      wakeMember,
      createRun,
      organizationId: orgId,
      fromMemberId: caller.id,
      to: caller.id,
      message: 'split this into another turn',
      runId: 'run-1',
    });

    expect(conversations.sendDirectMessage).toHaveBeenCalledWith(expect.objectContaining({
      senderId: caller.id,
      recipientId: caller.id,
      ignore: true,
    }));
    expect(wakeMember).not.toHaveBeenCalled();
    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({
      agentId: caller.id,
      threadId: 'dm:agent-1:agent-1',
      sourceMessageId: 'delegate-1',
    }));
    expect(result).toMatchObject({
      status: 'no_reply',
      agent_id: caller.id,
      thread_id: 'dm:agent-1:agent-1',
    });
  });

  it('queues interrupts through wake routing when the target is already active', async () => {
    const activeRun = {
      id: 'active-1',
      organizationId: orgId,
      agentId: target.id,
      threadId: 'dm:agent-1:agent-2',
      status: 'running',
      step: 'running',
      summary: 'running',
      startedAt: '2026-05-31T10:00:00.000Z',
    } as RunState;
    const { repo, conversations, createRun } = repoFixture({ activeRun });
    repo.findActiveRunForMemberThread
      .mockReturnValueOnce(activeRun)
      .mockReturnValue(null);
    const wakeMember = vi.fn();

    const result = await runAgentDelegateTurn({
      repo: repo as unknown as ApiRepository,
      conversations: conversations as unknown as ConversationService,
      wakeMember,
      createRun,
      organizationId: orgId,
      fromMemberId: caller.id,
      to: target.id,
      message: 'extra detail',
      runId: 'run-1',
    });

    expect(conversations.sendDirectMessage).toHaveBeenCalledTimes(1);
    expect(wakeMember).toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
    expect(result.status).toBe('no_reply');
  });

  it('starts a duplicate run for self-delegation even when the caller already has an active run', async () => {
    const activeRun = {
      id: 'run-1',
      organizationId: orgId,
      agentId: caller.id,
      threadId: 'dm:agent-1:agent-1',
      status: 'running',
      step: 'running',
      summary: 'running',
      startedAt: '2026-05-31T10:00:00.000Z',
    } as RunState;
    const { repo, conversations, createRun } = repoFixture({ activeRun });
    repo.listMembers.mockReturnValue([caller]);
    repo.listThreadRuns.mockReturnValue({
      data: [{
        id: 'delegate-run-1',
        organizationId: orgId,
        agentId: caller.id,
        threadId: 'dm:agent-1:agent-1',
        status: 'completed',
        step: 'completed',
        summary: 'completed',
        startedAt: '2026-05-31T10:00:00.000Z',
        endedAt: '2026-05-31T10:00:01.000Z',
        sourceMessageId: 'delegate-1',
      } as RunState],
      hasMore: false,
    });

    await runAgentDelegateTurn({
      repo: repo as unknown as ApiRepository,
      conversations: conversations as unknown as ConversationService,
      wakeMember: vi.fn(),
      createRun,
      organizationId: orgId,
      fromMemberId: caller.id,
      to: caller.id,
      message: 'parallel self work',
      runId: 'run-1',
    });

    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({
      agentId: caller.id,
      threadId: 'dm:agent-1:agent-1',
      sourceMessageId: 'delegate-1',
    }));
  });

  it('returns delegate_failed when the delegated run fails', async () => {
    const failedRun = {
      id: 'delegate-run-1',
      organizationId: orgId,
      agentId: target.id,
      threadId: 'dm:agent-1:agent-2',
      status: 'failed',
      step: 'failed',
      summary: 'Tool action blocked',
      startedAt: '2026-05-31T10:00:00.000Z',
      endedAt: '2026-05-31T10:00:01.000Z',
      sourceMessageId: 'delegate-1',
    } as RunState;
    const { repo, conversations, createRun } = repoFixture({ runs: [failedRun] });

    const result = await runAgentDelegateTurn({
      repo: repo as unknown as ApiRepository,
      conversations: conversations as unknown as ConversationService,
      wakeMember: vi.fn(),
      createRun,
      organizationId: orgId,
      fromMemberId: caller.id,
      to: target.id,
      message: 'review this',
      runId: 'run-1',
    });

    expect(result).toMatchObject({
      status: 'delegate_failed',
      run_status: 'failed',
      error: 'Tool action blocked',
    });
  });

  it('returns timed_out when no reply or terminal delegate run appears', async () => {
    const { repo, conversations, createRun } = repoFixture({ runs: [] });

    const result = await runAgentDelegateTurn({
      repo: repo as unknown as ApiRepository,
      conversations: conversations as unknown as ConversationService,
      wakeMember: vi.fn(),
      createRun,
      organizationId: orgId,
      fromMemberId: caller.id,
      to: target.id,
      message: 'review this',
      runId: 'run-1',
      timeoutMs: 1,
      pollIntervalMs: 0,
    });

    expect(result.status).toBe('timed_out');
  });

  it('suspends the timeout countdown while the alert is queued', async () => {
    const { repo, conversations, createRun, delegateMessage } = repoFixture({ runs: [] });

    // Enqueue the pending member alert
    enqueuePendingMemberAlert({
      organizationId: orgId,
      memberId: target.id,
      threadId: 'dm:agent-1:agent-2',
      channelId: 'dm:agent-1:agent-2',
      messageId: delegateMessage.id,
      byMemberId: caller.id,
      reason: 'dm',
      wakeReason: 'dm',
    });

    // Clear the pending alert queue after 15ms
    setTimeout(() => {
      clearPendingMemberAlertsForTests();
    }, 15);

    const result = await runAgentDelegateTurn({
      repo: repo as unknown as ApiRepository,
      conversations: conversations as unknown as ConversationService,
      wakeMember: vi.fn(),
      createRun,
      organizationId: orgId,
      fromMemberId: caller.id,
      to: target.id,
      message: 'please check this',
      runId: 'run-1',
      timeoutMs: 10,
      pollIntervalMs: 5,
    });

    // Timeout begins ticking only after the queue is drained at 15ms. 
    // It should time out at 10ms + 15ms = 25ms total, verifying timeout suspension.
    expect(result.status).toBe('timed_out');
  });
});
