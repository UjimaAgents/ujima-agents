import { describe, expect, it } from 'vitest';
import {
  ChannelSchema,
  MemberSchema,
  OrganizationSchema,
  type Channel,
  type ConversationThread,
  type Member,
} from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import { ConversationService } from './conversation.js';
import { ensureChannelThread, ensureDirectMessageConversation } from './member-channels.js';

describe('member-channels conversation provisioning', () => {
  it('creates a thread for a new group channel', () => {
    const repo = createRepo();
    const channel = ChannelSchema.parse({
      id: 'chan-1',
      organizationId: 'org-1',
      name: 'random',
      kind: 'group',
      topic: '',
      memberIds: [],
      createdAt: '2026-05-03T10:00:00.000Z',
    });
    repo.saveChannel(channel);
    ensureChannelThread(repo, 'org-1', channel);
    expect(repo.getThread('org-1', channel.id)).not.toBeNull();
  });

  it('creates dm channel and thread so verify passes before the first message', () => {
    const repo = createRepo();
    const human = MemberSchema.parse({
      id: 'human-1',
      organizationId: 'org-1',
      name: 'Owner',
      kind: 'human',
      roleName: 'owner',
      presence: 'offline',
    });
    const agent = MemberSchema.parse({
      id: 'agent-1',
      organizationId: 'org-1',
      name: 'Ava',
      kind: 'agent',
      roleName: 'assistant',
      presence: 'offline',
    });
    repo.saveMember(human);
    repo.saveMember(agent);

    const threadId = ensureDirectMessageConversation(repo, 'org-1', human, agent);
    expect(threadId).toBe('dm:agent-1:human-1');
    expect(repo.getChannel('org-1', threadId)?.kind).toBe('dm');

    const conversations = new ConversationService(repo, { emit: () => undefined });
    expect(() => conversations.requireThreadAccess('org-1', threadId, human.id)).not.toThrow();
  });
});

function createRepo(): ApiRepository {
  const organization = OrganizationSchema.parse({
    id: 'org-1',
    name: 'Org',
    workspace: { root: '/workspace', roleScopes: {} },
    organizationChart: { reportsTo: {} },
  });
  const channels = new Map<string, Channel>();
  const threads = new Map<string, ConversationThread>();
  const members = new Map<string, Member>();

  return {
    getOrganization: () => organization,
    getChannel: (_organizationId: string, channelId: string) => channels.get(channelId) ?? null,
    saveChannel: (channel: Channel) => {
      channels.set(channel.id, channel);
      return channel;
    },
    setChannelMembers: () => undefined,
    getThread: (_organizationId: string, threadId: string) => threads.get(threadId) ?? null,
    ensureThread: (thread: ConversationThread) => {
      threads.set(thread.id, thread);
      return thread;
    },
    getMember: (_organizationId: string, memberId: string) => members.get(memberId) ?? null,
    listMembers: () => [...members.values()],
    saveMember: (member: Member) => {
      members.set(member.id, member);
      return member;
    },
  } as unknown as ApiRepository;
}
