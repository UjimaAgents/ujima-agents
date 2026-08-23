import { normalizeProviderKey, type AgentTeamHandle } from '@ujima/framework';
import type { ProviderAuthMode } from '@ujima/shared';
import { hasCodexAccessToken } from '../utils/codex-auth.js';
import { hasClaudeCodeLogin } from '../utils/claude-code-auth.js';

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
  baseUrl?: string;
}

function providerAuthMode(team: AgentTeamHandle, providerName: string): ProviderAuthMode | undefined {
  const provider = team.providers[providerName];
  return provider?.authMode ?? (providerName === 'openai-codex' ? 'chatgpt' as ProviderAuthMode : providerName === 'anthropic-claude-code' ? 'claude-code' as ProviderAuthMode : undefined);
}

export function listProviderStatuses(
  team: AgentTeamHandle,
  credentials: Record<string, boolean>,
): ProviderStatus[] {
  const providers: ProviderStatus[] = [];
  const normalizedCredentials = new Set(
    Object.keys(credentials).map(normalizeProviderKey),
  );

  for (const name of Object.keys(team.providers)) {
    const authMode = providerAuthMode(team, name);
    const baseUrl = team.providers[name]?.baseUrl;
    providers.push({
      name,
      hasKey: authMode === 'chatgpt'
        ? hasCodexAccessToken()
        : (authMode as string) === 'claude-code'
          ? hasClaudeCodeLogin()
          : normalizedCredentials.has(normalizeProviderKey(name)),
      authMode,
      ...(baseUrl ? { baseUrl } : {}),
    });
  }

  return providers;
}

export function validateProviderKeys(
  team: AgentTeamHandle,
  providerKeys: Record<string, string>,
): { unknownProviders: string[]; missingProviders: string[] } {
  const teamProviderNames = new Set(Object.keys(team.providers).map(normalizeProviderKey));
  const credentialNames = new Set(Object.keys(providerKeys).map(normalizeProviderKey));

  const unknownProviders: string[] = [];
  for (const providerName of Object.keys(providerKeys)) {
    if (!teamProviderNames.has(normalizeProviderKey(providerName))) {
      unknownProviders.push(providerName);
    }
  }

  const missingProviders: string[] = [];
  for (const role of team.roles) {
    const provider = role.provider;
    if (!provider || provider === 'ollama') {
      continue;
    }
    const authMode = providerAuthMode(team, provider);
    if (authMode === 'chatgpt' || authMode === 'claude-code') {
      continue;
    }

    if (!credentialNames.has(normalizeProviderKey(provider)) && !missingProviders.includes(provider)) {
      missingProviders.push(provider);
    }
  }

  return { unknownProviders, missingProviders };
}
