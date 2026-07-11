import { randomUUID } from 'node:crypto';
import {
  AGENT_KIND,
  ChannelSchema,
  MemberSchema,
  MemberShellApprovalModeSchema,
  PROVIDER_KINDS,
  shellApprovalModeFromLegacyRequireShell,
  type Organization,
  type Member,
  type Channel,
  type MemberShellApprovalMode,
  type ShellApprovalMode,
  type ToolPolicyState,
  resolveChannelMemberIds,
} from '@ujima/shared';
import { AgentTeam, createAgent, defineRole, loadAgentTeam, normalizeProviderKey, type RoleConfig } from '@ujima/framework';
import { getDefaultOpenAiCompatBaseUrl, type ProviderKind } from '@ujima/llm';
import type { ProviderAuthMode } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import { listProviderStatuses, type ProviderStatus } from './team.js';
import {
  addMemberToDefaultChannels,
  ensureChannelThread,
  ensureMemberSelfChannel,
} from './member-channels.js';
import {
  assertWorkspaceRootPathExists,
  normalizeProjectFolderPath,
  upsertWorkspaceMemberScopes,
} from './workspace-root.js';
import { assertProjectFolderAvailable } from './workspace-path-claim.js';
import {
  deleteDashboardTeamOverride,
  stripAgentFromPersistedTeamConfig,
  upsertDashboardTeamOverride,
} from './dashboard-team-overrides.js';
import { ConfigSyncService, persistTeamConfig } from './config-sync.js';
import { requireTeam } from '../utils/require-team.js';
import { requireOrganization } from '../utils/require-organization.js';
import { visiblePublicChannels } from './channel-visibility.js';
import type { ApprovalResolveInput } from './approval.js';
import { resolveAgentMemberId } from './member-id.js';
import { collectCursorPages } from '../utils/cursor-pages.js';
import { hasCodexAccessToken } from '../utils/codex-auth.js';
import { hasClaudeCodeLogin } from '../utils/claude-code-auth.js';

function activeMembers(repo: ApiRepository, organizationId: string): Member[] {
  return repo.listMembers(organizationId).filter((member) => !member.retiredAt);
}

function parseShellApprovalMode(value: MemberShellApprovalMode | undefined, fallback: MemberShellApprovalMode | undefined): MemberShellApprovalMode | undefined {
  return value !== undefined ? MemberShellApprovalModeSchema.parse(value) : fallback;
}

export interface TeamSettingsResponse {
  name: string;
  workspace: { root: string; roleScopes: Record<string, string[]> };
  organizationChart: { reportsTo: Record<string, string> };
  agents: unknown[];
  roles: unknown[];
  channels: unknown[];
  tools: Record<string, unknown>;
  policies: unknown;
}

export interface OrganizationSettingsResponse {
  organization: Organization;
  members: Member[];
  channels: Channel[];
}

export interface UpdateOrganizationInput {
  organizationId: string;
  organizationName?: string;
  workspaceRoot?: string;
  organizationChart?: { reportsTo: Record<string, string> };
}

export interface AddMemberInput {
  organizationId: string;
  name: string;
  kind: 'human' | 'agent';
  roleName: string;
  channelIds?: string[];
  llm?: string;
  model?: string;
  shellApprovalMode?: MemberShellApprovalMode;
  personalityName?: string;
  role?: RoleConfig;
}

export interface UpdateMemberInput {
  organizationId: string;
  memberId: string;
  name: string;
  roleName: string;
  channelIds?: string[];
  llm?: string;
  model?: string;
  shellApprovalMode?: MemberShellApprovalMode;
  personalityName: string;
  role: RoleConfig;
}

export interface PatchMemberPreferencesInput {
  organizationId: string;
  memberId: string;
  shellApprovalMode?: MemberShellApprovalMode;
  llm?: string;
  model?: string;
}

export interface CreateChannelInput {
  organizationId: string;
  name: string;
  topic?: string;
}

export interface UpdatePoliciesInput {
  organizationId: string;
  requireApprovalForWrites?: boolean;
  requireApprovalForShell?: boolean;
  shellApprovalMode?: ShellApprovalMode;
}

