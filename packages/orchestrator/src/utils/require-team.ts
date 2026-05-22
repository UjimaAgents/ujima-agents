import type { AgentTeamHandle } from "@ujima/framework";

export function requireTeam(
  teamStore: { getTeam: (organizationId?: string) => AgentTeamHandle | null },
  organizationId?: string,
): AgentTeamHandle {
  const team = teamStore.getTeam(organizationId);
  if (!team) throw new Error("Team config not loaded");
  return team;
}
