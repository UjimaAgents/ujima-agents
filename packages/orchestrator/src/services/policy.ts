import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentTeamHandle } from '@ujima/framework';
import type { ToolAction, SpiritRole } from '@ujima/shared';
import { isSensitiveWorkspacePath } from '@ujima/shared/workspace-file-filters';
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
  options: { spiritRole?: SpiritRole } = {},
): PolicyResult {
  const role = team.getRole(roleName);
  if (!role) {
    return { allowed: false, requiresApproval: false, reason: `Unknown role: ${roleName}` };
  }

  // self.note is the agent's private scratchpad. Per the channels-as-substrate
  // principle, an agent must always be able to think to itself — even if its
  // role doesn't explicitly list `self.note` in `tools`. Always allowed,
  // never approval-gated.
  if (toolId === 'self.note') {
    return { allowed: true, requiresApproval: false };
  }

  // Supervisor-only tools (`supervisor.todo.*`) are gated on TWO axes:
  //   1. The invocation must be tagged `spiritRole === 'supervisor'`
  //      by SpiritService — the only legitimate caller.
  //   2. The tool id must be in SUPERVISOR_TOOL_ALLOWLIST (enforced
  //      downstream in ToolServiceImpl).
  //
  // Without the role-tag check, a worker role configured with
  // `tools: ['supervisor.todo.add']` could mutate scoped state outside
  // the supervisor path — the audit's stated leak. We refuse the
  // bypass when the invocation came from a worker turn, and the
  // normal role-allowlist check below then rejects it. Importantly,
  // this stays restrictive even when the role does list the tool
  // explicitly: the supervisor.* family is structurally not a worker
  // surface.
  if (toolId.startsWith('supervisor.')) {
    if (options.spiritRole === 'supervisor') {
      return { allowed: true, requiresApproval: false };
    }
    return {
      allowed: false,
      requiresApproval: false,
      reason: `Tool "${toolId}" is supervisor-only — invocation spiritRole is "${options.spiritRole ?? 'worker'}"`,
    };
  }

  if (toolId === 'message') {
    return { allowed: true, requiresApproval: false };
  }

  if (toolId === 'mcp') {
    return { allowed: true, requiresApproval: true };
  }

  if (!role.tools.includes(toolId)) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `Role "${roleName}" cannot use tool "${toolId}"`,
    };
  }

  // channel.* tools (post / reply / dm / list / read) operate on the
  // messaging substrate — channel ids and message ids are NOT filesystem
  // paths, so workspace-boundary and per-role scope checks don't apply.
  // Posting/DMing is also not approval-gated by default; the IAM matrix
  // (handled by the @ujima/permissions middleware one layer up) is the
  // place to add finer-grained gating like `junior-qa → channel.dm(senior-*)`.
  if (toolId.startsWith('channel.')) {
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

    if (!role.workspaceScopes.some((scope) => pathWithinScope(team.workspace.root, scope, resourcePath))) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: `Path "${resourcePath}" is outside allowed scopes for role "${roleName}"`,
      };
    }

    if (action === 'read' && isSensitiveWorkspacePath(resourcePath)) {
      return {
        allowed: true,
        requiresApproval: true,
        reason: `Path "${resourcePath}" requires approval`,
      };
    }
  }

  return {
    allowed: true,
    requiresApproval: action !== 'read',
  };
}

function pathWithinScope(workspaceRoot: string, scope: string, resourcePath: string): boolean {
  const normalizedScope = canonicalizeForComparison(scope, workspaceRoot);
  const normalizedResource = canonicalizeForComparison(resourcePath, workspaceRoot);
  return isPathInsideRoot(normalizedScope, normalizedResource);
}

function canonicalizeForComparison(path: string, workspaceRoot: string): string {
  const resolved = resolve(workspaceRoot, path);
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}
