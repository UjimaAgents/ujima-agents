import {
  assertWorkspaceBoundary,
  isPathWithinScope,
} from './workspace-paths.js';

export type WorkspaceAccessOperation = 'read' | 'write' | 'execute';

export interface WorkspaceAccessRequest {
  workspaceRoot: string;
  roleScopes: readonly string[];
  resourcePath: string;
  operation: WorkspaceAccessOperation;
}

export interface WorkspaceAccessDecision {
  allowed: boolean;
  canonicalPath?: string;
  reason?: string;
}

/** One synchronous access decision shared by policy and tool adapters. */
export function resolveWorkspaceAccess(
  input: WorkspaceAccessRequest,
): WorkspaceAccessDecision {
  let canonicalPath: string;
  try {
    canonicalPath = assertWorkspaceBoundary(input.workspaceRoot, input.resourcePath);
  } catch (error) {
    return { allowed: false, reason: (error as Error).message };
  }

  if (input.roleScopes.length === 0) {
    return {
      allowed: false,
      canonicalPath,
      reason: `Role has no workspace scope for ${input.operation} access to "${input.resourcePath}"`,
    };
  }

  if (
    !input.roleScopes.some((scope) =>
      isPathWithinScope(input.workspaceRoot, scope, canonicalPath),
    )
  ) {
    return {
      allowed: false,
      canonicalPath,
      reason: `Path "${input.resourcePath}" is outside the role workspace scopes`,
    };
  }

  return { allowed: true, canonicalPath };
}
