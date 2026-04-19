import type { AgentTeamHandle } from "@ujima/framework";
import { assertWorkspaceBoundary, isPathInsideRoot, type ToolAction } from "@ujima/shared";

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

    if (!role.workspaceScopes.some((scope) => isPathInsideRoot(scope, resourcePath))) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: `Path "${resourcePath}" is outside allowed scopes for role "${roleName}"`,
      };
    }
  }

  return {
    allowed: true,
    requiresApproval: action !== "read",
  };
}

