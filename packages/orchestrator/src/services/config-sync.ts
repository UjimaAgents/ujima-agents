import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  createRoleFromPreset,
  defaultModelForProvider,
  defineRole,
  loadAgentTeam,
  loadAgentTeamFromFile,
  migrateAgentTeamConfig,
  normalizeProviderKey,
  type AgentTeamHandle,
} from '@ujima/framework';
import {
  AGENT_KIND,
  AuditEventSchema,
  ChannelSchema,
  MemberSchema,
  OrganizationSchema,
  type Channel,
  type ConfigFieldOwnership,
  type Member,
  type Organization,
  resolveChannelMemberIds,
} from '@ujima/shared';
import { isPathInsideRoot } from '@ujima/shared/workspace';
import type { ApiRepository } from './repository-reader.js';
import { ensureMemberSelfChannel } from './member-channels.js';
import type { TeamStore } from './team-store.js';
import { summarizeTeam, type TeamSummary } from './team.js';
import { applyDashboardTeamOverrides } from './dashboard-team-overrides.js';
import { upsertWorkspaceMemberScopes } from './workspace-root.js';
import { visiblePublicChannels } from './channel-visibility.js';

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
export const TEAM_CONFIG_SETTING_KEY = 'team.config';
export const ACTIVE_WORKSPACE_SETTING_KEY = 'active_workspace_id';

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

