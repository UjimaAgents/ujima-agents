import type { AgentTeamHandle } from '@ujima/framework';

export interface TeamStore {
  getTeam(organizationId?: string): AgentTeamHandle | null;
  setTeam(team: AgentTeamHandle, organizationId?: string): void;
}

export function createTeamStore(initial: AgentTeamHandle | null = null): TeamStore {
  const teams = new Map<string, AgentTeamHandle>();
  let current: AgentTeamHandle | null = initial;
  return {
    getTeam: (organizationId) => {
      if (organizationId) {
        return teams.get(organizationId) ?? null;
      }
      return current;
    },
    setTeam: (team, organizationId) => {
      if (organizationId) {
        teams.set(organizationId, team);
      }
      current = team;
    },
  };
}
