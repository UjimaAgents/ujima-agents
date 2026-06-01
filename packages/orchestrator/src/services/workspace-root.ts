import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentTeamHandle } from '@ujima/framework';
import {
  createPathResolver,
  ERR_PATH_ESCAPE,
  PathEscapeError,
  type PathResolver,
} from '@ujima/shared/path-resolver';
import type { Organization, WorkspaceMember } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';

export { ERR_PATH_ESCAPE, PathEscapeError };
export type { PathResolver as ScopedPathResolver };

/**
 * Canonical form for comparing project folder paths across platforms.
 *
 * Resolves symlinks when the path exists on disk so that paths like
 * `/var/tmp/foo` and `/private/var/tmp/foo` (where `/var` is a symlink to
 * `/private/var` on macOS) collapse to the same workspace identity instead of
 * registering as two orgs writing to the same physical directory.
 */
export function normalizeProjectFolderPath(path: string): string {
  const resolved = resolve(path.trim());
  const canonical = existsSync(resolved) ? realpathSync(resolved) : resolved;
  return canonical.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export const ERR_NO_WORKSPACE_ROOT = 'ERR_NO_WORKSPACE_ROOT';

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

export async function createMemberBoundaryPathResolver(
  repo: ApiRepository,
  team: AgentTeamHandle,
  organizationId: string,
  memberId: string,
  roleName: string,
): Promise<PathResolver> {
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
    enforceRoleScopes: false,
  });
}

/** @deprecated Use {@link createMemberBoundaryPathResolver}. */
export const createMemberPathResolver = createMemberBoundaryPathResolver;
