import { existsSync } from 'node:fs';
import type { Repository } from '@ujima/runtime-core';

export const ERR_NO_WORKSPACE_ROOT = 'ERR_NO_WORKSPACE_ROOT';

export class WorkspaceRootNotReadyError extends Error {
  readonly code = ERR_NO_WORKSPACE_ROOT;

  constructor(organizationId: string, reason: string) {
    super(`organization "${organizationId}" is not ready: ${reason}`);
    this.name = 'WorkspaceRootNotReadyError';
  }
}

export function assertReadyWorkspaceRoot(
  repo: Pick<Repository, 'getOrganization'>,
  organizationId: string,
): void {
  const organization = repo.getOrganization(organizationId);
  if (!organization) {
    throw new Error(`Organization not found: ${organizationId}`);
  }

  const root = organization.workspace.root.trim();
  if (!root) {
    throw new WorkspaceRootNotReadyError(
      organizationId,
      'root_path is not set - complete onboarding first',
    );
  }

  if (!existsSync(root)) {
    throw new WorkspaceRootNotReadyError(
      organizationId,
      `workspace root "${root}" does not exist on disk`,
    );
  }
}

export function isWorkspaceRootNotReadyError(err: unknown): err is WorkspaceRootNotReadyError {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === ERR_NO_WORKSPACE_ROOT;
}
