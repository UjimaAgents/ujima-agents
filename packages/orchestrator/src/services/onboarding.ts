import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  ChannelSchema,
  MemberSchema,
  OrganizationSchema,
  type Channel,
  type Member,
  type Organization,
} from '@ujima/shared';
import { loadAgentTeam, type AgentTeamHandle } from '@ujima/framework';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import { summarizeTeam, validateProviderKeys, type TeamSummary } from './team.js';
import { addMemberToDefaultChannels, ensureMemberSelfChannel } from './member-channels.js';
import { upsertWorkspaceMemberScopes } from './workspace-root.js';

export interface OnboardingInlineTeam {
  name?: string;
  agents?: unknown[];
  roles?: unknown[];
  channels?: unknown[];
  providers?: Record<string, unknown>;
  organizationChart?: { reportsTo: Record<string, string> };
  policies?: unknown;
}

export interface OnboardingInput {
  organizationName: string;
  ownerName: string;
  workspaceRoot: string;
  providerKeys: Record<string, string>;
  team: OnboardingInlineTeam;
}

export interface OnboardingResult {
  organization: Organization;
  members: Member[];
  channels: Channel[];
  team: TeamSummary;
}

function channelId(channel: { id?: string; name: string }): string {
  return channel.id ?? channel.name;
}

function buildInitialOrganizationChart(
  ownerId: string,
  agents: { name: string; roleName: string }[],
): { reportsTo: Record<string, string> } {
  const reportsTo: Record<string, string> = {};
  const byRole = new Map<string, string[]>();

  for (const agent of agents) {
    const current = byRole.get(agent.roleName) ?? [];
    current.push(agent.name);
    byRole.set(agent.roleName, current);
  }

  const engineeringManagerId = byRole.get('engineering-manager')?.[0] ?? ownerId;

  for (const agent of agents) {
    if (agent.roleName === 'engineering-manager' || agent.roleName === 'pm') {
      reportsTo[agent.name] = ownerId;
      continue;
    }
    if (
      agent.roleName === 'frontend-engineer' ||
      agent.roleName === 'backend-engineer' ||
      agent.roleName === 'qa-engineer' ||
      agent.roleName === 'code-reviewer'
    ) {
      reportsTo[agent.name] = engineeringManagerId;
    }
  }

  return { reportsTo };
}

function visibleChannels(channels: Channel[]): Channel[] {
  // Hide both `self` (private agent scratchpads) and `dm` (private 2-member
  // conversations) from the onboarding response. Member-scoped DM access
  // goes through `listVisibleChannels` (channel.list tool path).
  return channels.filter((channel) => channel.kind !== 'self' && channel.kind !== 'dm');
}

export class OnboardingService {
  constructor(
    private readonly repo: ApiRepository,
    private readonly teamStore: TeamStore,
  ) {}

  async onboard(input: OnboardingInput): Promise<OnboardingResult> {
    const team: AgentTeamHandle = loadAgentTeam({
      name: input.team.name ?? input.organizationName,
      workspace: { root: resolve(input.workspaceRoot) },
      agents: input.team.agents ?? [],
      roles: input.team.roles ?? [],
      channels: input.team.channels ?? [],
      providers: input.team.providers ?? {},
      organizationChart: input.team.organizationChart ?? { reportsTo: {} },
      policies: input.team.policies,
    } as Record<string, unknown>);

    const { unknownProviders, missingProviders } = validateProviderKeys(
      team,
      input.providerKeys,
    );
    if (unknownProviders.length > 0) {
      throw new Error(`Unknown provider keys: ${unknownProviders.join(', ')}`);
    }
    if (missingProviders.length > 0) {
      throw new Error(`Missing provider keys: ${missingProviders.join(', ')}`);
    }

    const ownerId = randomUUID();
    const organizationId = randomUUID();
    const organizationChart =
      Object.keys(team.organizationChart.reportsTo).length > 0
        ? team.organizationChart
        : buildInitialOrganizationChart(ownerId, team.agents);

    const organization = OrganizationSchema.parse({
      id: organizationId,
      name: input.organizationName,
      workspace: team.workspace,
      organizationChart,
    });
    this.repo.saveOrganization(organization);

    for (const [providerName, apiKey] of Object.entries(input.providerKeys)) {
      this.repo.saveProviderCredential(organizationId, providerName, apiKey);
    }

    const owner = MemberSchema.parse({
      id: ownerId,
      organizationId,
      name: input.ownerName,
      kind: 'human',
      roleName: 'owner',
      presence: 'offline',
      createdAt: new Date().toISOString(),
    });

    const members: Member[] = [
      owner,
      ...team.agents.map((agent) =>
        MemberSchema.parse({
          id: agent.name,
          organizationId,
          name: agent.name,
          kind: 'agent',
          roleName: agent.roleName,
          presence: 'offline',
          createdAt: new Date().toISOString(),
        }),
      ),
    ];

    for (const member of members) {
      this.repo.saveMember(member);
      const role = team.getRole(member.roleName);
      upsertWorkspaceMemberScopes(
        this.repo,
        organizationId,
        member.id,
        role?.workspaceScopes ?? [],
      );
      ensureMemberSelfChannel(this.repo, organizationId, member);
    }

    const channels: Channel[] = team.channels.map((config) =>
      ChannelSchema.parse({
        id: channelId(config),
        organizationId,
        name: config.name,
        kind: config.kind,
        topic: config.topic,
        memberIds: config.memberIds ?? [],
      }),
    );

    for (const channel of channels) {
      this.repo.saveChannel(channel);
    }

    const channelsByName = new Map(channels.map((channel) => [channel.name, channel]));
    const channelMemberships = new Map<string, Set<string>>(
      channels.map((channel) => [channel.id, new Set(channel.memberIds)]),
    );
    const memberIdsByRole = new Map<string, string[]>();

    for (const member of members) {
      if (member.kind !== 'agent') continue;
      const ids = memberIdsByRole.get(member.roleName) ?? [];
      ids.push(member.id);
      memberIdsByRole.set(member.roleName, ids);
    }

    for (const agent of team.agents) {
      const role = team.getRole(agent.roleName);
      if (!role) continue;
      const agentIds = memberIdsByRole.get(agent.roleName) ?? [];
      for (const channelName of role.channels) {
        const channel = channelsByName.get(channelName);
        if (!channel) continue;
        for (const memberId of agentIds) {
          channelMemberships.get(channel.id)?.add(memberId);
        }
      }
    }

    for (const [id, ids] of channelMemberships) {
      this.repo.setChannelMembers(id, [...ids]);
    }

    for (const member of members) {
      addMemberToDefaultChannels(this.repo, team, organizationId, member);
    }

    this.teamStore.setTeam(team);

    return {
      organization,
      members,
      channels: visibleChannels(
        this.repo.listChannels(organizationId, undefined, undefined, ['self', 'dm']).data,
      ),
      team: summarizeTeam(team),
    };
  }
}
