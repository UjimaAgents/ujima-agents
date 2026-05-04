import type { AgentTeamHandle } from "@ujima/framework";

export function requireTeam(
  teamStore: { getTeam: () => AgentTeamHandle | null },
): AgentTeamHandle {
  const team = teamStore.getTeam();
  if (!team) throw new Error("Team config not loaded");
  return team;
}
