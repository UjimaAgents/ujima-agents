import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

export const ERR_NO_WORKSPACE_ROOT = 'ERR_NO_WORKSPACE_ROOT';

/**
 * Thrown by `RuntimeHost.startTask` (and anything else that requires a ready
 * workspace) when the target workspace row exists but has no `root_path`, or
 * the configured root does not exist on disk. Surfaces the onboarding gate
 * described in evolution.md Epic 12.9a.
 */
export class NoWorkspaceRootError extends Error {
  readonly code = ERR_NO_WORKSPACE_ROOT;
  readonly workspaceId: string;
  constructor(workspaceId: string, reason: string) {
    super(`workspace "${workspaceId}" is not ready: ${reason}`);
    this.name = 'NoWorkspaceRootError';
    this.workspaceId = workspaceId;
  }
}

export interface Workspace {
  id: string;
  root_path: string | null;
  label: string | null;
  created_at: number;
  updated_at: number;
}

export interface WorkspaceInsert {
  id?: string;
  root_path?: string | null;
  label?: string | null;
}

export interface WorkspaceStore {
  list(): Workspace[];
  get(id: string): Workspace | undefined;
  findByRoot(rootPath: string): Workspace | undefined;
  create(input: WorkspaceInsert): Workspace;
  update(id: string, patch: Partial<Pick<Workspace, 'root_path' | 'label'>>): Workspace;
  remove(id: string): boolean;
  /**
   * Returns the workspace if it exists and has a non-empty `root_path`.
   * Otherwise throws {@link NoWorkspaceRootError}. Does NOT verify the path
   * exists on disk — that's the caller's job (usually PathResolver's
   * realpath resolution).
   */
  requireReady(id: string): Workspace;
}

function normalizeWorkspaceRootPath(rootPath: string | null | undefined): string | null {
  if (typeof rootPath !== 'string') return null;
  const trimmed = rootPath.trim();
  if (!trimmed) return null;
  return resolve(trimmed);
}

export function createWorkspaceStore(raw: DbHandle): WorkspaceStore {
  const listStmt = raw.prepare('SELECT id, root_path, label, created_at, updated_at FROM workspaces ORDER BY created_at ASC');
  const getStmt = raw.prepare('SELECT id, root_path, label, created_at, updated_at FROM workspaces WHERE id = ?');
  const findByRootStmt = raw.prepare('SELECT id, root_path, label, created_at, updated_at FROM workspaces WHERE root_path = ?');
  const insertStmt = raw.prepare(
    'INSERT INTO workspaces (id, root_path, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  );
  const updateStmt = raw.prepare(
    'UPDATE workspaces SET root_path = ?, label = ?, updated_at = ? WHERE id = ?',
  );
  const removeStmt = raw.prepare('DELETE FROM workspaces WHERE id = ?');

  function rowToWorkspace(row: unknown): Workspace | undefined {
    if (!row || typeof row !== 'object') return undefined;
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      root_path: (r.root_path as string | null) ?? null,
      label: (r.label as string | null) ?? null,
      created_at: Number(r.created_at),
      updated_at: Number(r.updated_at),
    };
  }

  return {
    list(): Workspace[] {
      const rows = listStmt.all() as unknown[];
      const out: Workspace[] = [];
      for (const r of rows) {
        const ws = rowToWorkspace(r);
        if (ws) out.push(ws);
      }
      return out;
    },
    get(id: string): Workspace | undefined {
      return rowToWorkspace(getStmt.get(id));
    },
    findByRoot(rootPath: string): Workspace | undefined {
      return rowToWorkspace(findByRootStmt.get(rootPath));
    },
    create(input: WorkspaceInsert): Workspace {
      const id = input.id ?? `ws_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
      const now = Date.now();
      const normalizedRootPath = normalizeWorkspaceRootPath(input.root_path);
      insertStmt.run(id, normalizedRootPath, input.label ?? null, now, now);
      return {
        id,
        root_path: normalizedRootPath,
        label: input.label ?? null,
        created_at: now,
        updated_at: now,
      };
    },
    update(id: string, patch: Partial<Pick<Workspace, 'root_path' | 'label'>>): Workspace {
      const existing = rowToWorkspace(getStmt.get(id));
      if (!existing) throw new Error(`workspace "${id}" not found`);
      const next: Workspace = {
        ...existing,
        root_path:
          'root_path' in patch
            ? normalizeWorkspaceRootPath(patch.root_path)
            : existing.root_path,
        label: 'label' in patch ? patch.label ?? null : existing.label,
        updated_at: Date.now(),
      };
      updateStmt.run(next.root_path, next.label, next.updated_at, id);
      return next;
    },
    remove(id: string): boolean {
      const result = removeStmt.run(id);
      return result.changes > 0;
    },
    requireReady(id: string): Workspace {
      const ws = rowToWorkspace(getStmt.get(id));
      if (!ws) throw new NoWorkspaceRootError(id, 'workspace does not exist');
      if (!ws.root_path || ws.root_path.trim() === '') {
        throw new NoWorkspaceRootError(id, 'root_path is not set — complete onboarding first');
      }
      return ws;
    },
  };
}

interface OrganizationWorkspaceSource {
  id: string;
  name: string;
  workspace: { root: string };
}

/** One organization → one catalog row: `ws_{organizationId}`. */
export function upsertOrganizationWorkspace(
  store: WorkspaceStore,
  organization: OrganizationWorkspaceSource,
): Workspace | undefined {
  const root = organization.workspace?.root?.trim();
  if (!root) return undefined;

  const workspaceId = `ws_${organization.id}`;
  const normalizedRoot = resolve(root);
  const label = organization.name.trim() || 'Workspace';
  const existing = store.get(workspaceId);

  if (!existing) {
    return store.create({
      id: workspaceId,
      root_path: normalizedRoot,
      label,
    });
  }

  const patch: Partial<Pick<Workspace, 'root_path' | 'label'>> = {};
  if (existing.root_path !== normalizedRoot) {
    patch.root_path = normalizedRoot;
  }
  if (label && existing.label !== label) {
    patch.label = label;
  }
  return Object.keys(patch).length > 0 ? store.update(workspaceId, patch) : existing;
}

export function syncWorkspacesFromOrganizations(
  store: WorkspaceStore,
  organizations: readonly OrganizationWorkspaceSource[],
): void {
  for (const organization of organizations) {
    upsertOrganizationWorkspace(store, organization);
  }
}
