import {
  AgentTeam,
  createAgent,
  defineRole,
  loadAgentTeam,
  upgradeLegacyDefaultRoleTools,
  type AgentConfig,
  type AgentTeamHandle,
  type RoleConfig,
} from '@ujima/framework';
import { AGENT_KIND } from '@ujima/shared';
import { isPathInsideRoot } from '@ujima/shared/workspace';
import { resolve } from 'node:path';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';

const DASHBOARD_TEAM_OVERRIDES_KEY = 'dashboard.teamOverrides';
const TEAM_CONFIG_SETTING_KEY = 'team.config';

interface DashboardTeamOverrides {
  roles: RoleConfig[];
  agents: AgentConfig[];
}

function mergeRoleOverride(baseRole: RoleConfig | undefined, role: RoleConfig): RoleConfig {
  return defineRole({
    ...baseRole,
    ...role,
    id: role.id ?? baseRole?.id ?? role.name,
    name: role.name,
    provider: role.provider ?? baseRole?.provider,
    model: role.model ?? baseRole?.model,
  });
}

function normalizeRoleScopes(role: RoleConfig, workspaceRoot: string): RoleConfig {
  const scopes = role.workspaceScopes.map((scope) => {
    const resolved = resolve(workspaceRoot, scope);
    return isPathInsideRoot(workspaceRoot, resolved) ? scope : '.';
  });
  return {
    ...role,
    workspaceScopes: [...new Set(scopes)],
  };
}

function normalizeRoleProvider(role: RoleConfig, baseRole: RoleConfig | undefined, team: AgentTeamHandle | undefined): RoleConfig {
  if (!role.provider || team?.providers[role.provider]) return role;
  return {
    ...role,
    provider: baseRole?.provider,
    model: baseRole?.model,
  };
}

function normalizeRoleTools(role: RoleConfig, baseRole: RoleConfig | undefined, team: AgentTeamHandle | undefined): RoleConfig {
  if (!team) return role;
  const tools = role.tools.filter((tool) => team.tools[tool]);
  return {
    ...role,
    tools: tools.length > 0 ? tools : (baseRole?.tools ?? role.tools),
  };
}

function readOverrides(
  repo: ApiRepository,
  organizationId: string,
  teamStore: TeamStore,
): DashboardTeamOverrides {
  const value = repo.getWorkspaceSetting(organizationId, DASHBOARD_TEAM_OVERRIDES_KEY);
  if (!value) return { roles: [], agents: [] };

  try {
    const team = teamStore.getTeam(organizationId) ?? undefined;
    const members = new Map(
      repo.listMembers(organizationId).map((member) => [member.id, member] as const),
    );
    const parsed = JSON.parse(value) as Partial<DashboardTeamOverrides>;
    const workspaceRoot = team?.workspace.root;
    const roles = Array.isArray(parsed.roles)
      ? parsed.roles.map((role) => {
          const baseRole = team?.getRole(role.name);
          return normalizeRoleScopes(
            normalizeRoleTools(
              normalizeRoleProvider(
                mergeRoleOverride(baseRole, defineRole(upgradeLegacyDefaultRoleTools(role))),
                baseRole,
                team,
              ),
              baseRole,
              team,
            ),
            workspaceRoot ?? '.',
          );
        })
      : [];
    if (Array.isArray(parsed.roles) && JSON.stringify(parsed.roles) !== JSON.stringify(roles)) {
      repo.saveWorkspaceSetting(
        organizationId,
        DASHBOARD_TEAM_OVERRIDES_KEY,
        JSON.stringify({ ...parsed, roles }),
      );
    }
    return {
      roles,
      agents: Array.isArray(parsed.agents)
        ? parsed.agents
            .map((agent) => createAgent(agent.name, agent.roleName, agent.personalityName ?? 'direct'))
            .filter((agent) => {
              const member = members.get(agent.name);
              return !member || (member.kind === AGENT_KIND && !member.retiredAt);
            })
        : [],
    };
  } catch {
    return { roles: [], agents: [] };
  }
}

function upsertBy<T>(items: T[], next: T, keyOf: (item: T) => string): T[] {
  const key = keyOf(next);
  const filtered = items.filter((item) => keyOf(item) !== key);
  return [...filtered, next];
}

function loadPersistedBaseTeam(
  repo: ApiRepository,
  organizationId: string,
  fallback: AgentTeamHandle,
): AgentTeamHandle {
  const stored = repo.getWorkspaceSetting(organizationId, TEAM_CONFIG_SETTING_KEY);
  if (!stored) return fallback;
  try {
    return loadAgentTeam(JSON.parse(stored) as Record<string, unknown>);
  } catch {
    return fallback;
  }
}

