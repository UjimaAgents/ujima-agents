import {
  ChannelSchema,
  type OrganizationChart,
  type Channel,
  type ToolCapability,
} from '@ujima/shared';
import {
  DEFAULT_GENERAL_CHANNEL,
  normalizeRoleScopes,
  normalizeWorkspaceRoot,
} from '@ujima/shared/workspace';
import { DEFAULT_TOOL_CATALOG } from './constants.js';
import { createAgent, normalizeAgents, type AgentConfig } from './agents.js';
import { normalizeProviders } from './providers.js';
import { createOrganizationChart } from './organization-chart.js';
import { listStarterRolePresets, normalizeRoles } from './roles.js';
import {
  AgentTeamConfigSchema,
  PolicySchema,
  RoleConfigSchema,
  type AgentTeamConfig,
  type ChannelConfig,
  type ProviderConfig,
  type RoleConfig,
} from './schemas.js';
import { normalizeTools } from './tools.js';
import { createWorkspaceConfig } from './workspace.js';

export interface AgentTeamHandle {
  kind: 'ujima.agent-team';
  config: NormalizedAgentTeamConfig;
  workspace: NormalizedAgentTeamConfig['workspace'];
  organizationChart: OrganizationChart;
  agents: AgentConfig[];
  providers: Record<string, ProviderConfig>;
  roles: RoleConfig[];
  channels: Channel[];
  tools: Record<string, ToolCapability>;
  getAgent(name: string): AgentConfig | undefined;
  getRole(name: string): RoleConfig | undefined;
  getChannel(name: string): Channel | undefined;
  getProvider(name: string): ProviderConfig | undefined;
  toJSON(): AgentTeamConfig;
}

