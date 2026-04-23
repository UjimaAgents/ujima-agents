import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { loadAgentTeamFromFile, type AgentTeamHandle } from '@ujima/framework';
import {
  AuditEventSchema,
  ChannelSchema,
  MemberSchema,
  OrganizationSchema,
  type Channel,
  type ConfigFieldOwnership,
  type Member,
  type Organization,
} from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import { summarizeTeam, type TeamSummary } from './team.js';
import { upsertWorkspaceMemberScopes } from './workspace-root.js';

export interface ReconcileTeamConfigInput {
  team: AgentTeamHandle;
  organizationId?: string;
  configPath?: string;
}

export interface ReconcileTeamConfigStats {
  createdOrganization: boolean;
  membersUpserted: number;
  membersRetired: number;
  channelsUpserted: number;
  channelsArchived: number;
  providersRetired: number;
}

export interface ReconcileTeamConfigResult {
  organization: Organization;
  members: Member[];
  channels: Channel[];
  team: TeamSummary;
  stats: ReconcileTeamConfigStats;
}

const ORGANIZATION_CONFIG_FIELDS = [
  'name',
  'workspace.root',
  'workspace.roleScopes',
  'organizationChart',
] as const;
const ROLE_CONFIG_FIELDS = [
  'title',
  'description',
  'instructions',
  'kind',
  'provider',
  'model',
  'workspaceScopes',
  'tools',
  'channels',
  'skills',
] as const;
const MEMBER_CONFIG_FIELDS = ['name', 'kind', 'roleName'] as const;
const CHANNEL_CONFIG_FIELDS = ['name', 'kind', 'topic'] as const;
const PROVIDER_CONFIG_FIELDS = ['kind', 'defaultModel', 'baseUrl', 'models'] as const;
const CONFIG_PATH_SETTING_KEY = 'config_sync.path';

function channelId(channel: { id?: string; name: string }): string {
  return channel.id ?? channel.name;
}

function ownershipEntityIds(
  ownership: ConfigFieldOwnership[],
  entityType: ConfigFieldOwnership['entityType'],
): Set<string> {
  return new Set(
    ownership
      .filter((entry) => entry.entityType === entityType && entry.owner === 'config')
      .map((entry) => entry.entityId),
  );
}

function markConfigOwnership(
  repo: ApiRepository,
  organizationId: string,
  entityType: ConfigFieldOwnership['entityType'],
  entityId: string,
  fieldNames: readonly string[],
): void {
  for (const fieldName of fieldNames) {
    repo.saveConfigFieldOwnership({
      organizationId,
      entityType,
      entityId,
      fieldName,
      owner: 'config',
      allowDashboardOverride: false,
    });
  }
}

export class ConfigSyncService {
  constructor(
    private readonly repo: ApiRepository,
    private readonly teamStore: TeamStore,
  ) {}

  async loadAndReconcileFromFile(
    configPath: string,
    organizationId?: string,
  ): Promise<ReconcileTeamConfigResult> {
    const resolvedConfigPath = resolve(configPath);
    const team = await loadAgentTeamFromFile(configPath);
    return this.reconcileTeamConfig({
      team,
      organizationId,
      configPath: resolvedConfigPath,
    });
  }