export interface UpdateChannelInput {
  organizationId: string;
  channelId: string;
  name?: string;
  topic?: string;
  memberIds?: string[];
}

export interface PolicyAllowRuleRecord {
  agentId: string;
  mcpId: string;
  toolName: string;
  state: ToolPolicyState;
  reason?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface ProviderTestResult {
  provider: string;
  ok: boolean;
  message: string;
}

function validateOrganizationChart(
  reportsTo: Record<string, string>,
  memberIds: Set<string>,
  agentIds: Set<string>,
  ownerId: string,
): void {
  for (const [childId, parentId] of Object.entries(reportsTo)) {
    if (!memberIds.has(childId)) {
      throw new Error(`Organization chart references unknown member "${childId}"`);
    }
    if (!memberIds.has(parentId)) {
      throw new Error(`Organization chart references unknown manager "${parentId}"`);
    }
    if (childId === parentId) {
      throw new Error(`Member "${childId}" cannot report to itself`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (memberId: string): void => {
    if (visited.has(memberId)) return;
    if (visiting.has(memberId)) {
      throw new Error(`Organization chart contains a cycle at member "${memberId}"`);
    }
    visiting.add(memberId);
    const parentId = reportsTo[memberId];
    if (parentId) walk(parentId);
    visiting.delete(memberId);
    visited.add(memberId);
  };
  for (const memberId of Object.keys(reportsTo)) walk(memberId);

  const getChainRoot = (memberId: string): string => {
    const parentId = reportsTo[memberId];
    return parentId ? getChainRoot(parentId) : memberId;
  };

  for (const agentId of agentIds) {
    const root = getChainRoot(agentId);
    if (root !== ownerId) {
      if (!reportsTo[agentId]) {
        throw new Error(
          `Agent "${agentId}" must report to the owner or a manager. Add an entry pointing to "${ownerId}".`,
        );
      }
      throw new Error(
        `Agent "${agentId}" reporting chain does not reach owner "${ownerId}". Ends at "${root}".`,
      );
    }
  }
}

export class SettingsService {
  constructor(
    private readonly repo: ApiRepository,
    private readonly teamStore: TeamStore,
    private readonly approvals?: {
      resolveApproval(input: ApprovalResolveInput): Promise<unknown> | unknown;
    },
  ) {}

  private loadTeamForOrganization(organizationId: string) {
    new ConfigSyncService(this.repo, this.teamStore).loadFromStoredConfig(organizationId);
    return requireTeam(this.teamStore, organizationId);
  }

  getTeamSettings(organizationId: string): TeamSettingsResponse {
    const team = this.loadTeamForOrganization(organizationId);
    const organization = requireOrganization(this.repo, organizationId);
    return {
      name: team.config.name,
      workspace: team.workspace,
      organizationChart: organization.organizationChart,
      agents: team.agents,
      roles: team.roles,
      channels: team.channels,
      tools: team.tools,
      policies: team.config.policies,
    };
  }

  listProviders(organizationId: string): ProviderStatus[] {
    const team = this.loadTeamForOrganization(organizationId);
    requireOrganization(this.repo, organizationId);
    return listProviderStatuses(team, this.repo.listProviderCredentials(organizationId));
  }

  upsertProviders(
    organizationId: string,
    providerKeys: Record<string, string>,
    providerAuthModes: Record<string, ProviderAuthMode> = {},
    providerBaseUrls: Record<string, string> = {},
  ): ProviderStatus[] {
    const team = this.loadTeamForOrganization(organizationId);
    requireOrganization(this.repo, organizationId);
    const normalizedProviderKeys = Object.fromEntries(
      Object.entries(providerKeys).map(([name, apiKey]) => [normalizeProviderKey(name), apiKey]),
    );
    const normalizedProviderAuthModes = Object.fromEntries(
      Object.entries(providerAuthModes).map(([name, authMode]) => [normalizeProviderKey(name), authMode]),
    ) as Record<string, ProviderAuthMode>;
    const normalizedProviderBaseUrls = Object.fromEntries(
      Object.entries(providerBaseUrls).map(([name, baseUrl]) => [normalizeProviderKey(name), baseUrl.trim()]),
    );

    const knownProviderSet = new Set(PROVIDER_KINDS);

    const unknownProviders: string[] = [];
    const needsRegistration: string[] = [];
    for (const providerName of new Set([
      ...Object.keys(normalizedProviderKeys),
      ...Object.keys(normalizedProviderAuthModes),
      ...Object.keys(normalizedProviderBaseUrls),
    ])) {
      if (!team.providers[providerName]) {
        if (knownProviderSet.has(providerName as typeof PROVIDER_KINDS[number])) {
          needsRegistration.push(providerName);
        } else {
          unknownProviders.push(providerName);
        }
      }
    }
    if (unknownProviders.length > 0) {
      throw new Error(`Unknown provider keys: ${unknownProviders.join(', ')}`);
    }

    const hasBaseUrlChanges = Object.keys(normalizedProviderBaseUrls).length > 0;
    if (needsRegistration.length > 0 || hasBaseUrlChanges) {
      const config = team.toJSON();
      for (const name of needsRegistration) {
        config.providers[name] = { kind: name as typeof PROVIDER_KINDS[number], models: [] };
      }
      for (const [name, authMode] of Object.entries(normalizedProviderAuthModes)) {
        config.providers[name] = {
          ...(config.providers[name] ?? { kind: name as typeof PROVIDER_KINDS[number], models: [] }),
          authMode,
        };
      }
      for (const [name, baseUrl] of Object.entries(normalizedProviderBaseUrls)) {
        const provider = config.providers[name] ?? { kind: name as typeof PROVIDER_KINDS[number], models: [] };
        if (baseUrl) {
          provider.baseUrl = baseUrl;
        } else {
          delete provider.baseUrl;
        }
        config.providers[name] = provider;
      }
      const updated = AgentTeam(config);
      this.teamStore.setTeam(updated, organizationId);
      persistTeamConfig(this.repo, organizationId, updated);
    } else if (Object.keys(normalizedProviderAuthModes).length > 0) {
      const config = team.toJSON();
      let changed = false;
      for (const [name, authMode] of Object.entries(normalizedProviderAuthModes)) {
        const provider = config.providers[name] ?? { kind: name as typeof PROVIDER_KINDS[number], models: [] };
        if (authMode === 'chatgpt') {
          provider.authMode = authMode;
        } else {
          delete provider.authMode;
        }
        config.providers[name] = provider;
        changed = true;
      }
      if (changed) {
        const updated = AgentTeam(config);
        this.teamStore.setTeam(updated, organizationId);
        persistTeamConfig(this.repo, organizationId, updated);
      }
    }

    for (const [providerName, authMode] of Object.entries(normalizedProviderAuthModes)) {
      if (authMode === 'chatgpt') {
        this.repo.deleteProviderCredential(organizationId, providerName);
      }
    }

    for (const [providerName, apiKey] of Object.entries(normalizedProviderKeys)) {
      const authMode = normalizedProviderAuthModes[providerName];
      if (authMode === 'chatgpt') {
        continue;
      }
      this.repo.saveProviderCredential(organizationId, providerName, apiKey);
    }

    return this.listProviders(organizationId);
  }

  deleteProvider(organizationId: string, providerName: string): ProviderStatus[] {
    const team = this.loadTeamForOrganization(organizationId);
    requireOrganization(this.repo, organizationId);
    const normalizedName = normalizeProviderKey(providerName);
    const config = team.toJSON();
    if (config.providers[normalizedName]) {
      const { [normalizedName]: _removed, ...restProviders } = config.providers;
      config.providers = restProviders;
      const updated = AgentTeam(config);
      this.teamStore.setTeam(updated, organizationId);
      persistTeamConfig(this.repo, organizationId, updated);
    }
    this.repo.deleteProviderCredential(organizationId, normalizedName);
    return this.listProviders(organizationId);
  }

  testProvider(organizationId: string, providerName: string): ProviderTestResult {
    const team = this.loadTeamForOrganization(organizationId);
    requireOrganization(this.repo, organizationId);
    const providerKey = normalizeProviderKey(providerName);
    const authMode = team.getProvider(providerKey)?.authMode ?? (
      providerKey === 'openai-codex' ? 'chatgpt' : providerKey === 'anthropic-claude-code' ? 'claude-code' : undefined
    );

    if (!team.providers[providerKey]) {
      return { provider: providerKey, ok: false, message: `Unknown provider "${providerKey}"` };
    }

    if (authMode === 'chatgpt') {
      return {
        provider: providerKey,
        ok: hasCodexAccessToken(),
        message: hasCodexAccessToken() ? 'Codex login configured' : 'Codex login needed',
      };
    }

    if (authMode === 'claude-code') {
      return {
        provider: providerKey,
        ok: hasClaudeCodeLogin(),
        message: hasClaudeCodeLogin() ? 'Claude Code login configured' : 'Claude Code login needed',
      };
    }

    const key = this.repo.getProviderCredential(organizationId, providerKey);
    if (!key || key.trim() === '') {
      return {
        provider: providerKey,
        ok: false,
        message: providerKey === 'openai-codex' ? 'No Codex login configured' : providerKey === 'anthropic-claude-code' ? 'No Claude Code login configured' : 'No API key configured',
      };
    }

    return { provider: providerKey, ok: true, message: 'Key present' };
  }

  /**
   * Discover models from a provider's `/v1/models` endpoint using the
   * configured baseUrl (or the kind's default) and saved API key. Returns
   * an empty list rather than throwing for "no baseUrl resolvable" so the
   * UI can transparently fall back to the static catalog.
   */
  async discoverModels(organizationId: string, providerName: string): Promise<{ id: string }[]> {
    const team = this.loadTeamForOrganization(organizationId);
    requireOrganization(this.repo, organizationId);
    const normalizedName = normalizeProviderKey(providerName);
    const provider = team.providers[normalizedName];
    if (!provider) {
      throw new Error(`No API key configured for ${providerName}. Models from static catalog shown.`);
    }

    const baseUrl = provider.baseUrl ?? getDefaultOpenAiCompatBaseUrl(provider.kind as ProviderKind);
    if (!baseUrl) return [];

    const apiKey = this.repo.getProviderCredential(organizationId, normalizedName);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { headers });
    if (!response.ok) {
      throw new Error(`Discovery failed: HTTP ${response.status} from ${baseUrl}/models`);
    }
    const body = (await response.json()) as { data?: { id?: unknown }[] };
    const ids = (body.data ?? [])
      .map((entry) => (typeof entry?.id === 'string' ? entry.id : ''))
      .filter((id): id is string => id.length > 0);
    return ids.map((id) => ({ id }));
  }

  addMember(input: AddMemberInput): Member {
    requireOrganization(this.repo, input.organizationId);
    const team = this.loadTeamForOrganization(input.organizationId);
    const existingRole = team.getRole(input.roleName);
    if (input.kind === AGENT_KIND && !input.role && !existingRole) {
      throw new Error(`Role "${input.roleName}" not found`);
    }
    const role = input.role || existingRole
      ? defineRole({
          ...existingRole,
          ...input.role,
          name: input.roleName,
          id: input.role?.id ?? existingRole?.id ?? input.roleName,
          provider: input.role?.provider ?? existingRole?.provider,
          model: input.role?.model ?? existingRole?.model,
        })
      : undefined;
    const memberId =
      input.kind === AGENT_KIND
        ? resolveAgentMemberId(this.repo, input.organizationId, input.name)
        : randomUUID();
    const existingMember =
      input.kind === AGENT_KIND ? this.repo.getMember(input.organizationId, memberId) : null;
    const member = MemberSchema.parse({
      id: memberId,
      organizationId: input.organizationId,
      name: input.name,
      kind: input.kind,
      roleName: input.roleName,
      llm: input.llm ? normalizeProviderKey(input.llm) : undefined,
      model: input.model,
      shellApprovalMode: parseShellApprovalMode(input.shellApprovalMode, existingMember?.shellApprovalMode),
      createdAt: existingMember?.createdAt,
      retiredAt: undefined,
    });
    const saved = this.repo.saveMember(member);
    if (input.kind === AGENT_KIND) {
      upsertDashboardTeamOverride(this.repo, input.organizationId, this.teamStore, {
        role,
        agent: createAgent(saved.id, saved.roleName, input.personalityName ?? 'direct'),
      });
    }
    upsertWorkspaceMemberScopes(
      this.repo,
      input.organizationId,
      saved.id,
      role?.workspaceScopes ?? [],
    );
    ensureMemberSelfChannel(this.repo, input.organizationId, saved);
    addMemberToDefaultChannels(this.repo, team, input.organizationId, saved);
    for (const channelId of input.channelIds ?? []) {
      const channel = this.repo.getChannel(input.organizationId, channelId);
      if (!channel) continue;
      const memberIds = new Set(channel.memberIds);
      memberIds.add(saved.id);
      this.repo.setChannelMembers(input.organizationId, channelId, [...memberIds].sort());
    }
    return saved;
  }

  updateMember(input: UpdateMemberInput): Member {
    requireOrganization(this.repo, input.organizationId);
    const team = this.loadTeamForOrganization(input.organizationId);
    const member = this.repo.getMember(input.organizationId, input.memberId);
    if (!member) {
      throw new Error(`Member not found: ${input.memberId}`);
    }
    if (member.kind !== AGENT_KIND) {
      throw new Error('Only agents can be edited here');
    }

    const existingRole = team.getRole(member.roleName);
    const nextRole = defineRole({
      ...existingRole,
      ...input.role,
      id: input.role.id ?? existingRole?.id ?? input.roleName,
      name: input.roleName,
      kind: AGENT_KIND,
      provider: input.role.provider ?? existingRole?.provider,
      model: input.role.model ?? existingRole?.model,
    });

    const saved = this.repo.saveMember(
      MemberSchema.parse({
        ...member,
        name: input.name,
        roleName: input.roleName,
        llm: input.llm !== undefined ? normalizeProviderKey(input.llm) : member.llm,
        model: input.model !== undefined ? input.model : member.model,
        shellApprovalMode: parseShellApprovalMode(input.shellApprovalMode, member.shellApprovalMode),
      }),
    );

    upsertDashboardTeamOverride(
      this.repo,
      input.organizationId,
      this.teamStore,
      {
        role: nextRole,
        agent: createAgent(saved.id, saved.roleName, input.personalityName),
      },
      {
        previousAgentName: member.id,
        previousRoleName: this.repo.listMembers(input.organizationId).some(
          (item) => item.kind === AGENT_KIND && item.id !== member.id && item.roleName === member.roleName,
        )
          ? undefined
          : member.roleName,
      },
    );

    upsertWorkspaceMemberScopes(
      this.repo,
      input.organizationId,
      saved.id,
      nextRole.workspaceScopes ?? [],
    );

    ensureMemberSelfChannel(this.repo, input.organizationId, saved);
    if (input.channelIds !== undefined) {
      const visibleChannels = visibleChannelsFromRepo(this.repo, input.organizationId);
      const channelIds = new Set(input.channelIds);
      for (const channel of visibleChannels) {
        const memberIds = new Set(channel.memberIds);
        if (channelIds.has(channel.id)) {
          memberIds.add(saved.id);
        } else {
          memberIds.delete(saved.id);
        }
        this.repo.setChannelMembers(input.organizationId, channel.id, [...memberIds].sort());
      }
    }

    return saved;
  }

  patchMemberPreferences(input: PatchMemberPreferencesInput): Member {
    requireOrganization(this.repo, input.organizationId);
    const member = this.repo.getMember(input.organizationId, input.memberId);
    if (!member) {
      throw new Error(`Member not found: ${input.memberId}`);
    }
    if (member.kind !== AGENT_KIND) {
      throw new Error('Only agents can be edited here');
    }
    if (
      input.shellApprovalMode === undefined &&
      input.llm === undefined &&
      input.model === undefined
    ) {
      throw new Error('At least one preference field is required');
    }

    return this.repo.saveMember(
      MemberSchema.parse({
        ...member,
        llm: input.llm !== undefined ? normalizeProviderKey(input.llm) : member.llm,
        model: input.model !== undefined ? input.model : member.model,
        shellApprovalMode: parseShellApprovalMode(input.shellApprovalMode, member.shellApprovalMode),
      }),
    );
  }

  deleteMember(organizationId: string, memberId: string): void {
    requireOrganization(this.repo, organizationId);
    const member = this.repo.getMember(organizationId, memberId);
    if (!member) {
      throw new Error(`Member not found: ${memberId}`);
    }
    if (member.kind !== AGENT_KIND) {
      throw new Error('Only agents can be deleted');
    }

    const now = new Date().toISOString();
    this.repo.saveMember({
      ...member,
      retiredAt: now,
    });

    const otherAgentsUseRole = this.repo.listMembers(organizationId).some(
      (item) =>
        item.kind === AGENT_KIND &&
        item.id !== memberId &&
        !item.retiredAt &&
        item.roleName === member.roleName,
    );

    stripAgentFromPersistedTeamConfig(
      this.repo,
      organizationId,
      memberId,
      member.roleName,
      otherAgentsUseRole,
    );

    deleteDashboardTeamOverride(
      this.repo,
      organizationId,
      this.teamStore,
      memberId,
      member.roleName,
    );

    // Remove the retired member from all channel memberships
    const allChannels = this.repo.listAllChannels(organizationId);
    for (const channel of allChannels) {
      if (channel.memberIds.includes(memberId)) {
        const nextMemberIds = channel.memberIds.filter((id) => id !== memberId);
        this.repo.setChannelMembers(organizationId, channel.id, nextMemberIds);
      }
    }

    // Delete all scheduled jobs owned by the retired member
    const allJobs = this.repo.listScheduledJobs(organizationId);
    for (const job of allJobs) {
      if (job.memberId === memberId) {
        this.repo.deleteScheduledJob(organizationId, job.id);
      }
    }
  }

  addChannel(input: CreateChannelInput): Channel {
    requireOrganization(this.repo, input.organizationId);
    const channel = this.repo.saveChannel(
      ChannelSchema.parse({
        id: randomUUID(),
        organizationId: input.organizationId,
        name: input.name,
        kind: 'group',
        topic: input.topic ?? '',
        memberIds: [],
      }),
    );
    ensureChannelThread(this.repo, input.organizationId, channel);
    return channel;
  }

  async updatePolicies(input: UpdatePoliciesInput): Promise<OrganizationSettingsResponse> {
    requireOrganization(this.repo, input.organizationId);
    const team = this.loadTeamForOrganization(input.organizationId);
    const previousRequireApprovalForWrites = team.config.policies.requireApprovalForWrites;
    const previousRequireApprovalForShell = team.config.policies.requireApprovalForShell;
    const previousShellApprovalMode = team.config.policies.shellApprovalMode;

    if (input.requireApprovalForWrites !== undefined) {
      team.config.policies.requireApprovalForWrites = input.requireApprovalForWrites;
    }
    if (input.shellApprovalMode !== undefined) {
      team.config.policies.shellApprovalMode = input.shellApprovalMode;
      team.config.policies.requireApprovalForShell =
        input.shellApprovalMode !== 'allow_all';
    } else if (input.requireApprovalForShell !== undefined) {
      team.config.policies.requireApprovalForShell = input.requireApprovalForShell;
      team.config.policies.shellApprovalMode = shellApprovalModeFromLegacyRequireShell(
        input.requireApprovalForShell,
      );
    }

    persistTeamConfig(this.repo, input.organizationId, team);

    const effectiveRequireApprovalForWrites = team.config.policies.requireApprovalForWrites;
    const effectiveRequireApprovalForShell = team.config.policies.requireApprovalForShell;
    const effectiveShellApprovalMode = team.config.policies.shellApprovalMode;
    const writesApprovalTurnedOff =
      previousRequireApprovalForWrites !== false &&
      effectiveRequireApprovalForWrites === false;
    const shellApprovalTurnedOff =
      (previousRequireApprovalForShell !== false || previousShellApprovalMode !== 'allow_all') &&
      (effectiveRequireApprovalForShell === false || effectiveShellApprovalMode === 'allow_all');

    if (writesApprovalTurnedOff || shellApprovalTurnedOff) {
      await this.autoApprovePendingByPolicy(input.organizationId, {
        writes: writesApprovalTurnedOff,
        shell: shellApprovalTurnedOff,
      });
    }

    return this.getOrganizationSettings(input.organizationId);
  }

  private async autoApprovePendingByPolicy(
    organizationId: string,
    options: { writes: boolean; shell: boolean },
  ): Promise<void> {
    if (!this.approvals) return;

    const pending = this.repo.listPendingApprovals(organizationId);
    const toApprove = pending.filter((approval) => {
      if (options.shell && approval.resourceType === 'shell' && approval.action === 'execute') {
        return true;
      }
      if (options.writes && approval.action === 'write') {
        return true;
      }
      return false;
    });

    for (const approval of toApprove) {
      await this.approvals.resolveApproval({
        organizationId,
        approvalId: approval.id,
        status: 'approved',
        resolution: 'allow_once',
        reason: 'Auto-approved because policy was disabled.',
      });
    }
  }

  updateChannel(input: UpdateChannelInput): Channel {
    requireOrganization(this.repo, input.organizationId);
    const existing = this.repo.getChannel(input.organizationId, input.channelId);
    if (!existing) {
      throw new Error(`Channel not found: ${input.channelId}`);
    }

    this.repo.saveChannel(
      ChannelSchema.parse({
        ...existing,
        name: input.name ?? existing.name,
        topic: input.topic !== undefined ? input.topic : existing.topic,
      }),
    );
    if (input.memberIds !== undefined) {
      const activeMemberIds = new Set(
        this.repo
          .listMembers(input.organizationId)
          .filter((member) => !member.retiredAt)
          .map((member) => member.id),
      );
      this.repo.setChannelMembers(
        input.organizationId,
        existing.id,
        resolveChannelMemberIds(input.memberIds, activeMemberIds),
      );
    }

    return this.repo.getChannel(input.organizationId, existing.id) ?? existing;
  }

  deleteChannel(organizationId: string, channelId: string): void {
    requireOrganization(this.repo, organizationId);
    const existing = this.repo.getChannel(organizationId, channelId);
    if (!existing) {
      throw new Error(`Channel not found: ${channelId}`);
    }
    this.repo.deleteChannel(organizationId, channelId);
  }

  getOrganizationSettings(organizationId: string): OrganizationSettingsResponse {
    requireOrganization(this.repo, organizationId);
    const organization = this.repo.getOrganization(organizationId);
    if (!organization) {
      throw new Error(`Organization not found: ${organizationId}`);
    }
    return {
      organization,
      members: this.repo.listMembers(organizationId),
      channels: visiblePublicChannels(visibleChannelsFromRepo(this.repo, organizationId)),
    };
  }

  updateOrganizationSettings(input: UpdateOrganizationInput): OrganizationSettingsResponse {
    const organization = this.repo.getOrganization(input.organizationId);
    if (!organization) {
      throw new Error(`Organization not found: ${input.organizationId}`);
    }

    if (
      input.organizationName !== undefined &&
      this.isConfigOwnedField(input.organizationId, 'organization', input.organizationId, 'name')
    ) {
      throw new Error('Organization name is managed by config and cannot be edited here');
    }

    if (input.workspaceRoot !== undefined) {
      if (
        this.isConfigOwnedField(
          input.organizationId,
          'organization',
          input.organizationId,
          'workspace.root',
        )
      ) {
        throw new Error('Project folder is managed by config and cannot be edited here');
      }
    }

    if (input.organizationChart) {
      if (
        this.isConfigOwnedField(
          input.organizationId,
          'organization',
          input.organizationId,
          'organizationChart',
        )
      ) {
        throw new Error('Organization chart is managed by config and cannot be edited here');
      }

      const members = this.repo.listMembers(input.organizationId);
      const owner = members.find((m) => m.kind === 'human' && m.roleName === 'owner');
      if (!owner) {
        throw new Error(
          'Cannot update organization chart: no owner found. Complete onboarding first.',
        );
      }
      const memberIds = new Set(members.map((m) => m.id));
      const agentIds = new Set(members.filter((m) => m.kind === AGENT_KIND).map((m) => m.id));
      validateOrganizationChart(input.organizationChart.reportsTo, memberIds, agentIds, owner.id);
    }

    const nextName = input.organizationName ?? organization.name;
    let nextRoot = organization.workspace.root;
    if (input.workspaceRoot !== undefined) {
      nextRoot = assertWorkspaceRootPathExists(input.workspaceRoot);
      const normalizedRoot = normalizeProjectFolderPath(nextRoot);
      if (normalizedRoot !== normalizeProjectFolderPath(organization.workspace.root)) {
        assertProjectFolderAvailable(
          this.repo,
          this.repo.listOrganizations(),
          normalizedRoot,
          input.organizationId,
        );
      }
    }
    const updated = this.repo.saveOrganization({
      ...organization,
      name: nextName,
      workspace: {
        ...organization.workspace,
        root: nextRoot,
      },
      organizationChart: input.organizationChart ?? organization.organizationChart,
    });

    if (input.organizationName !== undefined || input.workspaceRoot !== undefined) {
      const team = this.loadTeamForOrganization(input.organizationId);
      const config = team.toJSON() as Record<string, unknown>;
      const workspace =
        typeof config.workspace === 'object' && config.workspace
          ? (config.workspace as Record<string, unknown>)
          : {};
      const updatedTeam = loadAgentTeam({
        ...config,
        name: nextName,
        workspace: {
          ...workspace,
          root: nextRoot,
        },
      });
      this.teamStore.setTeam(updatedTeam, input.organizationId);
      persistTeamConfig(this.repo, input.organizationId, updatedTeam);
    }

    return {
      organization: updated,
      members: activeMembers(this.repo, input.organizationId),
      channels: visiblePublicChannels(visibleChannelsFromRepo(this.repo, input.organizationId)),
    };
  }

  private isConfigOwnedField(
    organizationId: string,
    entityType: Parameters<ApiRepository['getConfigFieldOwnership']>[1],
    entityId: string,
    fieldName: string,
  ): boolean {
    const ownership = this.repo.getConfigFieldOwnership(
      organizationId,
      entityType,
      entityId,
      fieldName,
    );
    return ownership?.owner === 'config' && !ownership.allowDashboardOverride;
  }

  /** List all `state: 'allow'` rules from the governance policy across all agents. */
  listAllowRules(organizationId: string): PolicyAllowRuleRecord[] {
    if (this.repo.listGovernanceRules) {
      const rows = this.repo.listGovernanceRules(organizationId, 'allow');
      return rows.map((row) => ({
        agentId: row.agentId,
        mcpId: row.mcpId,
        toolName: row.toolName,
        state: row.state as ToolPolicyState,
        reason: row.reason ?? undefined,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy ?? undefined,
      }));
    }
    return [];
  }

  /** Revoke (remove) a specific allow rule from the governance policy. */
  revokeAllowRule(
    organizationId: string,
    agentId: string,
    mcpId: string,
    toolName: string,
  ): void {
    if (this.repo.deleteGovernanceRule) {
      this.repo.deleteGovernanceRule(organizationId, agentId, mcpId, toolName);
    }
  }
}

export function visibleChannelsFromRepo(repo: ApiRepository, organizationId: string): Channel[] {
  return collectCursorPages((cursor) =>
    repo.listChannels(organizationId, cursor, 500, ['self', 'dm']),
  );
}
