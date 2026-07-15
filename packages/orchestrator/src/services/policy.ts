import { relative, sep } from 'node:path';
import type { AgentTeamHandle } from '@ujima/framework';
import type { ShellApprovalMode, ToolAction, SpiritRole, WakeReason } from '@ujima/shared';
import { isSensitiveWorkspacePath } from '@ujima/shared/workspace-file-filters';
import {
  assertWorkspaceBoundary,
  canonicalWorkspacePath,
  isPathWithinScope,
} from '@ujima/shared/workspace';
import { isInScopeFileTool } from '../path-scoped-tools.js';
import {
  ALWAYS_AVAILABLE_AGENT_TOOLS,
  HR_ALWAYS_AVAILABLE_AGENT_TOOLS,
  WORKER_FILESYSTEM_TOOLS,
} from '../tools/index.js';
import { buildPassDenialReason, resolveWakeReplyPolicy } from '../utils/wake-reply-policy.js';

export interface PolicyResult {
  allowed: boolean;
  requiresApproval: boolean;
  /** When true, ToolService may LLM-review shell before human approval. */
  shellAutoReview?: boolean;
  reason?: string;
}

export function resolveShellExecutePolicy(
  mode: ShellApprovalMode | undefined,
): Pick<PolicyResult, 'requiresApproval' | 'shellAutoReview'> | null {
  if (!mode) return null;
  switch (mode) {
    case 'allow_all':
      return { requiresApproval: false, shellAutoReview: false };
    case 'auto_review':
      return { requiresApproval: true, shellAutoReview: true };
    case 'always_review':
      return { requiresApproval: true, shellAutoReview: false };
  }
}

export interface CheckToolPolicyOptions {
  spiritRole?: SpiritRole;
  /**
   * Why the run was woken. When `wakeReason === 'mention'` the
   * mandatory-reply contract kicks in: `channel.pass` is rejected so
   * the agent has to call a posting tool.
   */
  wakeReason?: WakeReason | null;
  threadId?: string;
  /**
   * Whether the DM peer is another agent, resolved by the caller via
   * the authoritative `repo.getMember().kind` (the same source the
   * wake-time palette uses in ai-service.ts / spirit-agent-run.ts).
   * Resolving it here — rather than from `team.agents` names — keeps
   * the gate in agreement with the palette even when member ids differ
   * from configured agent names. Restores `channel.pass` for agent↔agent
   * DMs; omitted/false keeps the human-DM forced-reply contract.
   */
  dmPeerIsAgent?: boolean;
  effectiveShellApprovalMode?: ShellApprovalMode;
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

  if (toolId === 'self.note') {
    return {
      allowed: false,
      requiresApproval: false,
      reason: 'self.note was removed; use memory.write / memory.recall instead.',
    };
  }
  if (toolId === 'memory.save') {
    return {
      allowed: false,
      requiresApproval: false,
      reason: 'memory.save was renamed; use memory.write instead.',
    };
  }

  // L3 — wake/DM reply contract (palette + policy share resolveWakeReplyPolicy).
  // The gate MUST agree with the palette in ai-service.ts / spirit-agent-run.ts
  // on `suppressPassTool`, or the model is offered a `channel.pass` the gate
  // then rejects. `dmPeerIsAgent` is resolved by the caller from the
  // authoritative member roster (`repo.getMember().kind`), the same source the
  // palette uses, so the two never drift.
  const wakeReplyPolicy = resolveWakeReplyPolicy({
    threadId: options.threadId ?? '',
    wakeReason: options.wakeReason,
    dmPeerIsAgent: options.dmPeerIsAgent,
  });

