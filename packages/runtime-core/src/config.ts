import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadAgentTeamFromFile, type AgentTeamHandle } from '@ujima/framework';

const DEFAULT_TEAM_CONFIG_FILES = ['ujima.config.ts', 'ujima.config.js'] as const;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

export function resolveTeamConfigPath(
  configPath = process.env.UJIMA_TEAM_CONFIG ?? process.env.UJIMA_CONFIG_FILE,
): string | null {
  if (configPath && configPath.trim() !== '') {
    const absolutePath = resolve(configPath);
    return existsSync(absolutePath) ? absolutePath : null;
  }

  for (const fileName of DEFAULT_TEAM_CONFIG_FILES) {
    const absolutePath = resolve(process.cwd(), fileName);
    if (existsSync(absolutePath)) {
      return absolutePath;
    }
  }

  return null;
}

export async function loadTeam(configPath?: string): Promise<AgentTeamHandle> {
  const resolvedPath = resolveTeamConfigPath(configPath);
  if (!resolvedPath) {
    throw new Error(
      `Team config not found: ${configPath ?? DEFAULT_TEAM_CONFIG_FILES.join(' or ')}`,
    );
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
