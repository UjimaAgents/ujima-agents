import {
  AgentTeam,
  createAgent,
  defineRole,
  type AgentConfig,
  type RoleConfig,
} from '@ujima/framework';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';

const DASHBOARD_TEAM_OVERRIDES_KEY = 'dashboard.teamOverrides';

interface DashboardTeamOverrides {
  roles: RoleConfig[];
  agents: AgentConfig[];
}

function readOverrides(repo: ApiRepository, organizationId: string): DashboardTeamOverrides {
  const value = repo.getWorkspaceSetting(organizationId, DASHBOARD_TEAM_OVERRIDES_KEY);
  if (!value) return { roles: [], agents: [] };

  try {
    const parsed = JSON.parse(value) as Partial<DashboardTeamOverrides>;
    return {
      roles: Array.isArray(parsed.roles) ? parsed.roles.map((role) => defineRole(role)) : [],
      agents: Array.isArray(parsed.agents)
        ? parsed.agents.map((agent) => createAgent(agent.name, agent.roleName, agent.personalityName ?? 'direct'))
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

function applyOverrides(teamStore: TeamStore, overrides: DashboardTeamOverrides): void {
  const team = teamStore.getTeam();
  if (!team) return;

  const roles = overrides.roles.reduce(
    (current, role) => upsertBy(current, role, (item) => item.name),
    team.roles,
  );
  const agents = overrides.agents.reduce(
    (current, agent) => upsertBy(current, agent, (item) => item.name),
    team.agents,
  );

  teamStore.setTeam(AgentTeam({ ...team.toJSON(), roles, agents }));
}

export function applyDashboardTeamOverrides(
  repo: ApiRepository,
  organizationId: string,
  teamStore: TeamStore,
): void {
  applyOverrides(teamStore, readOverrides(repo, organizationId));
}

export function upsertDashboardTeamOverride(
  repo: ApiRepository,
  organizationId: string,
  teamStore: TeamStore,
  input: { role?: RoleConfig; agent: AgentConfig },
): void {
  const overrides = readOverrides(repo, organizationId);
  const nextOverrides = {
    roles: input.role
      ? upsertBy(overrides.roles, defineRole(input.role), (role) => role.name)
      : overrides.roles,
    agents: upsertBy(
      overrides.agents,
      createAgent(input.agent.name, input.agent.roleName, input.agent.personalityName ?? 'direct'),
      (agent) => agent.name,
    ),
  };

  repo.saveWorkspaceSetting(
    organizationId,
    DASHBOARD_TEAM_OVERRIDES_KEY,
    JSON.stringify(nextOverrides),
  );
  applyOverrides(teamStore, nextOverrides);
}
