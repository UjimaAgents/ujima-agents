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

  it('allows observer read access to agent-only dm threads without granting write access', () => {
    const repo = createRepo();
    const agentA = MemberSchema.parse({
      id: 'agent-1',
      organizationId: 'org-1',
      name: 'Ava',
      kind: 'agent',
      roleName: 'assistant',
      presence: 'offline',
    });
    const agentB = MemberSchema.parse({
      id: 'agent-2',
      organizationId: 'org-1',
      name: 'Bo',
      kind: 'agent',
      roleName: 'assistant',
      presence: 'offline',
    });
    const human = MemberSchema.parse({
      id: 'human-1',
      organizationId: 'org-1',
      name: 'Owner',
      kind: 'human',
      roleName: 'owner',
      presence: 'offline',
    });
    repo.saveMember(agentA);
    repo.saveMember(agentB);
    repo.saveMember(human);

    const threadId = ensureDirectMessageConversation(repo, 'org-1', agentA, agentB);
    const conversations = new ConversationService(repo, { emit: () => undefined });

    expect(() => conversations.requireThreadAccess('org-1', threadId, human.id, 'read')).not.toThrow();
    expect(() => conversations.requireThreadAccess('org-1', threadId, human.id)).toThrow(
      /Forbidden/,
    );
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
    setChannelMemberMode: () => undefined,
    getChannelMemberMode: () => null,
    listChannelMemberModes: () => [],
    listChannelMemberModesForChannel: () => [],
    deleteChannelMemberMode: () => undefined,
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
