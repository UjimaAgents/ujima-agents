import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberSchema, MessageSchema, type Message, type RunState } from '@ujima/shared';
import { runAgentDelegateTurn } from './index.js';
import type { ApiRepository } from './repository-reader.js';
import type { ConversationService } from './conversation.js';
import { clearPendingMemberAlertsForTests } from './pending-member-alerts.js';

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

  it('tags explorer delegates in metadata', async () => {
    const { repo, conversations, createRun } = repoFixture();

    await runAgentDelegateTurn({
      repo: repo as unknown as ApiRepository,
      conversations: conversations as unknown as ConversationService,
      wakeMember: vi.fn(),
      createRun,
      organizationId: orgId,
      fromMemberId: caller.id,
      to: target.name,
      message: 'inspect this',
      kind: 'explorer',
      runId: 'run-1',
      mode: 'non_blocking',
    });

    expect(conversations.sendDirectMessage).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        delegate: expect.objectContaining({ kind: 'explorer' }),
      }),
    }));
  });

  it('rejects self-delegation', async () => {
    const { repo, conversations, createRun } = repoFixture();
    repo.listMembers.mockReturnValue([caller]);

    await expect(
      runAgentDelegateTurn({
        repo: repo as unknown as ApiRepository,
        conversations: conversations as unknown as ConversationService,
        wakeMember: vi.fn(),
        createRun,
        organizationId: orgId,
        fromMemberId: caller.id,
        to: caller.id,
        message: 'split this into another turn',
        runId: 'run-1',
      }),
    ).rejects.toThrow(/cannot delegate to yourself/i);

    expect(conversations.sendDirectMessage).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
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

});
