import { existsSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { AgentTeamHandle } from '@ujima/framework';
import type { ToolAction, SpiritRole, WakeReason } from '@ujima/shared';
import { isSensitiveWorkspacePath } from '@ujima/shared/workspace-file-filters';
import { assertWorkspaceBoundary, isPathInsideRoot } from '@ujima/shared/workspace';
import { ALWAYS_AVAILABLE_AGENT_TOOLS } from '../tools/index.js';
import { isDirectMessageThread } from '../utils/thread-state.js';

export interface PolicyResult {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
}

export interface CheckToolPolicyOptions {
  spiritRole?: SpiritRole;
  /**
   * Why the run was woken. When `wakeReason === 'mention'` the
   * mandatory-reply contract kicks in: `channel.pass` and
   * `self.note` are both rejected so the agent has to call a
   * posting tool. Other reasons leave both tools available.
   */
  wakeReason?: WakeReason | null;
  threadId?: string;
}

export function checkToolPolicy(
  team: AgentTeamHandle,
  roleName: string,
  toolId: string,
  action: ToolAction,
  resourcePath?: string,
  options: CheckToolPolicyOptions = {},
): PolicyResult {
  const role = team.getRole(roleName);
  if (!role) {
    return { allowed: false, requiresApproval: false, reason: `Unknown role: ${roleName}` };
  }

  // L3 — mandatory-reply enforcement. A `@mention`ed run is a
  // contract: someone tagged this agent and expects a posted reply.
  // Allowing `channel.pass` or `self.note` would let the model
  // silently slip out of the obligation. Reject both BEFORE the
  // blanket allows below so the contract holds regardless of role.
  const mandatoryReply = options.wakeReason === 'mention';
  const directMessageThread =
    options.threadId !== undefined && isDirectMessageThread(options.threadId);

  if (mandatoryReply || directMessageThread) {
    if (toolId === 'channel.pass') {
      const reason = mandatoryReply
        ? 'mandatory-reply: you were @mentioned, channel.pass is not allowed. Reply via channel.reply, channel.dm, or message.'
        : 'direct-message: channel.pass is not allowed in a 1:1 DM. Reply via channel.reply, channel.dm, or message.';
      return {
        allowed: false,
        requiresApproval: false,
        reason,
      };
    }
    if (toolId === 'self.note') {
      const reason = mandatoryReply
        ? 'mandatory-reply: you were @mentioned, self.note is not allowed. Reply via channel.reply, channel.dm, or message.'
        : 'direct-message: self.note is not allowed in a 1:1 DM when a reply is expected. Reply via channel.reply, channel.dm, or message.';
      return {
        allowed: false,
        requiresApproval: false,
        reason,
      };
    }
  }

  // self.note is the agent's private scratchpad. Per the channels-as-substrate
  // principle, an agent must always be able to think to itself — even if its
  // role doesn't explicitly list `self.note` in `tools`. Always allowed,
  // never approval-gated — EXCEPT for the `wakeReason === 'mention'`
  // case above, which already returned.
  if (toolId === 'self.note') {
    return { allowed: true, requiresApproval: false };
  }

  // channel.pass is the always-available silent-outcome tool. Every
  // agent must be able to stand down regardless of role config, so
  // we don't gate on `role.tools.includes('channel.pass')`. The
  // mandatory-reply check above already rejects pass for mention runs.
  if (toolId === 'channel.pass') {
    return { allowed: true, requiresApproval: false };
  }

  // Posting tools and channel-read tools are baseline conversational
  // primitives that mirror ALWAYS_AVAILABLE_AGENT_TOOLS — every agent
  // gets them in its palette regardless of `role.tools` declarations.
  // Without this early-allow, the model successfully calls one of
  // these tools (because it's in the palette) and then the
  // `role.tools.includes(toolId)` check below rejects it because
  // the role config didn't redundantly list it. The IAM matrix
  // (one layer up, via the permissions middleware) is the place
  // to add finer-grained gating like "junior-qa cannot DM senior-*".
  if (
    toolId === 'channel.reply' ||
    toolId === 'channel.post' ||
    toolId === 'channel.dm' ||
    toolId === 'channel.read' ||
    toolId === 'channel.list' ||
    toolId === 'message'
  ) {
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

  // `schedule` is in `ALWAYS_AVAILABLE_AGENT_TOOLS` but takes
  // `action: 'message'` (it's a control-plane tool, not a read).
  // The fall-through at the bottom would otherwise mark it
  // `requiresApproval: true` because action is non-`read`. Short-
  // circuit here so the schedule tool is callable without approval.
  if (toolId === 'schedule') {
    return { allowed: true, requiresApproval: false };
  }

  // Baseline tools (channel primitives, read-only workspace tools,
  // silent terminators, `schedule`) are available to every role
  // regardless of `role.tools`. This mirrors the palette assembled by
  // `resolveToolAllowlist` / `ai-service.ts` so the run-time gate
  // doesn't reject a tool the model just received in its schema.
  // Writes (`filesystem`, `edit`, `multiedit`, `write`, `shell`)
  // stay opt-in via `role.tools`. `schedule` is in
  // `ALWAYS_AVAILABLE_AGENT_TOOLS` so it falls through this check
  // without a dedicated branch.
  const baselineToolIds = ALWAYS_AVAILABLE_AGENT_TOOLS as readonly string[];
  if (!baselineToolIds.includes(toolId) && !role.tools.includes(toolId)) {
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

    if (
      (action === 'write' || toolId === 'write' || toolId === 'edit' || toolId === 'multiedit') &&
      isGoalArtifactPath(team.workspace.root, resourcePath)
    ) {
      return { allowed: true, requiresApproval: false };
    }

    // When `role.workspaceScopes` is empty (the default for roles
    // that didn't opt in), fall back to the workspace root for
    // READ actions only. The product mental model is "every agent
    // can look at the workspace"; writes still require an explicit
    // scope to keep blast-radius bounded. The sensitive-path filter
    // below still applies in both cases.
    const effectiveScopes =
      role.workspaceScopes.length > 0
        ? role.workspaceScopes
        : action === 'read'
          ? ['.']
          : role.workspaceScopes;
    if (!effectiveScopes.some((scope) => pathWithinScope(team.workspace.root, scope, resourcePath))) {
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

function isGoalArtifactPath(workspaceRoot: string, resourcePath: string): boolean {
  const candidate = canonicalizeForComparison(resourcePath, workspaceRoot);
  const goalRoot = canonicalizeForComparison(join(workspaceRoot, '.ujima-goals'), workspaceRoot);
  return candidate === goalRoot || candidate.startsWith(`${goalRoot}${sep}`);
}
