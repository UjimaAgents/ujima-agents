import { describe, expect, it } from 'vitest';
import {
  ChannelSchema,
  ConversationThreadSchema,
  MemberSchema,
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
      if (hasMore) rows.shift();
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
    },
  });

  return {
    alerts,
    channel,
    emits,
    members,
    organization,
    repo,
    savedMessages,
    savedMentions,
    service,
    thread,
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

  it('skips alert fanout for ignored direct messages', async () => {
    const { alerts, emits, savedMessages, service } = createConversationFixture();

    const message = await service.sendDirectMessage({
      organizationId: 'org-1',
      senderId: 'human-1',
      recipientId: 'agent-1',
      content: 'private note',
      ignore: true,
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(message.channelId).toMatch(/^dm:/);
    expect(savedMessages).toHaveLength(1);
    expect(alerts).toEqual([]);
    expect(emits.some((entry) => entry.event === SocketEventNames.memberAlerted)).toBe(false);
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

  it('skips DM wake fanout when the message is exactly "Acknowledged."', async () => {
    const { alerts, service } = createConversationFixture();

    const message = await service.sendDirectMessage({
      organizationId: 'org-1',
      senderId: 'agent-1',
      recipientId: 'agent-2',
      content: 'Acknowledged.',
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(message.channelId).toMatch(/^dm:/);
    expect(alerts).toEqual([]);
  });

  it('wakes the other agent when "Acknowledged." has extra text after it', async () => {
    const { alerts, service } = createConversationFixture();

    await service.sendDirectMessage({
      organizationId: 'org-1',
      senderId: 'agent-1',
      recipientId: 'agent-2',
      content: 'Acknowledged. What is the deadline for the API?',
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(alerts).toEqual(['agent-2']);
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

  it('formats self-note reads with readable timestamps', async () => {
    const { service } = createConversationFixture();
    service.sendSelfNote({
      organizationId: 'org-1',
      memberId: 'agent-1',
      body: 'Decision: ship with compaction.',
    });
    const page = await service.readChannel({
      organizationId: 'org-1',
      memberId: 'agent-1',
      channelId: 'self:agent-1',
    });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.content).toMatch(
      /^\[[A-Za-z]+,\s[A-Za-z]+\s\d{1,2},\s\d{4}\sat\s\d{1,2}:\d{2}\s(?:AM|PM)\]/,
    );
    expect(page.data[0]?.content).toContain('Decision: ship with compaction.');
  });

  it('keeps self-channel private to the owner', async () => {
    const { service } = createConversationFixture();
    await expect(
      service.readChannel({
        organizationId: 'org-1',
        memberId: 'agent-2',
        channelId: 'self:agent-1',
      }),
    ).rejects.toThrow('Channel not found: self:agent-1');
  });

  it('compacts old self notes after threshold overflow', async () => {
    const { repo, service } = createConversationFixture();
    for (let i = 1; i <= 151; i += 1) {
      service.sendSelfNote({
        organizationId: 'org-1',
        memberId: 'agent-1',
        body: `note-${i}`,
      });
    }

    const stored = repo.listChannelMessages('org-1', 'self:agent-1', { limit: 1_000 });
    const compacted = stored.data.filter((message) =>
      message.content.startsWith('[[SELF_NOTE_COMPACTED_V1]]'),
    );
    const summaries = stored.data.filter((message) =>
      message.content.startsWith('[[SELF_NOTE_SUMMARY_V1]]'),
    );
    expect(compacted.length).toBeGreaterThanOrEqual(35);
    expect(summaries.length).toBe(1);

    const visible = await service.readChannel({
      organizationId: 'org-1',
      memberId: 'agent-1',
      channelId: 'self:agent-1',
      limit: 1_000,
    });
    expect(visible.data.every((message) => !message.content.includes('SELF_NOTE_COMPACTED_V1'))).toBe(
      true,
    );
    expect(visible.data.some((message) => message.content.startsWith('[[SELF_NOTE_SUMMARY_V1]]'))).toBe(false);
    expect(visible.data.some((message) => message.content.includes('note-151'))).toBe(true);
  });

  it('keeps newer self notes visible even when a summary exists', async () => {
    const { service } = createConversationFixture();
    for (let i = 1; i <= 151; i += 1) {
      service.sendSelfNote({
        organizationId: 'org-1',
        memberId: 'agent-1',
        body: `initial-${i}`,
      });
    }
    service.sendSelfNote({
      organizationId: 'org-1',
      memberId: 'agent-1',
      body: 'Override: use the latest scope decision.',
    });

    const visible = await service.readChannel({
      organizationId: 'org-1',
      memberId: 'agent-1',
      channelId: 'self:agent-1',
      limit: 1_000,
    });
    const joined = visible.data.map((message) => message.content).join('\n');
    expect(joined).not.toContain('SELF_NOTE_SUMMARY_V1');
    expect(joined).toContain('Override: use the latest scope decision.');
  });

  it('keeps a single rolling summary across paginated self-note history', async () => {
    const { repo, service } = createConversationFixture();
    for (let i = 1; i <= 260; i += 1) {
      service.sendSelfNote({
        organizationId: 'org-1',
        memberId: 'agent-1',
        body: `history-${i}`,
      });
    }

    const stored = repo.listChannelMessages('org-1', 'self:agent-1', { limit: 1_000 });
    const summaries = stored.data.filter((message) =>
      message.content.startsWith('[[SELF_NOTE_SUMMARY_V1]]'),
    );
    const compacted = stored.data.filter((message) =>
      message.content.startsWith('[[SELF_NOTE_COMPACTED_V1]]'),
    );
    expect(summaries).toHaveLength(1);
    expect(compacted.length).toBeGreaterThan(35);

    const visible = await service.readChannel({
      organizationId: 'org-1',
      memberId: 'agent-1',
      channelId: 'self:agent-1',
      limit: 1_000,
    });
    const joined = visible.data.map((message) => message.content).join('\n');
    expect(joined).toContain('history-260');
    expect(joined).not.toContain('SELF_NOTE_SUMMARY_V1');
    expect(joined.includes('SELF_NOTE_COMPACTED_V1')).toBe(false);
  });

  it('summarizes a conversation while keeping the recent raw window visible', async () => {
    const { service } = createConversationFixture();
    for (let i = 1; i <= 20; i += 1) {
      service.sendMessage({
        organizationId: 'org-1',
        threadId: 'general',
        channelId: 'general',
        senderId: 'human-1',
        content: `general-${String(i).padStart(2, '0')}`,
      });
    }

    const result = service.archiveConversation({
      organizationId: 'org-1',
      threadId: 'general',
      memberId: 'human-1',
      mode: 'summarize',
    });

    expect(result.summaryMessage?.content.startsWith('[[CONVERSATION_SUMMARY_V1]]')).toBe(true);

    const visible = await service.readChannel({
      organizationId: 'org-1',
      memberId: 'human-1',
      channelId: 'general',
      limit: 1_000,
    });
    const joined = visible.data.map((message) => message.content).join('\n');
    expect(joined).toContain('general-20');
    expect(joined).toContain('[[CONVERSATION_SUMMARY_V1]]');
    expect(joined).not.toContain('[[CONVERSATION_COMPACTED_V1]]');
  });

  it('auto-compacts a conversation after 150 messages', async () => {
    const { repo, service } = createConversationFixture();
    for (let i = 1; i <= 151; i += 1) {
      service.sendMessage({
        organizationId: 'org-1',
        threadId: 'general',
        channelId: 'general',
        senderId: 'human-1',
        content: `auto-${i}`,
      });
    }

    const stored = repo.listChannelMessages('org-1', 'general', { limit: 1_000 });
    expect(stored.data.some((message) => message.content.startsWith('[[CONVERSATION_SUMMARY_V1]]'))).toBe(
      true,
    );
    expect(stored.data.some((message) => message.content.startsWith('[[CONVERSATION_COMPACTED_V1]]'))).toBe(
      true,
    );
  });

  it('archives and clears a conversation from the visible feed', async () => {
    const { service } = createConversationFixture();
    for (let i = 1; i <= 4; i += 1) {
      service.sendMessage({
        organizationId: 'org-1',
        threadId: 'general',
        channelId: 'general',
        senderId: 'human-1',
        content: `cleanup-${i}`,
      });
    }

    const result = service.archiveConversation({
      organizationId: 'org-1',
      threadId: 'general',
      memberId: 'human-1',
      mode: 'clear',
    });

    expect(result.summaryMessage?.content.startsWith('[[CONVERSATION_ARCHIVE_V1]]')).toBe(true);

    const visible = await service.readChannel({
      organizationId: 'org-1',
      memberId: 'human-1',
      channelId: 'general',
      limit: 1_000,
    });
    expect(visible.data).toHaveLength(1);
    expect(visible.data[0]?.kind).toBe('system');
    expect(visible.data[0]?.content.startsWith('[[CONVERSATION_ARCHIVE_V1]]')).toBe(true);
  });

  it('does not wake participants when a conversation is summarized', async () => {
    const { alerts, service } = createConversationFixture();
    for (let i = 1; i <= 20; i += 1) {
      await service.sendDirectMessage({
        organizationId: 'org-1',
        senderId: 'human-1',
        recipientId: 'agent-1',
        content: `dm-${i}`,
      });
    }
    alerts.splice(0, alerts.length);

    service.archiveConversation({
      organizationId: 'org-1',
      threadId: 'dm:agent-1:human-1',
      memberId: 'human-1',
      mode: 'summarize',
    });

    expect(alerts).toHaveLength(0);
    const visible = await service.readChannel({
      organizationId: 'org-1',
      memberId: 'human-1',
      channelId: 'dm:agent-1:human-1',
      limit: 1_000,
    });
    expect(visible.data.some((message) => message.content.includes('CONVERSATION_SUMMARY_V1'))).toBe(true);
  });
});
