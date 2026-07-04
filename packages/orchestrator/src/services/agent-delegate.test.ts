import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberSchema, MessageSchema, type Message, type RunState } from '@ujima/shared';
import { runAgentDelegateTurn } from './index.js';
import { agentDelegateTool } from '../tools/agent-delegate.js';
import type { ApiRepository } from './repository-reader.js';
import type { ConversationService } from './conversation.js';
import { clearPendingThreadAlertsForTests } from './pending-member-alerts.js';

beforeEach(() => {
  clearPendingThreadAlertsForTests();
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

function repoFixture(
  options: {
    activeRun?: RunState | null;
    reply?: Message | null;
    runs?: RunState[];
    /**
     * Parent conversation context. Defaults to a DM (legacy behavior). Pass a
     * non-dm/self kind to exercise the channel-scoped delegation routing.
     */
    parentChannel?: { id: string; kind: string };
  } = {},
) {
  const messages: Message[] = [];
  const members = new Map<string, typeof caller>([
    [caller.id, caller],
    [target.id, target],
  ]);
  // The run the delegation originates from. Its thread resolves to the parent
  // channel, which drives the DM-vs-channel routing decision.
  const parentChannel = options.parentChannel ?? { id: 'dm:agent-1:agent-2', kind: 'dm' };
  const parentRun = {
    id: 'run-1',
    organizationId: orgId,
    agentId: caller.id,
    threadId: parentChannel.id,
    status: 'running',
    step: 'running',
    summary: '',
    startedAt: '2026-05-31T10:00:00.000Z',
  } as RunState;
  // The delegate run is correlated to the delegate by agentId + sourceMessageId.
  let delegateTargetId = target.id;
  const finishedRuns = (): RunState[] =>
    options.runs ?? ([{
      id: 'delegate-run-1',
      organizationId: orgId,
      agentId: delegateTargetId,
      threadId: 'dm:agent-1:agent-2',
      status: 'completed',
      step: 'completed',
      summary: 'completed',
      startedAt: '2026-05-31T10:00:00.000Z',
      endedAt: '2026-05-31T10:00:01.000Z',
      sourceMessageId: 'delegate-1',
    }] as RunState[]);
  const ensuredThreads: { id: string; channelId: string; memberIds: string[] }[] = [];
  const delegateMessage = message({
    id: 'delegate-1',
    senderId: caller.id,
    content: 'please check this',
  });
  // Faithful to the real sendMessage/sendDirectMessage: the returned (and
  // stored) message carries the metadata the caller passed in, so downstream
  // updateMessage / delegate-status transitions can read delegate.kind etc.
  const recordSeed = (metadata?: Record<string, unknown>): Message => {
    const seed = { ...delegateMessage, metadata } as Message;
    messages.push(seed);
    if (options.reply) messages.push(options.reply);
    return seed;
  };
  const repo = {
    listMembers: vi.fn(() => [...members.values()]),
    getMember: vi.fn((_: string, memberId: string) => members.get(memberId) ?? null),
    saveMember: vi.fn((member: typeof caller) => {
      members.set(member.id, member);
      if (member.roleName?.startsWith('@delegate/')) delegateTargetId = member.id;
      return member;
    }),
    getRun: vi.fn(() => parentRun),
    getThread: vi.fn((_: string, threadId: string) => ({
      id: threadId,
      channelId: parentChannel.id,
      memberIds: [caller.id, delegateTargetId],
    })),
    getChannel: vi.fn((_: string, channelId: string) =>
      channelId === parentChannel.id ? { id: parentChannel.id, kind: parentChannel.kind } : null,
    ),
    ensureThread: vi.fn((thread: { id: string; channelId: string; memberIds: string[] }) => {
      ensuredThreads.push(thread);
      return thread;
    }),
    getMessage: vi.fn((_: string, id: string) => messages.find((item) => item.id === id) ?? null),
    updateMessage: vi.fn((next: Message) => {
      const index = messages.findIndex((item) => item.id === next.id);
      if (index >= 0) messages[index] = next;
      return next;
    }),
    listMessages: vi.fn(() => ({ data: messages, hasMore: false })),
    findActiveRunForMemberThread: vi.fn(() => options.activeRun ?? null),
    listThreadRuns: vi.fn(() => ({ data: finishedRuns(), hasMore: false })),
  };
  const conversations = {
    sendDirectMessage: vi.fn((input: { metadata?: Record<string, unknown> }) => recordSeed(input.metadata)),
    sendMessage: vi.fn((input: { metadata?: Record<string, unknown> }) => {
      // The channel-scoped path posts the seed (delegate metadata) here and,
      // separately, the clickable marker pointer (delegateMarker metadata).
      if (input.metadata && 'delegate' in input.metadata) return recordSeed(input.metadata);
      return { ...delegateMessage, id: 'marker-1', metadata: input.metadata } as Message;
    }),
  };
  const createRun = vi.fn(async () => null);
  return { repo, conversations, delegateMessage, messages, createRun, ensuredThreads };
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

  it('routes a channel-originated delegation to a channel-scoped thread with a clickable marker', async () => {
    const { repo, conversations, ensuredThreads } = repoFixture({
      parentChannel: { id: 'channel-general', kind: 'general' },
    });
    const wakeMember = vi.fn();

    const result = await runAgentDelegateTurn({
      repo: repo as unknown as ApiRepository,
      conversations: conversations as unknown as ConversationService,
      wakeMember,
      createRun: vi.fn(async () => null),
      organizationId: orgId,
      fromMemberId: caller.id,
      to: target.id,
      message: 'investigate the channel issue',
      runId: 'run-1',
      mode: 'non_blocking',
    });

    // The delegation runs in a fresh thread tied to the parent channel — not a DM.
    expect(conversations.sendDirectMessage).not.toHaveBeenCalled();
    expect(ensuredThreads).toHaveLength(1);
    expect(ensuredThreads[0]).toMatchObject({
      channelId: 'channel-general',
      memberIds: [caller.id, target.id],
    });
    expect(ensuredThreads[0].id).not.toBe('dm:agent-1:agent-2');
    expect(result.thread_id).toBe(ensuredThreads[0].id);

    // A clickable pointer is posted into the parent channel feed.
    expect(conversations.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel-general',
        metadata: expect.objectContaining({
          delegateMarker: expect.objectContaining({
            kind: 'start',
            delegationThreadId: ensuredThreads[0].id,
            to: target.id,
          }),
        }),
      }),
    );

    // The delegate is woken as a channel mention, not a DM.
    expect(wakeMember).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: target.id, wakeReason: 'mention' }),
    );
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

  it('requires an existing target agent', async () => {
    const { repo, conversations, createRun } = repoFixture();

    await expect(
      runAgentDelegateTurn({
        repo: repo as unknown as ApiRepository,
        conversations: conversations as unknown as ConversationService,
        wakeMember: vi.fn(),
        createRun,
        organizationId: orgId,
        fromMemberId: caller.id,
        message: 'check this later',
        runId: 'run-1',
        mode: 'non_blocking',
      }),
    ).rejects.toThrow(/target is required/i);

    expect(repo.saveMember).not.toHaveBeenCalled();
    expect(conversations.sendDirectMessage).not.toHaveBeenCalled();
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
      task_ids: ['delegate-0', 'delegate-1', 'delegate-2'],
      details: [
        expect.objectContaining({ delegate_index: 0, reply_content: 'done-0' }),
        expect.objectContaining({ delegate_index: 1, reply_content: 'done-1' }),
        expect.objectContaining({ delegate_index: 2, reply_content: 'done-2' }),
      ],
    });
  });

  it('agent.delegate start supports non_blocking execution', async () => {
    const delegateAgentTurn = vi.fn(async () => ({
      status: 'dispatched' as const,
      agent: target.name,
      agent_id: target.id,
      thread_id: 'dm:agent-1:agent-2',
      message_id: 'delegate-1',
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
          action: 'start',
          target: target.id,
          task: 'parallelize this',
          execution: 'non_blocking',
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

    expect(delegateAgentTurn).toHaveBeenCalledWith(expect.objectContaining({ mode: 'non_blocking' }));
    expect(result).toMatchObject({
      task_id: 'delegate-1',
      status: 'dispatched',
    });
  });

  it('agent.delegate status rejects missing task ids', async () => {
    await expect(agentDelegateTool.execute({
      invocation: {
        organizationId: orgId,
        runId: 'run-1',
        memberId: caller.id,
        toolCallId: 'tool-1',
        toolId: 'agent.delegate',
        action: 'execute',
        resourceType: 'mcp',
        input: {
          action: 'status',
        },
      } as never,
      repo: {} as never,
      getDelegateStatus: vi.fn(),
    } as never)).rejects.toThrow('status requires task_id or task_ids.');
  });

});