  reconcileTeamConfig(input: ReconcileTeamConfigInput): ReconcileTeamConfigResult {
    const existingOrganization = this.resolveTargetOrganization(
      input.organizationId,
      input.configPath,
    );
    const organizationId = existingOrganization?.id ?? randomUUID();

    const organization = OrganizationSchema.parse({
      id: organizationId,
      name: input.team.config.name,
      workspace: input.team.workspace,
      organizationChart: input.team.organizationChart,
    });
    this.repo.saveOrganization(organization);
    markConfigOwnership(
      this.repo,
      organizationId,
      'organization',
      organizationId,
      ORGANIZATION_CONFIG_FIELDS,
    );

    const existingMembers = this.repo.listMembers(organizationId);
    const existingMembersById = new Map(existingMembers.map((member) => [member.id, member]));
    const existingChannels = this.repo.listAllChannels(organizationId);
    const existingChannelsById = new Map(existingChannels.map((channel) => [channel.id, channel]));
    const ownership = this.repo.listConfigFieldOwnership(organizationId);
    const configManagedMemberIds = ownershipEntityIds(ownership, 'member');
    const configManagedChannelIds = ownershipEntityIds(ownership, 'channel');
    const configManagedProviderNames = ownershipEntityIds(ownership, 'provider');

    const stats: ReconcileTeamConfigStats = {
      createdOrganization: !existingOrganization,
      membersUpserted: 0,
      membersRetired: 0,
      channelsUpserted: 0,
      channelsArchived: 0,
      providersRetired: 0,
    };

    const now = new Date().toISOString();
    const activeAgentIds = new Set<string>();
    for (const agent of input.team.agents) {
      activeAgentIds.add(agent.name);
      const existing = existingMembersById.get(agent.name);
      this.repo.saveMember(
        MemberSchema.parse({
          id: agent.name,
          organizationId,
          name: agent.name,
          kind: agent.kind,
          roleName: agent.roleName,
          presence: existing?.presence ?? 'offline',
          createdAt: existing?.createdAt ?? now,
          retiredAt: undefined,
        }),
      );
      const role = input.team.getRole(agent.roleName);
      upsertWorkspaceMemberScopes(
        this.repo,
        organizationId,
        agent.name,
        role?.workspaceScopes ?? [],
      );
      markConfigOwnership(this.repo, organizationId, 'member', agent.name, MEMBER_CONFIG_FIELDS);
      stats.membersUpserted += 1;
    }

    for (const member of existingMembers) {
      if (member.kind !== 'agent') continue;
      if (!configManagedMemberIds.has(member.id)) continue;
      if (activeAgentIds.has(member.id)) continue;

      // Reconcile never deletes config-managed agents; retiring preserves the
      // historical references that runs, messages, and audits already hold.
      this.repo.saveMember({
        ...member,
        retiredAt: member.retiredAt ?? now,
      });
      if (!member.retiredAt) {
        stats.membersRetired += 1;
      }
    }

    const channelMemberships = new Map<string, Set<string>>();
    const activeChannelIds = new Set<string>();
    const channelsByName = new Map<string, Channel>();

    for (const configChannel of input.team.channels) {
      const id = channelId(configChannel);
      activeChannelIds.add(id);
      const existing = existingChannelsById.get(id);
      const channel = ChannelSchema.parse({
        id,
        organizationId,
        name: configChannel.name,
        kind: configChannel.kind,
        topic: configChannel.topic,
        memberIds: configChannel.memberIds ?? [],
        createdAt: existing?.createdAt ?? now,
        archivedAt: undefined,
      });
      channelsByName.set(channel.name, channel);
      channelMemberships.set(channel.id, new Set(channel.memberIds));
      this.repo.saveChannel(channel);
      markConfigOwnership(this.repo, organizationId, 'channel', channel.id, CHANNEL_CONFIG_FIELDS);
      stats.channelsUpserted += 1;
    }

    for (const agent of input.team.agents) {
      const role = input.team.getRole(agent.roleName);
      if (!role) continue;

      for (const channelName of role.channels) {
        const channel = channelsByName.get(channelName);
        if (!channel) continue;
        channelMemberships.get(channel.id)?.add(agent.name);
      }
    }

    for (const [id, memberIds] of channelMemberships) {
      this.repo.setChannelMembers(id, [...memberIds].sort());
    }

    for (const channel of existingChannels) {
      if (!configManagedChannelIds.has(channel.id)) continue;
      if (activeChannelIds.has(channel.id)) continue;

      // Archive instead of delete so the channel's history remains readable
      // even after config stops declaring it.
      this.repo.saveChannel({
        ...channel,
        archivedAt: channel.archivedAt ?? now,
      });
      if (!channel.archivedAt) {
        stats.channelsArchived += 1;
      }
    }

    for (const role of input.team.roles) {
      markConfigOwnership(
        this.repo,
        organizationId,
        'role',
        role.id ?? role.name,
        ROLE_CONFIG_FIELDS,
      );
    }

    const activeProviderNames = new Set(Object.keys(input.team.providers));
    for (const providerName of activeProviderNames) {
      markConfigOwnership(
        this.repo,
        organizationId,
        'provider',
        providerName,
        PROVIDER_CONFIG_FIELDS,
      );
    }
    for (const providerName of configManagedProviderNames) {
      if (activeProviderNames.has(providerName)) continue;
      this.repo.deleteProviderCredential(organizationId, providerName);
      stats.providersRetired += 1;
    }

    if (input.configPath) {
      // Persist the config-file -> organization binding so a later save or
      // daemon restart reconciles the same org instead of whichever row most
      // recently updated the organizations table.
      this.repo.saveWorkspaceSetting(organizationId, CONFIG_PATH_SETTING_KEY, input.configPath);
    }

    this.teamStore.setTeam(input.team);

    this.repo.saveAuditEvent(
      AuditEventSchema.parse({
        id: randomUUID(),
        organizationId,
        action: 'config.reconciled',
        targetType: 'organization',
        targetId: organizationId,
        status: 'ok',
        createdAt: now,
        metadata: {
          configPath: input.configPath,
          teamName: input.team.config.name,
          stats,
        },
      }),
    );

    return {
      organization,
      members: this.repo.listMembers(organizationId),
      channels: this.repo.listAllChannels(organizationId),
      team: summarizeTeam(input.team),
      stats,
    };
  }

  private resolveTargetOrganization(
    explicitOrganizationId?: string,
    configPath?: string,
  ): Organization | null {
    if (explicitOrganizationId) {
      return this.repo.getOrganization(explicitOrganizationId);
    }

    if (configPath) {
      const boundOrganizationId = this.repo.findOrganizationIdByWorkspaceSetting(
        CONFIG_PATH_SETTING_KEY,
        configPath,
      );
      if (boundOrganizationId) {
        return this.repo.getOrganization(boundOrganizationId);
      }
    }

    return this.repo.getLatestOrganization();
  }
}