function withoutRetiredDashboardAgents(
  repo: ApiRepository,
  organizationId: string,
  agents: AgentConfig[],
): AgentConfig[] {
  const members = new Map(
    repo.listMembers(organizationId).map((member) => [member.id, member] as const),
  );
  return agents.filter((agent) => {
    const member = members.get(agent.name);
    return !member || (member.kind === AGENT_KIND && !member.retiredAt);
  });
}

function applyOverrides(
  repo: ApiRepository,
  teamStore: TeamStore,
  organizationId: string,
  overrides: DashboardTeamOverrides,
): void {
  const team = teamStore.getTeam(organizationId);
  if (!team) return;

  const base = loadPersistedBaseTeam(repo, organizationId, team);
  const allowedChannelNames = new Set(team.channels.map((channel) => channel.name));
  const sanitizedOverrideRoles = overrides.roles.map((role) =>
    defineRole({
      ...role,
      channels: role.channels.filter((channelName) => allowedChannelNames.has(channelName)),
    }),
  );

  const roles = sanitizedOverrideRoles.reduce(
    (current, role) => upsertBy(current, role, (item) => item.name),
    [...base.roles],
  );
  const agents = withoutRetiredDashboardAgents(
    repo,
    organizationId,
    overrides.agents.reduce(
      (current, agent) => upsertBy(current, agent, (item) => item.name),
      [...base.agents],
    ),
  );

  teamStore.setTeam(AgentTeam({ ...team.toJSON(), roles, agents }), organizationId);
}

export function applyDashboardTeamOverrides(
  repo: ApiRepository,
  organizationId: string,
  teamStore: TeamStore,
): void {
  applyOverrides(repo, teamStore, organizationId, readOverrides(repo, organizationId, teamStore));
}

export function upsertDashboardTeamOverride(
  repo: ApiRepository,
  organizationId: string,
  teamStore: TeamStore,
  input: { role?: RoleConfig; agent: AgentConfig },
  options: { previousAgentName?: string; previousRoleName?: string } = {},
): void {
  const overrides = readOverrides(repo, organizationId, teamStore);
  const roles = options.previousRoleName
    ? overrides.roles.filter((role) => role.name !== options.previousRoleName)
    : overrides.roles;
  const agents = options.previousAgentName
    ? overrides.agents.filter((agent) => agent.name !== options.previousAgentName)
    : overrides.agents;
  const nextOverrides = {
    roles: input.role
      ? upsertBy(
          roles,
          mergeRoleOverride(teamStore.getTeam(organizationId)?.getRole(input.role.name), defineRole(input.role)),
          (role) => role.name,
        )
      : roles,
    agents: upsertBy(agents, createAgent(input.agent.name, input.agent.roleName, input.agent.personalityName ?? 'direct'), (agent) => agent.name),
  };

  repo.saveWorkspaceSetting(
    organizationId,
    DASHBOARD_TEAM_OVERRIDES_KEY,
    JSON.stringify(nextOverrides),
  );
  applyOverrides(repo, teamStore, organizationId, nextOverrides);
}

export function deleteDashboardTeamOverride(
  repo: ApiRepository,
  organizationId: string,
  teamStore: TeamStore,
  memberId: string,
  roleName: string,
): void {
  const overrides = readOverrides(repo, organizationId, teamStore);
  const agents = overrides.agents.filter((agent) => agent.name !== memberId);
  const otherAgentsUseRole = repo.listMembers(organizationId).some(
    (item) => item.kind === AGENT_KIND && item.id !== memberId && !item.retiredAt && item.roleName === roleName,
  );
  const roles = otherAgentsUseRole
    ? overrides.roles
    : overrides.roles.filter((role) => role.name !== roleName);

  const nextOverrides = {
    roles,
    agents,
  };

  repo.saveWorkspaceSetting(
    organizationId,
    DASHBOARD_TEAM_OVERRIDES_KEY,
    JSON.stringify(nextOverrides),
  );
  applyOverrides(repo, teamStore, organizationId, nextOverrides);
}

export function stripAgentFromPersistedTeamConfig(
  repo: ApiRepository,
  organizationId: string,
  memberId: string,
  roleName: string,
  keepRole: boolean,
): void {
  const stored = repo.getWorkspaceSetting(organizationId, TEAM_CONFIG_SETTING_KEY);
  if (!stored) return;

  try {
    const config = JSON.parse(stored) as {
      agents?: AgentConfig[];
      roles?: RoleConfig[];
    };
    const agents = (config.agents ?? []).filter((agent) => agent.name !== memberId);
    const roles = keepRole
      ? config.roles
      : (config.roles ?? []).filter((role) => role.name !== roleName);
    repo.saveWorkspaceSetting(
      organizationId,
      TEAM_CONFIG_SETTING_KEY,
      JSON.stringify({ ...config, agents, roles }),
    );
  } catch {
    // Ignore invalid persisted config; applyOverrides still rebuilds from teamStore fallback.
  }
}
