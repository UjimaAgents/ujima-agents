import { type MemberKind } from '@ujima/shared';
import { getPersonalityPreset } from './personality.js';
import { AgentConfigSchema, type AgentConfig, type RoleConfig } from './schemas.js';

export { AgentConfigSchema, type AgentConfig } from './schemas.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateUniqueAgentNames(agents: AgentConfig[]) {
  const names = new Set<string>();

  for (const agent of agents) {
    if (names.has(agent.name)) {
      throw new Error(`Agent name "${agent.name}" must be unique`);
    }

    names.add(agent.name);
  }
}

function validateAgentRoles(agents: AgentConfig[], roles: RoleConfig[]) {
  const roleNames = new Set(roles.map((role) => role.name));

  for (const agent of agents) {
    if (!roleNames.has(agent.roleName)) {
      throw new Error(`Agent "${agent.name}" references unknown role "${agent.roleName}"`);
    }
  }
}

function validateAgentPersonalities(agents: AgentConfig[]) {
  for (const agent of agents) {
    if (!getPersonalityPreset(agent.personalityName)) {
      throw new Error(
        `Agent "${agent.name}" references unknown personality "${agent.personalityName}"`,
      );
    }
  }
}

export function normalizeAgents(agents: unknown[] = [], roles: RoleConfig[] = []): AgentConfig[] {
  const input = agents.length
    ? agents
    : roles.map((role) =>
        AgentConfigSchema.parse({
          name: role.name,
          roleName: role.name,
          personalityName: 'direct',
          kind: 'agent' satisfies MemberKind,
        }),
      );

  const normalized = input.map((agent) => {
    const record = isRecord(agent) ? agent : {};
    return AgentConfigSchema.parse({
      ...record,
      personalityName:
        typeof record.personalityName === 'string' ? record.personalityName : 'direct',
      kind: typeof record.kind === 'string' ? record.kind : 'agent',
    });
  });

  validateUniqueAgentNames(normalized);
  validateAgentRoles(normalized, roles);
  validateAgentPersonalities(normalized);

  return normalized;
}

export function createAgent(
  name: string,
  roleName: string,
  personalityName = 'direct',
): AgentConfig {
  return AgentConfigSchema.parse({ name, roleName, personalityName, kind: 'agent' });
}
