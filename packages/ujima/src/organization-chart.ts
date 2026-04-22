import { OrganizationChartSchema, type OrganizationChart } from '@ujima/shared';
import type { AgentConfig } from './schemas.js';

type AgentRef = Pick<AgentConfig, 'name'>;

function buildAgentLookup(agents: AgentRef[]) {
  const lookup = new Map<string, string>();

  for (const agent of agents) {
    if (lookup.has(agent.name)) {
      throw new Error(`Agent name "${agent.name}" must be unique`);
    }

    lookup.set(agent.name, agent.name);
  }

  return lookup;
}

function resolveAgentRef(ref: string, lookup: Map<string, string>, kind: 'child' | 'parent') {
  const resolved = lookup.get(ref);
  if (!resolved) {
    throw new Error(`Organization chart references unknown ${kind} agent "${ref}"`);
  }

  return resolved;
}

export function createOrganizationChart(
  reportsTo: Record<string, string>,
  agents: AgentRef[],
): OrganizationChart {
  const lookup = buildAgentLookup(agents);
  const normalized: Record<string, string> = {};

  for (const [childRef, parentRef] of Object.entries(
    OrganizationChartSchema.parse({ reportsTo }).reportsTo,
  )) {
    const child = resolveAgentRef(childRef, lookup, 'child');
    const parent = resolveAgentRef(parentRef, lookup, 'parent');

    if (child === parent) {
      throw new Error(`Agent "${child}" cannot report to itself`);
    }

    normalized[child] = parent;
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const walk = (agentName: string) => {
    if (visited.has(agentName)) {
      return;
    }

    if (visiting.has(agentName)) {
      throw new Error(`Organization chart contains a cycle at agent "${agentName}"`);
    }

    visiting.add(agentName);
    const parent = normalized[agentName];
    if (parent) {
      walk(parent);
    }
    visiting.delete(agentName);
    visited.add(agentName);
  };

  for (const agentName of Object.keys(normalized)) {
    walk(agentName);
  }

  return OrganizationChartSchema.parse({ reportsTo: normalized });
}
