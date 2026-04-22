import type { AgentTeamHandle } from '@ujima/framework';

export interface TeamStore {
  getTeam(): AgentTeamHandle | null;
  setTeam(team: AgentTeamHandle): void;
}

export function createTeamStore(initial: AgentTeamHandle | null = null): TeamStore {
  let current = initial;
  return {
    getTeam: () => current,
    setTeam: (team) => {
      current = team;
    },
  };
}
