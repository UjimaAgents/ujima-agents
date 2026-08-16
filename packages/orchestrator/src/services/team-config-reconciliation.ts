import { resolve } from 'node:path';
import { migrateAgentTeamConfig } from '@ujima/framework';
import { isPathInsideRoot } from '@ujima/shared/workspace';

export interface NormalizedStoredTeamConfig {
  config: Record<string, unknown>;
  migrated: boolean;
}

/** Apply the one precedence rule for stored config: the active org root wins. */
export function normalizeStoredTeamConfig(
  raw: string,
  activeWorkspaceRoot?: string,
): NormalizedStoredTeamConfig {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (parsed.providers && typeof parsed.providers === 'object') {
    for (const [providerName, providerConfig] of Object.entries(parsed.providers)) {
      if (
        providerConfig &&
        typeof providerConfig === 'object' &&
        !('kind' in providerConfig)
      ) {
        (providerConfig as Record<string, unknown>).kind = providerName;
      }
    }
  }

  const migrated = migrateAgentTeamConfig(parsed);
  const activeRoot = activeWorkspaceRoot?.trim();
  if (!activeRoot) return migrated;

  const workspace = migrated.config.workspace && typeof migrated.config.workspace === 'object'
    ? { ...(migrated.config.workspace as Record<string, unknown>) }
    : {};
  if (workspace.root !== activeRoot) {
    workspace.root = activeRoot;
    migrated.config.workspace = workspace;
    migrated.migrated = true;
  }

  if (normalizeStoredScopes(migrated.config as Record<string, unknown>, activeRoot)) {
    migrated.migrated = true;
  }
  return migrated;
}

function normalizeStoredScopes(config: Record<string, unknown>, workspaceRoot: string): boolean {
  const roles = Array.isArray(config.roles) ? config.roles : [];
  let changed = false;
  for (const role of roles) {
    if (!role || typeof role !== 'object') continue;
    const record = role as Record<string, unknown>;
    if (!Array.isArray(record.workspaceScopes)) continue;
    const originalScopes = record.workspaceScopes;
    const scopes = originalScopes
      .filter((scope): scope is string => typeof scope === 'string' && scope.trim().length > 0)
      .map((scope) => {
        const resolved = resolve(workspaceRoot, scope);
        if (isPathInsideRoot(workspaceRoot, resolved)) return scope;
        changed = true;
        return '.';
      });
    const nextScopes = [...new Set(scopes)];
    if (
      nextScopes.length !== originalScopes.length ||
      nextScopes.some((scope, index) => scope !== originalScopes[index])
    ) {
      record.workspaceScopes = nextScopes;
      changed = true;
    }
  }
  return changed;
}
