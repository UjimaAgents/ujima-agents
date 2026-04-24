import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import type { AgentTeamHandle } from '@ujima/framework';
import type { Organization, WorkspaceMember } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';

export const ERR_NO_WORKSPACE_ROOT = 'ERR_NO_WORKSPACE_ROOT';
export const ERR_PATH_ESCAPE = 'ERR_PATH_ESCAPE';

export class WorkspaceRootRequiredError extends Error {
  readonly code = ERR_NO_WORKSPACE_ROOT;
  readonly organizationId: string;

  constructor(organizationId: string, reason: string) {
    super(`organization "${organizationId}" is not ready: ${reason}`);
    this.name = 'WorkspaceRootRequiredError';
    this.organizationId = organizationId;
  }
}

export function isWorkspaceRootRequiredError(err: unknown): err is WorkspaceRootRequiredError {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === ERR_NO_WORKSPACE_ROOT;
}

export function isPathEscapeError(err: unknown): err is PathEscapeError {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === ERR_PATH_ESCAPE;
}

export function requireOrganizationWorkspaceRoot(
  repo: Pick<ApiRepository, 'getOrganization'>,
  organizationId: string,
): Organization {
  const organization = repo.getOrganization(organizationId);
  if (!organization) {
    throw new Error(`Organization not found: ${organizationId}`);
  }

  const root = organization.workspace.root.trim();
  if (!root) {
    throw new WorkspaceRootRequiredError(
      organizationId,
      'root_path is not set - complete onboarding first',
    );
  }
  if (!existsSync(root)) {
    throw new WorkspaceRootRequiredError(
      organizationId,
      `workspace root "${root}" does not exist on disk`,
    );
  }

  return organization;
}

export function upsertWorkspaceMemberScopes(
  repo: ApiRepository,
  organizationId: string,
  memberId: string,
  roleScopePaths: readonly string[],
): WorkspaceMember {
  return repo.saveWorkspaceMember({
    organizationId,
    memberId,
    roleScopePaths: [...new Set(roleScopePaths)],
  });
}

export function ensureWorkspaceMemberScopes(
  repo: ApiRepository,
  team: AgentTeamHandle,
  organizationId: string,
  memberId: string,
  roleName: string,
): WorkspaceMember {
  const existing = repo.getWorkspaceMember(organizationId, memberId);
  if (existing) {
    return existing;
  }

  const role = team.getRole(roleName);
  return upsertWorkspaceMemberScopes(
    repo,
    organizationId,
    memberId,
    role?.workspaceScopes ?? [],
  );
}

export async function createMemberPathResolver(
  repo: ApiRepository,
  team: AgentTeamHandle,
  organizationId: string,
  memberId: string,
  roleName: string,
) {
  const organization = requireOrganizationWorkspaceRoot(repo, organizationId);
  const workspaceMember = ensureWorkspaceMemberScopes(
    repo,
    team,
    organizationId,
    memberId,
    roleName,
  );

  return createPathResolver({
    root: organization.workspace.root,
    scopePaths: workspaceMember.roleScopePaths,
  });
}

export class PathEscapeError extends Error {
  readonly code = ERR_PATH_ESCAPE;
  readonly requested: string;
  readonly resolved: string;
  readonly root: string;
  readonly scopePaths: readonly string[];

  constructor(params: {
    requested: string;
    resolved: string;
    root: string;
    scopePaths: readonly string[];
  }) {
    super(
      `path escape: "${params.requested}" resolved to "${params.resolved}" which is outside "${params.root}"` +
        (params.scopePaths.length ? ` (scopes: ${params.scopePaths.join(', ')})` : ''),
    );
    this.name = 'PathEscapeError';
    this.requested = params.requested;
    this.resolved = params.resolved;
    this.root = params.root;
    this.scopePaths = params.scopePaths;
  }
}

export interface ScopedPathResolver {
  readonly root: string;
  readonly scopePaths: readonly string[];
  resolve(requested: string): Promise<string>;
}

async function createPathResolver(opts: {
  root: string;
  scopePaths?: readonly string[];
}): Promise<ScopedPathResolver> {
  if (!isAbsolute(opts.root)) {
    throw new Error(`PathResolver root must be absolute, got "${opts.root}"`);
  }

  const realRoot = await realpath(opts.root);
  const scopePaths: string[] = [];
  for (const scopePath of opts.scopePaths ?? []) {
    const candidate = isAbsolute(scopePath) ? scopePath : resolve(realRoot, scopePath);
    const realScope = await realpathOrParent(candidate);
    if (!withinRoot(realRoot, realScope)) {
      throw new Error(`scope path "${scopePath}" is outside workspace root "${realRoot}"`);
    }
    scopePaths.push(realScope);
  }

  return {
    root: realRoot,
    scopePaths,
    async resolve(requested: string): Promise<string> {
      const candidate = isAbsolute(requested) ? requested : resolve(realRoot, requested);
      const resolved = await resolveCandidatePath(candidate);
      if (!withinRoot(realRoot, resolved.boundaryPath)) {
        throw new PathEscapeError({
          requested,
          resolved: resolved.boundaryPath,
          root: realRoot,
          scopePaths,
        });
      }
      if (
        scopePaths.length > 0 &&
        !scopePaths.some((scope) => withinRoot(scope, resolved.boundaryPath))
      ) {
        throw new PathEscapeError({
          requested,
          resolved: resolved.boundaryPath,
          root: realRoot,
          scopePaths,
        });
      }
      return resolved.targetPath;
    },
  };
}

function withinRoot(root: string, candidate: string): boolean {
  if (candidate === root) {
    return true;
  }
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate.startsWith(prefix);
}

async function realpathOrParent(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!isEnoent(error)) {
      throw error;
    }
    const parent = dirnameStrict(path);
    if (parent === path) {
      return path;
    }
    return realpathOrParent(parent);
  }
}

async function resolveCandidatePath(
  path: string,
): Promise<{ targetPath: string; boundaryPath: string }> {
  try {
    const real = await realpath(path);
    return { targetPath: real, boundaryPath: real };
  } catch (error) {
    if (!isEnoent(error)) {
      throw error;
    }
    return {
      targetPath: path,
      boundaryPath: await realpathOrParent(path),
    };
  }
}

function dirnameStrict(path: string): string {
  const index = path.lastIndexOf(sep);
  if (index <= 0) {
    return sep;
  }
  return path.slice(0, index);
}

function isEnoent(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: string }).code === 'ENOENT';
}
