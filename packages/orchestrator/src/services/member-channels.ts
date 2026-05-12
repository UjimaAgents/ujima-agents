import type { AgentTeamHandle } from '@ujima/framework';
import { AGENT_KIND, ChannelSchema, type Channel, type Member } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';

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