function normalizeStoredScopes(config: Record<string, unknown>, workspaceRoot: string): boolean {
  const roles = Array.isArray(config.roles) ? config.roles : [];
  let changed = false;
  for (const role of roles) {
    if (!role || typeof role !== 'object') continue;
    const record = role as Record<string, unknown>;
    if (!Array.isArray(record.workspaceScopes)) continue;
    const originalScopes = record.workspaceScopes;
    const scopes = originalScopes
      .filter((scope): scope is string => typeof scope === 'string' && scope.trim().length > 0)
      .map((scope) => {
        const resolved = resolve(workspaceRoot, scope);
        if (isPathInsideRoot(workspaceRoot, resolved)) return scope;
        changed = true;
        return '.';
      });
    const nextScopes = [...new Set(scopes)];
    if (nextScopes.length !== originalScopes.length || nextScopes.some((scope, index) => scope !== originalScopes[index])) {
      record.workspaceScopes = nextScopes;
      changed = true;
    }
  }
  return changed;
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

  loadFromStoredConfig(organizationId?: string): { organizationId: string; inferred: boolean } | null {
    const organization = organizationId
      ? this.repo.getOrganization(organizationId)
      : this.repo.getLatestOrganization();
    if (!organization) return null;

    const stored = this.repo.getWorkspaceSetting(organization.id, TEAM_CONFIG_SETTING_KEY);
    if (stored) {
      try {
        const parsedStored = JSON.parse(stored) as Record<string, unknown>;
        if (parsedStored.providers && typeof parsedStored.providers === 'object') {
          for (const [providerName, providerConfig] of Object.entries(parsedStored.providers)) {
            if (typeof providerConfig === 'object' && providerConfig && !('kind' in providerConfig)) {
              (providerConfig as Record<string, unknown>).kind = providerName;
            }
          }
        }
        const migrated = migrateAgentTeamConfig(parsedStored);
        const activeRoot = organization.workspace.root?.trim();
        if (activeRoot) {
          const workspace =
            migrated.config.workspace && typeof migrated.config.workspace === 'object'
              ? { ...(migrated.config.workspace as Record<string, unknown>) }
              : {};
          if (workspace.root !== activeRoot) {
            workspace.root = activeRoot;
            migrated.config.workspace = workspace;
            migrated.migrated = true;
          }
          if (normalizeStoredScopes(migrated.config, activeRoot)) {
            migrated.migrated = true;
          }
        }
        if (migrated.migrated) {
          this.repo.saveWorkspaceSetting(
            organization.id,
            TEAM_CONFIG_SETTING_KEY,
            JSON.stringify(migrated.config),
          );
        }
        const team = loadAgentTeam(migrated.config);
        this.teamStore.setTeam(team, organization.id);
        applyDashboardTeamOverrides(this.repo, organization.id, this.teamStore);
        return { organizationId: organization.id, inferred: false };
      } catch (error) {
        this.discardInvalidStoredTeamConfig(
          organization.id,
          error instanceof Error ? error.message : String(error),
        );
        return null;
      }
    }

    const inferred = this.inferTeamConfig(organization.id);
    if (!inferred) return null;

    let team;
    try {
      team = loadAgentTeam(inferred);
    } catch (error) {
      this.discardInvalidStoredTeamConfig(
        organization.id,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
    persistTeamConfig(this.repo, organization.id, team);
    this.teamStore.setTeam(team, organization.id);
    applyDashboardTeamOverrides(this.repo, organization.id, this.teamStore);
    return { organizationId: organization.id, inferred: true };
  }

  /** Drop broken persisted team config so bootstrap/onboarding can recover cleanly. */
  discardInvalidStoredTeamConfig(organizationId: string, _reason: string): void {
    this.repo.deleteWorkspaceSetting(organizationId, TEAM_CONFIG_SETTING_KEY);
    this.teamStore.clearTeam(organizationId);
  }

  reconcileTeamConfig(input: ReconcileTeamConfigInput): ReconcileTeamConfigResult {
    const existingOrganization = this.resolveTargetOrganization(
      input.organizationId,
      input.configPath,
    );
    const organizationId =
      existingOrganization?.id ?? input.organizationId ?? randomUUID();
    const configManaged = Boolean(input.configPath);
    const markOwned = (
      entityType: ConfigFieldOwnership['entityType'],
      entityId: string,
      fieldNames: readonly string[],
    ) => {
      if (configManaged) {
        markConfigOwnership(this.repo, organizationId, entityType, entityId, fieldNames);
      }
    };

    const organization = OrganizationSchema.parse({
      id: organizationId,
      name: input.team.config.name,
      workspace: input.team.workspace,
      organizationChart: input.team.organizationChart,
    });
    this.repo.saveOrganization(organization);
    markOwned('organization', organizationId, ORGANIZATION_CONFIG_FIELDS);

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
          llm: existing?.llm,
          model: existing?.model,
          shellApprovalMode: existing?.shellApprovalMode,
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
      ensureMemberSelfChannel(this.repo, organizationId, {
        id: agent.name,
        name: agent.name,
      });
      markOwned('member', agent.name, MEMBER_CONFIG_FIELDS);
      stats.membersUpserted += 1;
    }

    for (const member of existingMembers) {
      if (member.kind !== AGENT_KIND) continue;
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
      markOwned('channel', channel.id, CHANNEL_CONFIG_FIELDS);
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

    const activeMemberIds = new Set(
      this.repo
        .listMembers(organizationId)
        .filter((member) => !member.retiredAt)
        .map((member) => member.id),
    );

    for (const [id, memberIds] of channelMemberships) {
      this.repo.setChannelMembers(
        organizationId,
        id,
        resolveChannelMemberIds([...memberIds], activeMemberIds),
      );
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
      markOwned('role', role.id ?? role.name, ROLE_CONFIG_FIELDS);
    }

    const activeProviderNames = new Set(Object.keys(input.team.providers));
    for (const providerName of activeProviderNames) {
      markOwned('provider', providerName, PROVIDER_CONFIG_FIELDS);
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

    this.teamStore.setTeam(input.team, organizationId);
    persistTeamConfig(this.repo, organizationId, input.team);
    applyDashboardTeamOverrides(this.repo, organizationId, this.teamStore);

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
      channels: visiblePublicChannels(this.repo.listAllChannels(organizationId)),
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

  private inferTeamConfig(organizationId: string): Record<string, unknown> | null {
    const organization = this.repo.getOrganization(organizationId);
    if (!organization) return null;

    const agents = this.repo
      .listMembers(organizationId)
      .filter((member) => member.kind === AGENT_KIND && !member.retiredAt)
      .map((member) => ({
        name: member.id,
        roleName: member.roleName,
        personalityName: 'direct',
        kind: AGENT_KIND,
      }));
    if (agents.length === 0) return null;
    const agentIds = new Set(agents.map((agent) => agent.name));

    const channels = this.repo
      .listAllChannels(organizationId)
      .filter((channel) => channel.kind !== 'self' && channel.kind !== 'dm' && !channel.archivedAt)
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        kind: channel.kind,
        topic: channel.topic,
        memberIds: channel.memberIds,
      }));
    const channelNames = new Set(channels.map((channel) => channel.name));
    const fallbackChannels = channelNames.has('general')
      ? ['general']
      : channels[0]
        ? [channels[0].name]
        : [];
    const providerNames = Object.keys(this.repo.listProviderCredentials(organizationId)).map(normalizeProviderKey);
    const providerName = providerNames[0] ?? 'openai';
    const provider = {
      kind: providerName,
      defaultModel: defaultModelForProvider(providerName),
      models: [],
    };

    return {
      name: organization.name,
      workspace: organization.workspace,
      organizationChart: {
        reportsTo: Object.fromEntries(
          Object.entries(organization.organizationChart.reportsTo).filter(
            ([child, parent]) => agentIds.has(child) && agentIds.has(parent),
          ),
        ),
      },
      agents,
      providers: { [providerName]: provider },
      roles: [...new Set(agents.map((agent) => agent.roleName))].map((roleName) => {
        try {
          const role = createRoleFromPreset(roleName, {
            provider: providerName,
            model: defaultModelForProvider(providerName),
          });
          return {
            ...role,
            channels: role.channels.filter((channel) => channelNames.has(channel)),
          };
        } catch {
          return defineRole({
            name: roleName,
            title: roleName,
            description: roleName,
            instructions: `Operate as ${roleName}.`,
            provider: providerName,
            model: defaultModelForProvider(providerName),
            channels: fallbackChannels,
          });
        }
      }),
      channels,
    };
  }
}

export function persistTeamConfig(
  repo: ApiRepository,
  organizationId: string,
  team: AgentTeamHandle,
): void {
  repo.saveWorkspaceSetting(organizationId, TEAM_CONFIG_SETTING_KEY, JSON.stringify(team.toJSON()));
}
