import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentTeamHandle } from '@ujima/framework';
import type { ToolAction } from '@ujima/shared';
import { assertWorkspaceBoundary, isPathInsideRoot } from '@ujima/shared/workspace';

export interface PolicyResult {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
}

export function checkToolPolicy(
  team: AgentTeamHandle,
  roleName: string,
  toolId: string,
  action: ToolAction,
  resourcePath?: string,
): PolicyResult {
  const role = team.getRole(roleName);
  if (!role) {
    return { allowed: false, requiresApproval: false, reason: `Unknown role: ${roleName}` };
  }

  if (!role.tools.includes(toolId)) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `Role "${roleName}" cannot use tool "${toolId}"`,
    };
  }

  if (toolId === 'message') {
    return { allowed: true, requiresApproval: false };
  }

  if (resourcePath) {
    try {
      assertWorkspaceBoundary(team.workspace.root, resourcePath);
    } catch (error) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: (error as Error).message,
      };
    }

    if (!role.workspaceScopes.some((scope) => pathWithinScope(scope, resourcePath))) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: `Path "${resourcePath}" is outside allowed scopes for role "${roleName}"`,
      };
    }
  }

  return {
    allowed: true,
    requiresApproval: action !== 'read',
  };
}

function pathWithinScope(scope: string, resourcePath: string): boolean {
  const normalizedScope = canonicalizeForComparison(scope);
  const normalizedResource = canonicalizeForComparison(resourcePath);
  return isPathInsideRoot(normalizedScope, normalizedResource);
}

function canonicalizeForComparison(path: string): string {
  const resolved = resolve(path);
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}
