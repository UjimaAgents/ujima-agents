import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { normalizeProviderKey } from '@ujima/framework';
import {
  AGENT_KIND,
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
import { normalizeProjectFolderPath, upsertWorkspaceMemberScopes } from './workspace-root.js';
import { reclaimOrphanOrganizationsAtPath } from './workspace-path-claim.js';
import { persistTeamConfig } from './config-sync.js';
import { visibleChannelsFromRepo } from './settings.js';
import { visiblePublicChannels } from './channel-visibility.js';

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

export class OnboardingService {
  constructor(
    private readonly repo: ApiRepository,
    private readonly teamStore: TeamStore,
  ) {}

  async onboard(input: OnboardingInput): Promise<OnboardingResult> {
    // The org-chart can reference the owner as a manager via either the
    // owner's display name or the literal "Owner"/"owner" sentinels (used
    // by the web seed draft). The framework's `createOrganizationChart`
    // only resolves agent refs and would throw on an owner ref, so we
    // pre-allocate `ownerId`, split owner-targeting entries off, hand
    // only agent-only edges to `loadAgentTeam`, then merge owner edges
    // back in with the value resolved to `ownerId`.
    const ownerId = randomUUID();
    const ownerNameTrimmed = input.ownerName.trim();
    // Accepted owner-manager refs in the inbound chart, in priority order:
    //   * `@owner`             — the stable sentinel emitted by the web
    //                            onboarding form. Survives owner renames.
    //   * `<input.ownerName>`  — legacy form (display-name string).
    //   * `Owner` / `owner`    — legacy seed-draft labels.
    // All resolve to the owner member's id below.
    const isOwnerRef = (ref: string): boolean => {
      if (!ref) return false;
      if (ref === '@owner') return true;
      if (ownerNameTrimmed && ref === ownerNameTrimmed) return true;
      return ref === 'Owner' || ref === 'owner';
    };

    const inboundReports = input.team.organizationChart?.reportsTo ?? {};
    const agentOnlyReports: Record<string, string> = {};
    const ownerTargetingReports: Record<string, string> = {};
    // `input.team.agents` is typed `unknown[]` on this loose API surface;
    // narrow inline before reading `name`.
    const agentNames = new Set(
      ((input.team.agents ?? []) as { name?: unknown }[])
        .map((agent) => (typeof agent?.name === 'string' ? agent.name : ''))
        .filter((name) => name.length > 0),
    );
    for (const [child, parent] of Object.entries(inboundReports)) {
      // Agent name on the manager side wins over an owner-label collision —
      // role names are first-class refs; the owner sentinel is the fallback.
      if (agentNames.has(parent)) {
        agentOnlyReports[child] = parent;
      } else if (isOwnerRef(parent)) {
        ownerTargetingReports[child] = ownerId;
      } else {
        // Unknown ref — let the framework throw the descriptive error
        // it already produces for unresolved agent refs.
        agentOnlyReports[child] = parent;
      }
    }

    const workspaceRoot = resolve(input.workspaceRoot);
    const normalizedNewRoot = normalizeProjectFolderPath(workspaceRoot);

    const existingOrgs = this.repo.listOrganizationsWithSignIn();
    for (const org of existingOrgs) {
      if (!org.workspace?.root) continue;
      if (normalizeProjectFolderPath(org.workspace.root) === normalizedNewRoot) {
        throw new Error(`A workspace with the project folder "${org.workspace.root}" already exists.`);
      }
    }

    const team: AgentTeamHandle = loadAgentTeam({
      name: input.team.name ?? input.organizationName,
      workspace: { root: workspaceRoot },
      agents: input.team.agents ?? [],
      roles: input.team.roles ?? [],
      channels: input.team.channels ?? [],
      providers: input.team.providers ?? {},
      organizationChart: { reportsTo: agentOnlyReports },
      policies: input.team.policies,
    } as Record<string, unknown>);

    const normalizedProviderKeys = Object.fromEntries(
      Object.entries(input.providerKeys).map(([name, apiKey]) => [normalizeProviderKey(name), apiKey]),
    );
    const { unknownProviders, missingProviders } = validateProviderKeys(
      team,
      normalizedProviderKeys,
    );
    if (unknownProviders.length > 0) {
      throw new Error(`Unknown provider keys: ${unknownProviders.join(', ')}`);
    }
    if (missingProviders.length > 0) {
      throw new Error(`Missing provider keys: ${missingProviders.join(', ')}`);
    }

    const emptyCatalog = { get: () => undefined };
    reclaimOrphanOrganizationsAtPath(this.repo, emptyCatalog, normalizedNewRoot);

    const organizationId = randomUUID();
    // Owner-targeting edges win over the framework's normalised set —
    // they are what the user explicitly configured. Fall back to the
    // built-in chart only when the user supplied nothing at all.
    const mergedReportsTo = {
      ...team.organizationChart.reportsTo,
      ...ownerTargetingReports,
    };
    const organizationChart =
      Object.keys(mergedReportsTo).length > 0
        ? { reportsTo: mergedReportsTo }
        : buildInitialOrganizationChart(ownerId, team.agents);

    const organization = OrganizationSchema.parse({
      id: organizationId,
      name: input.organizationName,
      workspace: team.workspace,
      organizationChart,
    });
    this.repo.saveOrganization(organization);

    for (const [providerName, apiKey] of Object.entries(normalizedProviderKeys)) {
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
          kind: AGENT_KIND,
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
      if (member.kind !== AGENT_KIND) continue;
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
      this.repo.setChannelMembers(organizationId, id, [...ids]);
    }

    for (const member of members) {
      addMemberToDefaultChannels(this.repo, team, organizationId, member);
    }

    this.teamStore.setTeam(team, organizationId);
    persistTeamConfig(this.repo, organizationId, team);

    return {
      organization,
      members,
      channels: visiblePublicChannels(visibleChannelsFromRepo(this.repo, organizationId)),
      team: summarizeTeam(team),
    };
  }
}
