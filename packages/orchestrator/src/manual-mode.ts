import type { AgentDef, TeamDef } from '@ujima/shared';
import type { OrchestratorDeps } from './types';

export interface ManualTeamResolution {
  team: TeamDef;
  agents: AgentDef[];
  missing: string[];
}

export async function resolveManualTeam(
  deps: Pick<OrchestratorDeps, 'resolveAgent'>,
  team: TeamDef,
): Promise<ManualTeamResolution> {
  const agents: AgentDef[] = [];
  const missing: string[] = [];
  for (const agentId of team.agents) {
    const resolved = await deps.resolveAgent(agentId);
    if (!resolved) missing.push(agentId);
    else agents.push(resolved);
  }
  return { team, agents, missing };
}

export function groupAgentsByMCP(agents: AgentDef[]): Map<string, AgentDef[]> {
  const groups = new Map<string, AgentDef[]>();
  for (const agent of agents) {
    const bucket = groups.get(agent.mcp) ?? [];
    bucket.push(agent);
    groups.set(agent.mcp, bucket);
  }
  return groups;
}
