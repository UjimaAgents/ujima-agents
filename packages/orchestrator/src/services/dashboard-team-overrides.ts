import {
  AgentTeam,
  createAgent,
  defineRole,
  upgradeLegacyDefaultRoleTools,
  type AgentConfig,
  type RoleConfig,
} from '@ujima/framework';
import { AGENT_KIND } from '@ujima/shared';
import { isPathInsideRoot } from '@ujima/shared/workspace';
import { resolve } from 'node:path';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';

const DASHBOARD_TEAM_OVERRIDES_KEY = 'dashboard.teamOverrides';

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

function readOverrides(
  repo: ApiRepository,
  organizationId: string,
  teamStore: TeamStore,
): DashboardTeamOverrides {
  const value = repo.getWorkspaceSetting(organizationId, DASHBOARD_TEAM_OVERRIDES_KEY);
  if (!value) return { roles: [], agents: [] };

  try {
    const team = teamStore.getTeam(organizationId);
    const members = new Map(
      repo.listMembers(organizationId).map((member) => [member.id, member] as const),
    );
    const parsed = JSON.parse(value) as Partial<DashboardTeamOverrides>;
    const workspaceRoot = team?.workspace.root;
    const roles = Array.isArray(parsed.roles)
      ? parsed.roles.map((role) =>
          normalizeRoleScopes(
            mergeRoleOverride(team?.getRole(role.name), defineRole(upgradeLegacyDefaultRoleTools(role))),
            workspaceRoot ?? '.',
          ),
        )
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

function applyOverrides(
  teamStore: TeamStore,
  organizationId: string,
  overrides: DashboardTeamOverrides,
): void {
  const team = teamStore.getTeam(organizationId);
  if (!team) return;

  const allowedChannelNames = new Set(team.channels.map((channel) => channel.name));
  const sanitizedOverrideRoles = overrides.roles.map((role) =>
    defineRole({
      ...role,
      channels: role.channels.filter((channelName) => allowedChannelNames.has(channelName)),
    }),
  );

  const roles = sanitizedOverrideRoles.reduce(
    (current, role) => upsertBy(current, role, (item) => item.name),
    team.roles,
  );
  const agents = overrides.agents.reduce(
    (current, agent) => upsertBy(current, agent, (item) => item.name),
    team.agents,
  );

  teamStore.setTeam(AgentTeam({ ...team.toJSON(), roles, agents }), organizationId);
}

export function applyDashboardTeamOverrides(
  repo: ApiRepository,
  organizationId: string,
  teamStore: TeamStore,
): void {
  applyOverrides(teamStore, organizationId, readOverrides(repo, organizationId, teamStore));
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
  applyOverrides(teamStore, organizationId, nextOverrides);
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
  applyOverrides(teamStore, organizationId, nextOverrides);
}