export type NormalizedAgentTeamConfig = Omit<AgentTeamConfig, 'channels' | 'agents'> & {
  channels: Channel[];
  agents: AgentConfig[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeChannels(channels: (ChannelConfig | unknown)[] = []): Channel[] {
  const input = channels.length ? channels : [DEFAULT_GENERAL_CHANNEL];

  return input.map((channel) => {
    const record = isRecord(channel) ? channel : {};
    const id =
      typeof record.id === 'string'
        ? record.id
        : typeof record.name === 'string'
          ? record.name
          : 'general';

    return ChannelSchema.parse({
      ...record,
      id,
      organizationId: typeof record.organizationId === 'string' ? record.organizationId : undefined,
    });
  });
}

function validateRoleChannels(roles: RoleConfig[], channels: Channel[]): void {
  const allowedChannels = new Set(channels.map((channel) => channel.name));

  for (const role of roles) {
    for (const channelName of role.channels) {
      if (!allowedChannels.has(channelName)) {
        throw new Error(`Role "${role.name}" references unknown channel "${channelName}"`);
      }
    }
  }
}

function validateRoleProviders(
  roles: RoleConfig[],
  providers: Record<string, ProviderConfig>,
): void {
  for (const role of roles) {
    if (role.provider && !providers[role.provider]) {
      throw new Error(`Role "${role.name}" references unknown provider "${role.provider}"`);
    }
  }
}

function validateRoleTools(roles: RoleConfig[], tools: Record<string, ToolCapability>): void {
  for (const role of roles) {
    for (const toolName of role.tools) {
      if (!tools[toolName]) {
        throw new Error(`Role "${role.name}" references unknown tool "${toolName}"`);
      }
    }
  }
}

export function createStarterAgentTeamConfig({
  name,
  workspaceRoot,
  organizationChart,
  agents,
  providers = {},
  tools = {},
  roleScopes = {},
}: {
  name?: string;
  workspaceRoot?: string;
  organizationChart?: OrganizationChart;
  agents?: AgentConfig[];
  providers?: Record<string, ProviderConfig>;
  tools?: Record<string, unknown>;
  roleScopes?: Record<string, string[]>;
} = {}): NormalizedAgentTeamConfig {
  const root = normalizeWorkspaceRoot(workspaceRoot ?? '.');
  const starterRoles = listStarterRolePresets().map((preset) =>
    RoleConfigSchema.parse({
      ...preset,
      id: preset.name,
      kind: 'agent',
    }),
  );

  const defaultRoleScopes = Object.fromEntries(
    starterRoles.map((preset) => [preset.name, preset.workspaceScopes]),
  ) as Record<string, string[]>;
  const normalizedAgents = normalizeAgents(
    agents ?? starterRoles.map((role) => createAgent(role.name, role.name)),
    starterRoles,
  );

  return {
    name: name ?? 'Ujima Team',
    workspace: createWorkspaceConfig(
      root,
      Object.keys(roleScopes).length > 0 ? roleScopes : defaultRoleScopes,
    ),
    organizationChart: createOrganizationChart(
      organizationChart?.reportsTo ?? {},
      normalizedAgents,
    ),
    agents: normalizedAgents,
    providers: normalizeProviders(providers),
    roles: normalizeRoles(starterRoles, root),
    channels: normalizeChannels([DEFAULT_GENERAL_CHANNEL]),
    tools: normalizeTools(tools),
    policies: PolicySchema.parse({
      requireApprovalForWrites: true,
      requireApprovalForShell: true,
      workspaceBoundaryMode: 'hard',
    }),
  };
}

export function normalizeAgentTeamConfig(config: unknown): NormalizedAgentTeamConfig {
  const input = isRecord(config) ? config : {};
  const channelsInput = Array.isArray(input.channels) ? input.channels : undefined;
  const toolsInput = isRecord(input.tools) ? input.tools : undefined;
  const parsed = AgentTeamConfigSchema.parse({
    ...input,
    channels: channelsInput ?? [DEFAULT_GENERAL_CHANNEL],
    tools: toolsInput ?? DEFAULT_TOOL_CATALOG,
    organizationChart: isRecord(input.organizationChart)
      ? input.organizationChart
      : { reportsTo: {} },
  });

  const workspaceRoot = normalizeWorkspaceRoot(parsed.workspace.root);
  const tools = normalizeTools(parsed.tools);
  const channels = normalizeChannels(parsed.channels);
  const roles = normalizeRoles(parsed.roles, workspaceRoot);
  const agents = normalizeAgents(parsed.agents, roles);
  const providers = normalizeProviders(parsed.providers);
  const roleScopes =
    Object.keys(parsed.workspace.roleScopes).length > 0
      ? normalizeRoleScopes(parsed.workspace.roleScopes, workspaceRoot)
      : {};
  const organizationChart = createOrganizationChart(parsed.organizationChart.reportsTo, agents);

  validateRoleChannels(roles, channels);
  validateRoleProviders(roles, providers);
  validateRoleTools(roles, tools);

  return {
    ...parsed,
    workspace: {
      root: workspaceRoot,
      roleScopes,
    },
    organizationChart,
    agents,
    providers,
    roles,
    channels,
    tools,
  };
}

export function validateAgentTeamConfig(config: unknown): NormalizedAgentTeamConfig {
  return normalizeAgentTeamConfig(config);
}

export function AgentTeam(config: AgentTeamConfig | Record<string, unknown>): AgentTeamHandle {
  const normalized = normalizeAgentTeamConfig(config);

  const handle: AgentTeamHandle = Object.freeze({
    kind: 'ujima.agent-team',
    config: normalized,
    workspace: normalized.workspace,
    organizationChart: normalized.organizationChart,
    agents: normalized.agents,
    providers: normalized.providers,
    roles: normalized.roles,
    channels: normalized.channels,
    tools: normalized.tools,
    getAgent(name: string): AgentConfig | undefined {
      return normalized.agents.find((agent) => agent.name === name);
    },
    getRole(name: string): RoleConfig | undefined {
      return normalized.roles.find((role) => role.name === name || role.id === name);
    },
    getChannel(name: string): Channel | undefined {
      return normalized.channels.find(
        (channel) => channel.name === name || channel.id === name,
      );
    },
    getProvider(name: string): ProviderConfig | undefined {
      return normalized.providers[name];
    },
    toJSON(): AgentTeamConfig {
      return normalized;
    },
  }) as AgentTeamHandle;

  return handle;
}
