import type { AgentTeamHandle } from '@ujima/framework';
import { AGENT_KIND, ChannelSchema, type Channel, type Member } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';

type MemberRef = Pick<Member, 'id' | 'name'>;

export function selfChannelId(memberId: string): string {
  return `self:${memberId}`;
}

export function ensureMemberSelfChannel(
  repo: ApiRepository,
  organizationId: string,
  member: Pick<Member, 'id' | 'name'>,
): Channel {
  const id = selfChannelId(member.id);
  const existing = repo.getChannel(organizationId, id);
  const channel = ChannelSchema.parse({
    id,
    organizationId,
    name: `${member.name} (self)`,
    kind: 'self',
    topic: 'Private working notes',
    memberIds: [member.id],
    parentMessageId: existing?.parentMessageId,
    createdAt: existing?.createdAt,
    archivedAt: existing?.archivedAt,
  });
  repo.saveChannel(channel);
  repo.setChannelMembers(channel.id, [member.id]);
  if (!repo.getThread(organizationId, channel.id)) {
    repo.ensureThread({
      id: channel.id,
      organizationId,
      channelId: channel.id,
      memberIds: [member.id],
      title: channel.name,
      createdAt: channel.createdAt ?? new Date().toISOString(),
    });
  }
  return channel;
}

export function ensureChannelThread(
  repo: ApiRepository,
  organizationId: string,
  channel: Pick<Channel, 'id' | 'name' | 'memberIds' | 'createdAt'>,
): void {
  if (repo.getThread(organizationId, channel.id)) return;
  repo.ensureThread({
    id: channel.id,
    organizationId,
    channelId: channel.id,
    title: channel.name,
    memberIds: channel.memberIds.length
      ? channel.memberIds
      : repo.listMembers(organizationId).map((member) => member.id),
    createdAt: channel.createdAt ?? new Date().toISOString(),
  });
}

export function ensureDirectMessageConversation(
  repo: ApiRepository,
  organizationId: string,
  memberA: MemberRef,
  memberB: MemberRef,
): string {
  const [firstId, secondId] = [memberA.id, memberB.id].sort();
  const channelId = `dm:${firstId}:${secondId}`;
  const dmChannelName = [memberA.name, memberB.name].sort().join(' / ');
  const now = new Date().toISOString();

  const existing = repo.getChannel(organizationId, channelId);
  const channel = ChannelSchema.parse({
    id: channelId,
    organizationId,
    name: dmChannelName,
    kind: 'dm',
    topic: '',
    memberIds: [memberA.id, memberB.id],
    createdAt: existing?.createdAt ?? now,
    archivedAt: existing?.archivedAt,
    parentMessageId: existing?.parentMessageId,
  });
  repo.saveChannel(channel);
  repo.setChannelMembers(channelId, [memberA.id, memberB.id].sort());
  repo.ensureThread({
    id: channel.id,
    organizationId,
    channelId: channel.id,
    title: dmChannelName,
    memberIds: [memberA.id, memberB.id],
    createdAt: channel.createdAt ?? now,
  });
  return channelId;
}

export function addMemberToDefaultChannels(
  repo: ApiRepository,
  team: AgentTeamHandle,
  organizationId: string,
  member: Pick<Member, 'id' | 'kind' | 'roleName'>,
): void {
  if (member.kind !== AGENT_KIND) {
    return;
  }

  const channelIds = new Set<string>();
  const general = team.getChannel('general');
  if (general) {
    channelIds.add(general.id);
  }

  const role = team.getRole(member.roleName);
  for (const channelName of role?.channels ?? []) {
    const channel = team.getChannel(channelName);
    if (channel) {
      channelIds.add(channel.id);
    }
  }

  for (const channelId of channelIds) {
    const channel = repo.getChannel(organizationId, channelId);
    if (!channel) continue;
    const memberIds = new Set(channel.memberIds);
    memberIds.add(member.id);
    repo.setChannelMembers(channelId, [...memberIds].sort());
  }
}
