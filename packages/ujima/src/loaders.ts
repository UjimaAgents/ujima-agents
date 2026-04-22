import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { AgentTeam, type AgentTeamHandle } from './team.js';
import type { AgentTeamConfig } from './schemas.js';

export async function loadAgentTeamConfigFromFile(filePath: string): Promise<unknown> {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.json') {
    const text = await readFile(filePath, 'utf8');
    return JSON.parse(text) as unknown;
  }

  const moduleUrl = pathToFileURL(filePath).href;
  const loaded = await import(moduleUrl);
  return loaded.default ?? loaded.team ?? loaded.config ?? loaded.agentTeam ?? loaded;
}

export async function loadAgentTeamFromFile(filePath: string): Promise<AgentTeamHandle> {
  const config = await loadAgentTeamConfigFromFile(filePath);
  return AgentTeam(config as AgentTeamConfig);
}

export function loadAgentTeam(config: AgentTeamConfig | Record<string, unknown>): AgentTeamHandle {
  return AgentTeam(config);
}
