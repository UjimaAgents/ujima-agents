import { describe, expect, it } from 'vitest';
import {
  ChannelSchema,
  ConversationThreadSchema,
  MemberSchema,
  MessageSchema,
  OrganizationSchema,
  SocketEventNames,
  decodeCursor,
  encodeCursor,
} from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import { ConversationService } from './conversation.js';

function createConversationFixture() {
  const organization = OrganizationSchema.parse({
    id: 'org-1',
    name: 'Org',
    workspace: { root: '/workspace', roleScopes: {} },
    organizationChart: { reportsTo: {} },
  });
  const members = [
    MemberSchema.parse({
      id: 'human-1',
      organizationId: organization.id,
      name: 'Alex',
      kind: 'human',
      roleName: 'lead',
      presence: 'offline',
    }),
    MemberSchema.parse({
      id: 'agent-1',
      organizationId: organization.id,
      name: 'Mia',
      kind: 'agent',
      roleName: 'designer',
      presence: 'online',
    }),
    MemberSchema.parse({
      id: 'agent-2',
      organizationId: organization.id,
      name: 'Noah',
      kind: 'agent',
      roleName: 'writer',
      presence: 'online',
    }),
  ];
  const channel = ChannelSchema.parse({
    id: 'general',
    organizationId: organization.id,
    name: 'general',
    kind: 'general',
    topic: '',
    memberIds: members.map((member) => member.id),
    createdAt: '2026-05-03T10:00:00.000Z',
  });
  const thread = ConversationThreadSchema.parse({
    id: 'general',
    organizationId: organization.id,
    channelId: channel.id,
    memberIds: channel.memberIds,
    title: 'general',
    createdAt: '2026-05-03T10:00:00.000Z',
  });

  const savedMessages: unknown[] = [];
  const savedMentions: { messageId: string; memberId: string }[] = [];
  const alerts: string[] = [];
  const alertWakeReasons: { memberId: string; wakeReason: string }[] = [];
  const emits: { event: string }[] = [];
  const channels = new Map([[channel.id, channel]]);
  const threads = new Map([[thread.id, thread]]);
  const messagesById = new Map<string, any>();

  function listByChannel(channelId: string) {
    return [...messagesById.values()]
      .filter((message) => message.organizationId === organization.id && message.channelId === channelId)
      .sort((left, right) => {
        const byTime = left.createdAt.localeCompare(right.createdAt);
        return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
      });
  }

  const repo = {
    getOrganization: () => organization,
    getWorkspaceMember: () => null,
    listWorkspaceMembers: () => [],
    getMember: (_organizationId: string, memberId: string) =>
      members.find((member) => member.id === memberId) ?? null,
    listMembers: () => members,
    listMessages: (_organizationId: string, threadId: string) => ({
      data: [...messagesById.values()].filter((message) => message.threadId === threadId),
      hasMore: false,
    }),
    getProviderCredential: () => null,
    getChannel: (_organizationId: string, channelId: string) => channels.get(channelId) ?? null,
    listAllChannels: () => [...channels.values()],
    listChannels: () => ({ data: [...channels.values()], hasMore: false }),
    saveChannel: (value: typeof channel) => {
      channels.set(value.id, value);
      return value;
    },
    setChannelMembers: () => undefined,
    setChannelMemberMode: () => undefined,
    getChannelMemberMode: () => null,
    listChannelMemberModes: () => [],
    listChannelMemberModesForChannel: () => [],
    deleteChannelMemberMode: () => undefined,
    getThread: (_organizationId: string, threadId: string) => threads.get(threadId) ?? null,
    ensureThread: (value: typeof thread) => {
      threads.set(value.id, value);
      return value;
    },
    getMessage: (_organizationId: string, messageId: string) => messagesById.get(messageId) ?? null,
    listChannelMessages: (
      _organizationId: string,
      channelId: string,
      options?: { cursor?: string; since?: string; limit?: number },
    ) => {
      const limit = options?.limit ?? 50;
      let filtered = listByChannel(channelId);
      if (options?.since) {
        filtered = filtered.filter((message) => message.createdAt >= options.since!);
      }
      const decoded = decodeCursor(options?.cursor);
      if (decoded) {
        filtered = filtered.filter((message) => {
          if (message.createdAt < decoded.timestamp) return true;
          if (message.createdAt > decoded.timestamp) return false;
          if (!decoded.id) return false;
          return message.id < decoded.id;
        });
      }
      const desc = [...filtered].sort((left, right) => {
        const byTime = right.createdAt.localeCompare(left.createdAt);
        return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
      });
      const rows = desc.slice(0, limit + 1);
      const hasMore = rows.length > limit;
      if (hasMore) rows.pop();
      const data = rows.reverse();
      const head = hasMore ? data[0] : undefined;
      return {
        data,
        hasMore,
        nextCursor: head ? encodeCursor(head.createdAt, head.id) : undefined,
      };
    },
    searchChannelMessages: () => ({ data: [], hasMore: false }),
    saveMessage: (message: unknown) => {
      savedMessages.push(message);
      const typed = message as { id: string };
      messagesById.set(typed.id, message);
      return message;
    },
    updateMessage: (message: unknown) => {
      const typed = message as { id: string };
      messagesById.set(typed.id, message);
      return message;
    },
    replaceMessageMentions: (messageId: string, mentions: { messageId: string; memberId: string }[]) => {
      savedMentions.splice(0, savedMentions.length, ...mentions);
      return mentions;
    },
    listMessageMentions: () => savedMentions,
    deleteMessageMentions: () => undefined,
    getRun: () => null,
    saveRun: (value: unknown) => value,
    listRuns: () => ({ data: [], hasMore: false }),
    saveTaskSession: (value: unknown) => value,
    getTaskSession: () => null,
    getTaskSessionBySlug: () => null,
    getTaskSessionByChannel: () => null,
    listTaskSessions: () => ({ data: [], hasMore: false }),
    updateTaskSessionStatus: () => null,
    saveApproval: (value: unknown) => value,
    getApproval: () => null,
    resolveApproval: () => null,
    listPendingApprovals: () => [],
    saveAuditEvent: (value: unknown) => value,
    transaction: <T>(fn: () => T) => fn(),
    saveSpirit: (value: unknown) => value,
    getSpirit: () => null,
    getSpiritByTriple: () => null,
    listSpiritsForSession: () => [],
    listActiveSpiritsForMember: () => [],
    saveTodo: (value: unknown) => value,
    getTodo: () => null,
    listTodosForSession: () => [],
    updateTodoStatus: () => null,
    deleteMessages: () => undefined,
    saveOrganization: (value: unknown) => value,
    getLatestOrganization: () => null,
    listOrganizations: () => [],
    listOrganizationsWithSignIn: () => [],
    saveWorkspaceSetting: () => undefined,
    getWorkspaceSetting: () => null,
    findOrganizationIdByWorkspaceSetting: () => null,
    saveProviderCredential: () => undefined,
    deleteProviderCredential: () => undefined,
    listProviderCredentials: () => ({}),
    saveConfigFieldOwnership: (value: unknown) => value,
    getConfigFieldOwnership: () => null,
    listConfigFieldOwnership: () => [],
    saveMember: (value: unknown) => value,
    saveWorkspaceMember: (value: unknown) => value,
    saveAuthUser: (value: unknown) => value,
    getAuthUserById: () => null,
    getAuthUserByMember: () => null,
  } as unknown as ApiRepository;

  const service = new ConversationService(repo, {
    emit(event: string) {
      emits.push({ event });
    },
  } as never, {
    onMemberAlerted: (input) => {
      alerts.push(input.memberId);
      alertWakeReasons.push({ memberId: input.memberId, wakeReason: input.wakeReason });
    },
    summarizeConversation: async (messages, mode) =>
      `${mode === 'archive' ? '[[CONVERSATION_ARCHIVE_V1]]' : '[[CONVERSATION_SUMMARY_V2]]'} # AI summarized ${messages.length} messages.`,
    contextWindowTokens: () => 1_000,
  });

  return {
    alerts,
    alertWakeReasons,
    channel,
    emits,
    members,
    organization,
    repo,
    threads,
    savedMessages,
    savedMentions,
    service,
    thread,
    channels,
  };
}