  if (wakeReplyPolicy.suppressPassTool && toolId === 'channel.pass') {
    return {
      allowed: false,
      requiresApproval: false,
      reason: buildPassDenialReason(wakeReplyPolicy),
    };
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

  // Supervisor-only tool families are structurally not a worker surface.
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

  // Agent delegation is an internal orchestration primitive — agents
  // delegate work by posting DM messages, not by accessing
  // the filesystem or shell. Allow without approval or role config.
  if (toolId === 'agent.delegate') {
    return { allowed: true, requiresApproval: false };
  }

  // Durable memory, per-agent procedure, and goal/question
  // management tools are internal management surfaces — they
  // mutate first-party tables (memory_entries, procedures, goals,
  // goal_tasks, interactive_questions), not the workspace or shell.
  // They are intentionally present in ALWAYS_AVAILABLE_AGENT_TOOLS
  // and tagged `bypassPermission: true`, but they use non-read
  // actions ('create', 'update', 'message') so without this branch
  // they fall through to the generic approval rule and stall behind
  // an ApprovalRequest schema that requires a non-empty resourcePath
  // these tools don't have.
  if (
    toolId.startsWith('memory.') ||
    toolId.startsWith('self.procedure.') ||
    toolId.startsWith('goal.') ||
    toolId.startsWith('question.') ||
    toolId.startsWith('org.')
  ) {
    return { allowed: true, requiresApproval: false };
  }

  // Baseline tools (channel primitives, workspace tools,
  // silent terminators, `schedule`) are available to every role
  // regardless of `role.tools`. This mirrors the palette assembled by
  // `resolveToolAllowlist` / `ai-service.ts` so the run-time gate
  // doesn't reject a tool the model just received in its schema.
  const baselineToolIds =
    role.name === 'hr'
      ? (HR_ALWAYS_AVAILABLE_AGENT_TOOLS as readonly string[])
      : ([...ALWAYS_AVAILABLE_AGENT_TOOLS, ...WORKER_FILESYSTEM_TOOLS] as readonly string[]);
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

  let inScopeFileAccess = false;
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

    const canonicalPath = canonicalWorkspacePath(team.workspace.root, resourcePath);
    const pathForSensitivityCheck = canonicalPath.startsWith(team.workspace.root)
      ? relative(team.workspace.root, canonicalPath)
      : resourcePath;
    if (action === 'read' && isSensitiveWorkspacePath(pathForSensitivityCheck)) {
      return {
        allowed: true,
        requiresApproval: true,
        reason: `Reading "${resourcePath}" requires approval because it may contain secrets`,
      };
    }

    // When `role.workspaceScopes` is empty (the default for roles
    // that didn't opt in), fall back to the workspace root for
    // READ actions only. The product mental model is "every agent
    // can look at the workspace"; writes still require an explicit
    // scope to keep blast-radius bounded.
    const effectiveScopes =
      role.workspaceScopes.length > 0
        ? role.workspaceScopes
        : action === 'read'
          ? ['.']
          : role.workspaceScopes;
    const inRoleScope = effectiveScopes.some((scope) =>
      isPathWithinScope(team.workspace.root, scope, resourcePath),
    );
    if (!inRoleScope && action !== 'read') {
      return {
        allowed: true,
        requiresApproval: true,
        reason: `Path "${resourcePath}" is outside allowed scopes for role "${roleName}"`,
      };
    }
    inScopeFileAccess = isInScopeFileTool(toolId, action);
  }

  if (toolId === 'shell' && action === 'execute') {
    const shellPolicy = resolveShellExecutePolicy(options.effectiveShellApprovalMode);
    if (shellPolicy) {
      return { allowed: true, ...shellPolicy };
    }
  }

  return {
    allowed: true,
    requiresApproval:
      !inScopeFileAccess &&
      action !== 'read' &&
      toolId !== 'write' &&
      toolId !== 'edit' &&
      toolId !== 'multiedit',
  };
}

function isGoalArtifactPath(workspaceRoot: string, resourcePath: string): boolean {
  const candidate = canonicalWorkspacePath(workspaceRoot, resourcePath);
  const goalRoot = canonicalWorkspacePath(workspaceRoot, '.ujima-goals');
  return candidate === goalRoot || candidate.startsWith(`${goalRoot}${sep}`);
}
