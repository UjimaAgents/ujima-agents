import { describe, expect, it } from 'vitest';
import {
  ChannelSchema,
  ConversationThreadSchema,
  MemberSchema,
  OrganizationSchema,
  SocketEventNames,
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

  const repo = {
    getOrganization: () => organization,
    getWorkspaceMember: () => null,
    listWorkspaceMembers: () => [],
    getMember: (_organizationId: string, memberId: string) =>
      members.find((member) => member.id === memberId) ?? null,
    listMembers: () => members,
    listMessages: () => ({ data: [], hasMore: false }),
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
    getMessage: () => null,
    listChannelMessages: () => ({ data: [], hasMore: false }),
    searchChannelMessages: () => ({ data: [], hasMore: false }),
    saveMessage: (message: unknown) => {
      savedMessages.push(message);
      return message;
    },
    updateMessage: (message: unknown) => message,
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
    const channel = repo.getChannel('org-1', 'general')!;
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
});
