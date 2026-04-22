import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadAgentTeamFromFile, type AgentTeamHandle } from '@ujima/framework';

const DEFAULT_TEAM_CONFIG_FILE = 'ujima.config.ts';
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

export function resolveTeamConfigPath(
  configPath: string = process.env.UJIMA_CONFIG_FILE ?? resolve(process.cwd(), DEFAULT_TEAM_CONFIG_FILE),
): string | null {
  const absolutePath = resolve(configPath);
  return existsSync(absolutePath) ? absolutePath : null;
}

export async function loadTeam(configPath?: string): Promise<AgentTeamHandle> {
  const resolvedPath = resolveTeamConfigPath(configPath);
  if (!resolvedPath) {
    throw new Error(`Team config not found: ${configPath ?? DEFAULT_TEAM_CONFIG_FILE}`);
  }
  return loadAgentTeamFromFile(resolvedPath);
}

export async function maybeLoadTeam(configPath?: string): Promise<AgentTeamHandle | null> {
  const resolvedPath = resolveTeamConfigPath(configPath);
  if (!resolvedPath) return null;
  return loadAgentTeamFromFile(resolvedPath);
}

export function isAllowedLocalOrigin(origin: string | null | undefined): boolean {
  if (!origin) return true;
  return LOCAL_ORIGIN.test(origin);
}
