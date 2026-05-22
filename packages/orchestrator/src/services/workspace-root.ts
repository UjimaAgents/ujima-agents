import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { AgentTeamHandle } from '@ujima/framework';
import {
  formatPathEscapeError,
  type Organization,
  type PathEscapeReason,
  type WorkspaceMember,
} from '@ujima/shared';
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
  return getOrganizationWithWorkspaceRoot(repo, organizationId);
}

export function getOrganizationWithWorkspaceRoot(
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
  return organization;
}

export function assertWorkspaceRootPathExists(workspaceRoot: string): string {
  const trimmed = workspaceRoot.trim();
  if (!trimmed) {
    throw new Error('project folder is required');
  }
  const resolved = resolve(trimmed);
  if (!existsSync(resolved)) {
    throw new Error(`workspace root "${resolved}" does not exist on disk`);
  }
  return resolved;
}

export function requireExistingOrganizationWorkspaceRoot(
  repo: Pick<ApiRepository, 'getOrganization'>,
  organizationId: string,
): Organization {
  const organization = getOrganizationWithWorkspaceRoot(repo, organizationId);
  assertWorkspaceRootPathExists(organization.workspace.root);
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

function roleScopePathsMatch(
  stored: readonly string[],
  desired: readonly string[],
): boolean {
  const normalize = (paths: readonly string[]) =>
    [...new Set(paths.map((path) => path.trim()).filter(Boolean))].sort();
  const left = normalize(stored);
  const right = normalize(desired);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function ensureWorkspaceMemberScopes(
  repo: ApiRepository,
  team: AgentTeamHandle,
  organizationId: string,
  memberId: string,
  roleName: string,
): WorkspaceMember {
  const role = team.getRole(roleName);
  const desiredScopes = role?.workspaceScopes ?? [];
  const existing = repo.getWorkspaceMember(organizationId, memberId);
  if (existing) {
    if (roleScopePathsMatch(existing.roleScopePaths, desiredScopes)) {
      return existing;
    }
    return upsertWorkspaceMemberScopes(repo, organizationId, memberId, desiredScopes);
  }

  return upsertWorkspaceMemberScopes(repo, organizationId, memberId, desiredScopes);
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

  readonly reason: PathEscapeReason;

  constructor(params: {
    requested: string;
    resolved: string;
    root: string;
    scopePaths: readonly string[];
    reason: PathEscapeReason;
  }) {
    super(formatPathEscapeError(params));
    this.name = 'PathEscapeError';
    this.requested = params.requested;
    this.resolved = params.resolved;
    this.root = params.root;
    this.scopePaths = params.scopePaths;
    this.reason = params.reason;
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

  const declaredRoot = resolve(opts.root);
  const realRoot = await realpath(opts.root);
  const scopePaths: string[] = [];
  const scopeBoundaryPaths: string[] = [];
  for (const scopePath of opts.scopePaths ?? []) {
    const candidate = remapCandidateToRealRoot(
      isAbsolute(scopePath) ? scopePath : resolve(realRoot, scopePath),
      declaredRoot,
      realRoot,
    );
    const resolvedScope = await resolveCandidatePath(candidate);
    if (
      !withinRoot(realRoot, resolvedScope.targetPath) ||
      !withinRoot(realRoot, resolvedScope.boundaryPath)
    ) {
      throw new Error(`scope path "${scopePath}" is outside workspace root "${realRoot}"`);
    }
    scopePaths.push(resolvedScope.targetPath);
    scopeBoundaryPaths.push(resolvedScope.boundaryPath);
  }

  return {
    root: realRoot,
    scopePaths,
    async resolve(requested: string): Promise<string> {
      const candidate = remapCandidateToRealRoot(
        isAbsolute(requested) ? requested : resolve(realRoot, requested),
        declaredRoot,
        realRoot,
      );
      const resolved = await resolveCandidatePath(candidate);
      if (
        !withinRoot(realRoot, resolved.targetPath) ||
        !withinRoot(realRoot, resolved.boundaryPath)
      ) {
        throw new PathEscapeError({
          requested,
          resolved: resolved.boundaryPath,
          root: realRoot,
          scopePaths,
          reason: 'workspace',
        });
      }
      if (
        scopePaths.length > 0 &&
        !scopePaths.some(
          (scope, index) =>
            withinRoot(scope, resolved.targetPath) &&
            withinRoot(scopeBoundaryPaths[index] ?? scope, resolved.boundaryPath),
        )
      ) {
        throw new PathEscapeError({
          requested,
          resolved: resolved.boundaryPath,
          root: realRoot,
          scopePaths,
          reason: 'scope',
        });
      }
      return resolved.targetPath;
    },
  };
}

function remapCandidateToRealRoot(candidate: string, declaredRoot: string, realRoot: string): string {
  if (withinRoot(realRoot, candidate)) {
    return candidate;
  }
  if (!withinRoot(declaredRoot, candidate)) {
    return candidate;
  }
  return resolve(realRoot, relative(declaredRoot, candidate));
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
