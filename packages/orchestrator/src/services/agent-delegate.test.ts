import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberSchema, MessageSchema, type Message, type RunState } from '@ujima/shared';
import { runAgentDelegateTurn } from './index.js';
import { agentDelegateTool } from '../tools/agent-delegate.js';
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
  const members = new Map<string, typeof caller>([
    [caller.id, caller],
    [target.id, target],
  ]);
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
    listMembers: vi.fn(() => [...members.values()]),
    getMember: vi.fn((_: string, memberId: string) => members.get(memberId) ?? null),
    saveMember: vi.fn((member: typeof caller) => {
      members.set(member.id, member);
      return member;
    }),
    updateMessage: vi.fn((next: Message) => {
      const index = messages.findIndex((item) => item.id === next.id);
      if (index >= 0) messages[index] = next;
      return next;
    }),
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
        delegate: expect.objectContaining({ kind: 'explorer', status: 'queued' }),
      }),
    }));
    expect(repo.updateMessage).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        delegate: expect.objectContaining({ id: 'delegate-1', kind: 'explorer', status: 'running' }),
      }),
    }));
  });

  it('creates and retires a temp agent after the child task is terminal', async () => {
    const { repo, conversations, createRun } = repoFixture();
    const wakeMember = vi.fn();

    const result = await runAgentDelegateTurn({
      repo: repo as unknown as ApiRepository,
      conversations: conversations as unknown as ConversationService,
      wakeMember,
      createRun,
      organizationId: orgId,
      fromMemberId: caller.id,
      message: '   ',
      runId: 'run-1',
    });

    expect(result).toMatchObject({
      status: 'no_reply',
      agent: 'Delegate',
    });
    expect(repo.saveMember).toHaveBeenCalledTimes(2);
    expect(repo.saveMember).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        name: 'Delegate',
        roleName: '@delegate/worker',
      }),
    );
    expect(repo.saveMember).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        retiredAt: expect.any(String),
      }),
    );
    expect(wakeMember).toHaveBeenCalledTimes(1);
  });

  it('does not retire a temp agent immediately for non-blocking dispatch', async () => {
    const { repo, conversations, createRun } = repoFixture();

    const result = await runAgentDelegateTurn({
      repo: repo as unknown as ApiRepository,
      conversations: conversations as unknown as ConversationService,
      wakeMember: vi.fn(),
      createRun,
      organizationId: orgId,
      fromMemberId: caller.id,
      message: 'check this later',
      runId: 'run-1',
      mode: 'non_blocking',
    });

    expect(result.status).toBe('dispatched');
    expect(repo.saveMember).toHaveBeenCalledTimes(1);
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

  it('unblocks the parent when the delegated run waits for human input', async () => {
    const waitingRun = {
      id: 'delegate-run-1',
      organizationId: orgId,
      agentId: target.id,
      threadId: 'dm:agent-1:agent-2',
      status: 'waiting_for_approval',
      step: 'waiting_for_approval',
      summary: 'Waiting for approval',
      startedAt: '2026-05-31T10:00:00.000Z',
      sourceMessageId: 'delegate-1',
    } as RunState;
    const { repo, conversations, createRun } = repoFixture({ activeRun: waitingRun, runs: [waitingRun] });

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
      status: 'waiting_for_approval',
      run_status: 'waiting_for_approval',
      error: 'Waiting for approval',
    });
  });

  it('agent.delegate spawn waits for all child task results', async () => {
    const delegateAgentTurn = vi.fn(async (input: { index?: number }) => ({
      status: 'completed' as const,
      agent: target.name,
      agent_id: target.id,
      thread_id: 'dm:agent-1:agent-2',
      message_id: `delegate-${input.index}`,
      delegate_index: input.index,
      reply_id: `reply-${input.index}`,
      reply_content: `done-${input.index}`,
    }));

    const result = await agentDelegateTool.execute({
      invocation: {
        organizationId: orgId,
        runId: 'run-1',
        memberId: caller.id,
        toolCallId: 'tool-1',
        toolId: 'agent.delegate',
        action: 'execute',
        resourceType: 'mcp',
        input: {
          action: 'spawn',
          delegates: [
            { to: target.id, message: 'one' },
            { to: target.id, message: 'two' },
            { to: target.id, message: 'three' },
          ],
        },
      } as never,
      repo: {
        getRun: () => ({
          id: 'run-1',
          organizationId: orgId,
          agentId: caller.id,
          threadId: 'thread-1',
          status: 'running',
          step: 'running',
          summary: '',
          startedAt: '2026-05-31T10:00:00.000Z',
        }),
        saveRun: vi.fn((run) => run),
      } as never,
      delegateAgentTurn,
    } as never);

    expect(delegateAgentTurn).toHaveBeenCalledTimes(3);
    expect(delegateAgentTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({ index: 0, mode: 'blocking' }));
    expect(delegateAgentTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({ index: 1, mode: 'blocking' }));
    expect(delegateAgentTurn).toHaveBeenNthCalledWith(3, expect.objectContaining({ index: 2, mode: 'blocking' }));
    expect(result).toMatchObject({
      status: 'completed',
      delegate_ids: ['delegate-0', 'delegate-1', 'delegate-2'],
      details: [
        expect.objectContaining({ delegate_index: 0, reply_content: 'done-0' }),
        expect.objectContaining({ delegate_index: 1, reply_content: 'done-1' }),
        expect.objectContaining({ delegate_index: 2, reply_content: 'done-2' }),
      ],
    });
  });

});
