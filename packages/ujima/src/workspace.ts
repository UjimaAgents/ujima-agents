import {
  assertWorkspaceBoundary,
  normalizeRoleScopes,
  normalizeWorkspaceRoot,
} from '@ujima/shared/workspace';
import type { RoleScopes, WorkspaceConfig } from '@ujima/shared';

export function createWorkspaceConfig(root: string, roleScopes: RoleScopes = {}): WorkspaceConfig {
  const normalizedRoot = normalizeWorkspaceRoot(root);
  return {
    root: normalizedRoot,
    roleScopes: normalizeRoleScopes(roleScopes, normalizedRoot),
  };
}

export { assertWorkspaceBoundary, normalizeRoleScopes, normalizeWorkspaceRoot };
