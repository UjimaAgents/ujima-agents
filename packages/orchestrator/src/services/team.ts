import type { AgentTeamHandle } from '@ujima/framework';
import type { ProviderAuthMode } from '@ujima/shared';
import { hasCodexAccessToken } from '../utils/codex-auth.js';

export interface TeamSummary {
  name: string;
  workspaceRoot: string;
  roles: string[];
  agents: string[];
  channels: string[];
}

export function summarizeTeam(team: AgentTeamHandle): TeamSummary {
  return {
    name: team.config.name,
    workspaceRoot: team.workspace.root,
    roles: team.roles.map((role) => role.name),
    agents: team.agents.map((agent) => agent.name),
    channels: team.channels.map((channel) => channel.name),
  };
}

export interface ProviderStatus {
  name: string;
  hasKey: boolean;
  authMode?: ProviderAuthMode;
}

function providerAuthMode(team: AgentTeamHandle, providerName: string): ProviderAuthMode | undefined {
  const provider = team.providers[providerName];
  return provider?.authMode ?? (providerName === 'openai-codex' ? 'chatgpt' : undefined);
}

export function listProviderStatuses(
  team: AgentTeamHandle,
  credentials: Record<string, boolean>,
): ProviderStatus[] {
  const providers: ProviderStatus[] = [];

  for (const name of Object.keys(team.providers)) {
    const authMode = providerAuthMode(team, name);
    providers.push({
      name,
      hasKey: authMode === 'chatgpt' ? hasCodexAccessToken() : Boolean(credentials[name]),
      authMode,
    });
  }

  return providers;
}

export function validateProviderKeys(
  team: AgentTeamHandle,
  providerKeys: Record<string, string>,
): { unknownProviders: string[]; missingProviders: string[] } {
  const unknownProviders: string[] = [];
  for (const providerName of Object.keys(providerKeys)) {
    if (!team.providers[providerName]) {
      unknownProviders.push(providerName);
    }
  }

  const missingProviders: string[] = [];
  for (const role of team.roles) {
    if (!role.provider) {
      continue;
    }
    if (role.provider === 'ollama') {
      continue;
    }
    if (providerAuthMode(team, role.provider) === 'chatgpt') {
      continue;
    }

    if (!providerKeys[role.provider] && !missingProviders.includes(role.provider)) {
      missingProviders.push(role.provider);
    }
  }

  return { unknownProviders, missingProviders };
}