describe('ConversationService @all mentions', () => {
  it('fans out @all to every member in the channel', async () => {
    const { alerts, emits, savedMessages, savedMentions, service, thread } =
      createConversationFixture();

    const message = service.sendMessage({
      organizationId: 'org-1',
      threadId: thread.id,
      channelId: 'general',
      senderId: 'human-1',
      content: 'Team, please review @all',
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(message.mentions.sort()).toEqual(['agent-1', 'agent-2', 'human-1']);
    expect(savedMessages).toHaveLength(1);
    expect(savedMentions.map((mention) => mention.memberId).sort()).toEqual([
      'agent-1',
      'agent-2',
      'human-1',
    ]);
    expect(alerts.sort()).toEqual(['agent-1', 'agent-2']);
    expect(emits.some((entry) => entry.event === SocketEventNames.memberAlerted)).toBe(true);
  });

  // Regression: `@all` is treated as N personal mentions of every
  // channel member. Each agent gets wakeReason='mention' so the
  // mandatory-reply enforcement (palette layer in ai-service.ts)
  // forces them to engage.
  it('uses wakeReason="mention" for @all fanouts (mandatory reply enforced)', async () => {
    const { alertWakeReasons, service, thread } = createConversationFixture();

    service.sendMessage({
      organizationId: 'org-1',
      threadId: thread.id,
      channelId: 'general',
      senderId: 'human-1',
      content: 'Hey @all what are you working on?',
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(alertWakeReasons.length).toBeGreaterThan(0);
    for (const alert of alertWakeReasons) {
      expect(alert.wakeReason).toBe('mention');
    }
  });

  it('alerts an agent recipient for direct messages', async () => {
    const { alerts, emits, savedMessages, savedMentions, service } =
      createConversationFixture();

    const message = await service.sendDirectMessage({
      organizationId: 'org-1',
      senderId: 'human-1',
      recipientId: 'agent-1',
      content: 'Hey Mia, can you take a look?',
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(message.channelId).toMatch(/^dm:/);
    expect(savedMessages).toHaveLength(1);
    expect(savedMentions).toHaveLength(0);
    expect(alerts).toEqual(['agent-1']);
    expect(emits.some((entry) => entry.event === SocketEventNames.memberAlerted)).toBe(true);
  });

  it('alerts the other agent when an agent publishes a DM reply directly', async () => {
    const { alerts, repo, service } = createConversationFixture();
    const dmChannel = ChannelSchema.parse({
      id: 'dm:agent-1:agent-2',
      organizationId: 'org-1',
      name: 'Mia / Noah',
      kind: 'dm',
      topic: '',
      memberIds: ['agent-1', 'agent-2'],
      createdAt: '2026-05-07T00:00:00.000Z',
    });
    const dmThread = ConversationThreadSchema.parse({
      id: dmChannel.id,
      organizationId: 'org-1',
      channelId: dmChannel.id,
      memberIds: dmChannel.memberIds,
      title: dmChannel.name,
      createdAt: '2026-05-07T00:00:00.000Z',
    });
    repo.saveChannel(dmChannel);
    repo.ensureThread(dmThread);

    service.publishMessage({
      id: 'msg-1',
      organizationId: 'org-1',
      threadId: dmThread.id,
      channelId: dmChannel.id,
      senderId: 'agent-1',
      senderKind: 'agent',
      kind: 'agent',
      content: 'Replying here.',
      createdAt: '2026-05-07T00:00:01.000Z',
      mentions: [],
      toolCalls: [],
      attachments: [],
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(alerts).toEqual(['agent-2']);
  });

  it('skips DM wake fanout when the message is a completed channel.handoff', async () => {
    const { alerts, service } = createConversationFixture();

    const message = await service.sendDirectMessage({
      organizationId: 'org-1',
      senderId: 'agent-1',
      recipientId: 'agent-2',
      content: 'Wrapping up.\n\n[DONE]',
      metadata: {
        handoff: { from: 'agent-1', to: 'agent-2', reason: 'wrap-up', complete: true },
      } as unknown as { goalMode?: boolean },
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(message.channelId).toMatch(/^dm:/);
    expect(alerts).toEqual([]);
  });

  it('wakes the other agent on a normal DM reply (no handoff metadata)', async () => {
    const { alerts, service } = createConversationFixture();

    await service.sendDirectMessage({
      organizationId: 'org-1',
      senderId: 'agent-1',
      recipientId: 'agent-2',
      content: 'What is the deadline for the API?',
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(alerts).toEqual(['agent-2']);
  });

  it('demotes repeated agent-agent DM wakes quickly so the next agent can pass', async () => {
    const { alertWakeReasons, service } = createConversationFixture();

    await service.sendDirectMessage({
      organizationId: 'org-1',
      senderId: 'agent-1',
      recipientId: 'agent-2',
      content: 'Can you review the plan?',
    });
    await service.sendDirectMessage({
      organizationId: 'org-1',
      senderId: 'agent-2',
      recipientId: 'agent-1',
      content: 'I reviewed it. Looks fine.',
    });
    await service.sendDirectMessage({
      organizationId: 'org-1',
      senderId: 'agent-1',
      recipientId: 'agent-2',
      content: 'Thanks, anything else?',
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(alertWakeReasons).toEqual([
      { memberId: 'agent-2', wakeReason: 'dm' },
      { memberId: 'agent-1', wakeReason: 'dm' },
      { memberId: 'agent-2', wakeReason: 'channel-read' },
    ]);
  });

  it('resolves multi-word mentions in message content', async () => {
    const { alerts, repo, service, thread } = createConversationFixture();
    
    // Add a member with a multi-word name
    const quinnMason = MemberSchema.parse({
      id: 'agent-quinn',
      organizationId: 'org-1',
      name: 'Quinn Mason',
      kind: 'agent',
      roleName: 'tester',
      presence: 'online',
    });
    
    const members = [
      ...repo.listMembers('org-1'),
      quinnMason,
    ];
    repo.listMembers = () => members;
    repo.getMember = (_orgId, id) => members.find(m => m.id === id) ?? null;
    
    // Add member to channel
    const channel = repo.getChannel('org-1', 'general');
    if (!channel) throw new Error('expected general channel');
    channel.memberIds.push(quinnMason.id);

    const message = service.sendMessage({
      organizationId: 'org-1',
      threadId: thread.id,
      channelId: 'general',
      senderId: 'human-1',
      content: 'Hello @Quinn Mason and @Mia',
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(message.mentions).toContain('agent-quinn');
    expect(message.mentions).toContain('agent-1');
    expect(message.mentionNames).toContain('Quinn Mason');
    expect(alerts).toContain('agent-quinn');

    expect(alerts).toContain('agent-1');
  });

  it('auto-compacts a conversation after 500 messages', async () => {
    const { emits, repo, service } = createConversationFixture();
    service.publishMessage({
      id: 'rich-1',
      organizationId: 'org-1',
      threadId: 'general',
      channelId: 'general',
      senderId: 'agent-1',
      senderKind: 'agent',
      kind: 'agent',
      content: 'Rich turn before compaction.',
      reasoningContent: 'plan the next step',
      mentions: [],
      toolCalls: [
        {
          toolCallId: 'call-1',
          toolName: 'shell',
          args: { command: 'pwd' },
          result: { stdout: '/workspace\n' },
          isError: false,
        },
      ],
      attachments: [],
    });
    for (let i = 1; i <= 501; i += 1) {
      service.sendMessage({
        organizationId: 'org-1',
        threadId: 'general',
        channelId: 'general',
        senderId: 'human-1',
        content: `auto-${i}`,
      });
    }
    await new Promise((resolve) => setImmediate(resolve));

    const stored = repo.listChannelMessages('org-1', 'general', { limit: 1_000 });
    const summary = stored.data.find((message) => message.content.startsWith('[[CONVERSATION_SUMMARY_V2]]'));
    expect(summary).toBeTruthy();
    const compactedSource = stored.data.find((message) => message.metadata?.compactedInto === summary?.id);
    expect(compactedSource?.content).toBe('Rich turn before compaction.');
    expect(compactedSource?.reasoningContent).toBe('plan the next step');
    expect(compactedSource?.toolCalls).toHaveLength(1);
    expect(compactedSource?.metadata?.compactedInto).toBe(summary?.id);
    expect(stored.data.some((message) => message.metadata?.compactedInto)).toBe(true);
    expect(emits.filter((entry) => entry.event === SocketEventNames.channelMessage)).toHaveLength(503);
  });

});

describe('ConversationService channel thread bootstrap', () => {
  it('creates a missing thread when a visible channel is opened', async () => {
    const { repo, service, organization, channels, threads } = createConversationFixture();
    const channel = ChannelSchema.parse({
      id: 'channel-engineering',
      organizationId: organization.id,
      name: 'engineering',
      kind: 'general',
      topic: '',
      memberIds: [],
      createdAt: '2026-05-01T15:54:31.691Z',
    });
    channels.set(channel.id, channel);
    threads.delete(channel.id);

    const page = service.listMessages(organization.id, channel.id, undefined, undefined, 'human-1');

    expect(page.data).toHaveLength(0);
    expect(repo.getThread(organization.id, channel.id)).toMatchObject({
      id: channel.id,
      channelId: channel.id,
      title: channel.name,
    });
  });
});

// L5 — broad-wake (`alertChannelReaders`) must fire on human posts
// in public channels (`general` and `group`) and MUST bypass
// system-authored messages (kind system / senderId 'system').
// Otherwise the throttle-notification system message itself
// re-triggers broad-wake → infinite loop.
describe('ConversationService alertChannelReaders (L5)', () => {
  function withGroupChannel() {
    const fixture = createConversationFixture();
    const groupChannel = ChannelSchema.parse({
      id: 'design-group',
      organizationId: fixture.organization.id,
      name: 'design-group',
      kind: 'group',
      topic: '',
      memberIds: fixture.members.map((m) => m.id),
      createdAt: '2026-05-03T10:00:00.000Z',
    });
    fixture.channels.set(groupChannel.id, groupChannel);
    fixture.threads.set(groupChannel.id, ConversationThreadSchema.parse({
      id: groupChannel.id,
      organizationId: fixture.organization.id,
      channelId: groupChannel.id,
      memberIds: groupChannel.memberIds,
      title: 'design-group',
      createdAt: '2026-05-03T10:00:00.000Z',
    }));
    return { ...fixture, groupChannel };
  }

  it('wakes every non-sender agent on a human post in a group channel', async () => {
    const { alerts, service, groupChannel } = withGroupChannel();

    service.sendMessage({
      organizationId: 'org-1',
      threadId: groupChannel.id,
      channelId: groupChannel.id,
      senderId: 'human-1',
      content: 'Heads up everyone',
    });

    await new Promise((resolve) => setImmediate(resolve));
    // Both agents in the channel wake; the human sender is skipped.
    expect(alerts.sort()).toEqual(['agent-1', 'agent-2']);
  });

  it('does NOT broad-wake on system messages (kind=system bypass)', async () => {
    const { alerts, service, groupChannel } = withGroupChannel();

    // System-authored throttle notification (the exact shape that
    // would otherwise feedback-loop the broad-wake).
    service.publishMessage(
      MessageSchema.parse({
        id: 'sys-throttle-1',
        organizationId: 'org-1',
        threadId: groupChannel.id,
        channelId: groupChannel.id,
        senderId: 'system',
        senderKind: 'human',
        kind: 'system',
        content: 'member.alert_throttled: …',
        createdAt: '2026-05-03T10:00:00.000Z',
      }),
      [],
    );

    await new Promise((resolve) => setImmediate(resolve));
    expect(alerts).toEqual([]);
  });

});

// L8 — Smart parent-mention inheritance. Only `parent.senderId` is
// re-included on a reply; transitive `parent.mentions` are dropped.
// Without this, threads ping-pong-amplify mentions every step.
describe('ConversationService smart parent-mention inheritance (L8)', () => {
  it('inherits only the parent sender, not the parent transitive mentions', async () => {
    const { service, repo } = createConversationFixture();

    // Parent message: human-1 sends, tags agent-1 AND agent-2.
    const parent = service.sendMessage({
      organizationId: 'org-1',
      threadId: 'general',
      channelId: 'general',
      senderId: 'human-1',
      content: 'Hey @Mia and @Noah, look at this.',
    });
    await new Promise((resolve) => setImmediate(resolve));

    // Agent-1 replies with substantive content. Parent.mentions
    // = [agent-1, agent-2] but the new behaviour should ONLY carry
    // parent.senderId = human-1. NOTE: vacuous acks ("Got it.")
    // are intentionally exempt from inheritance now (Bet 3 — kills
    // the echo loop); use a content-bearing reply to test
    // inheritance.
    const reply = service.sendMessage({
      organizationId: 'org-1',
      threadId: 'general',
      channelId: 'general',
      senderId: 'agent-1',
      content: 'Looking at the code now — flagged a race in the wake fanout.',
      parentMessageId: parent.id,
    });
    await new Promise((resolve) => setImmediate(resolve));

    // Reply's explicit mention set: only the parent sender (human-1).
    // agent-2 (who was tagged in parent) is NOT re-included.
    const replyMentions = repo
      .listMessageMentions(reply.id)
      .map((mention) => mention.memberId)
      .sort();
    expect(replyMentions).toEqual(['human-1']);
  });

  // Bet 3 — vacuous acks ("Got it", "Understood", "I'll await")
  // intentionally DO NOT inherit the parent sender as a mention.
  // Without this, two agents bouncing acknowledgements at each
  // other would auto-re-mention on every turn and the loop would
  // never terminate.
  it('does NOT inherit the parent sender when the reply is a vacuous acknowledgement', async () => {
    const { service, repo } = createConversationFixture();

    const parent = service.sendMessage({
      organizationId: 'org-1',
      threadId: 'general',
      channelId: 'general',
      senderId: 'human-1',
      content: 'Please draft the BRD.',
    });
    await new Promise((resolve) => setImmediate(resolve));

    const reply = service.sendMessage({
      organizationId: 'org-1',
      threadId: 'general',
      channelId: 'general',
      senderId: 'agent-1',
      content: 'Understood. I will get on it.',
      parentMessageId: parent.id,
    });
    await new Promise((resolve) => setImmediate(resolve));

    const replyMentions = repo
      .listMessageMentions(reply.id)
      .map((mention) => mention.memberId);
    expect(replyMentions).toEqual([]);
  });
});
