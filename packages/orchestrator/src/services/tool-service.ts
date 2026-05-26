import type { ResourceType, ToolAction, SpiritRole, WakeReason } from '@ujima/shared';
import type { PermissionMiddleware, PermissionCheckInput } from '@ujima/permissions';
import { buildShellApprovalScope } from './shell-scope.js';

export interface ToolInvocationInput {
  organizationId: string;
  runId: string;
  memberId: string;
  threadId?: string;
  toolCallId: string;
  toolId: string;
  action: ToolAction;
  resourceType: ResourceType;
  resourcePath?: string;
  input: Record<string, unknown>;
  permissionMcpId?: string;
  permissionToolName?: string;
  bypassPermission?: boolean;
  // Phase 2: spirit worker / supervisor context. The active task
  // session id propagates through every tool call originated by a
  // worker or supervisor turn so scoped tools (`supervisor.todo.*`)
  // can read/write against the right aggregate without the model
  // having to thread it through args.
  taskSessionId?: string;
  /**
   * Spirit role that originated this invocation. The supervisor.*
   * tool family is only callable from `'supervisor'` mode — a
   * worker turn with `supervisor.todo.add` in its role allowlist
   * still gets denied by `checkToolPolicy`. Set by `SpiritService`
   * when it builds tool definitions; absent on every other
   * invocation path (which is treated the same as `'worker'`).
   */
  spiritRole?: SpiritRole;
  /**
   * Why the run that originated this invocation was woken. Plumbed
   * down so `checkToolPolicy` can enforce the mandatory-reply
   * contract on `wakeReason === 'mention'`. Resolved at
   * ToolServiceImpl from the run row when not supplied.
   */
  wakeReason?: WakeReason | null;
}

export interface ToolInvocationResult {
  ok: boolean;
  output?: unknown;
  error?: string;
  requiresApprovalId?: string;
}

export interface ToolService {
  invoke(input: ToolInvocationInput): Promise<ToolInvocationResult>;
  allowRun(organizationId: string, runId: string, approvalScope?: string): void;
}

export type PermissionContextBuilder = (
  input: ToolInvocationInput,
) => PermissionCheckInput | Promise<PermissionCheckInput>;

export interface ApprovalRequester {
  requestApproval(input: {
    organizationId: string;
    runId: string;
    toolCallId: string;
    requestedBy: string;
    resourceType: ToolInvocationInput['resourceType'];
    resourcePath: string;
    action: ToolAction;
    reason: string;
    approvalScope?: string;
  }): { id: string };
}

export type ApprovalWaitRecorder = (
  input: ToolInvocationInput,
  approvalId: string,
) => void;

export function buildToolApprovalScope(input: ToolInvocationInput): string {
  if (input.toolId === 'shell') {
    return buildShellApprovalScope({ input: input.input, resourcePath: input.resourcePath });
  }
  if (input.toolId === 'write') {
    return `write:${JSON.stringify({ resourcePath: input.resourcePath, content: input.input.content })}`;
  }
  if (input.toolId === 'edit') {
    return `edit:${JSON.stringify({ resourcePath: input.resourcePath, oldString: input.input.oldString, newString: input.input.newString, replaceAll: input.input.replaceAll })}`;
  }
  if (input.toolId === 'multiedit') {
    return `multiedit:${JSON.stringify({ resourcePath: input.resourcePath, edits: input.input.edits })}`;
  }
  if (input.toolId === 'download') {
    return `download:${JSON.stringify({ resourcePath: input.resourcePath, url: input.input.url, timeout: input.input.timeout })}`;
  }
  if (input.toolId === 'job_kill') {
    return `job_kill:${JSON.stringify({ job_id: input.input.job_id })}`;
  }
  return `${input.toolId}:${input.action}:${input.resourcePath ?? ''}`;
}

export function approvalWaitResult(approvalId: string): ToolInvocationResult {
  return {
    ok: false,
    requiresApprovalId: approvalId,
    output: { status: 'waiting_for_approval', approvalId },
  };
}

export function createPermissionGatedToolService(
  inner: ToolService,
  permissions: PermissionMiddleware,
  buildContext: PermissionContextBuilder,
  requestApproval?: ApprovalRequester['requestApproval'],
  recordApprovalWait?: ApprovalWaitRecorder,
): ToolService {
  const approvedRuns = new Set<string>();
  const approvedRunScopes = new Set<string>();

  const runKey = (organizationId: string, runId: string) => `${organizationId}:${runId}`;
  return {
    async invoke(input) {
      if (input.bypassPermission) {
        return inner.invoke(input);
      }
      const context = await buildContext(input);
      const approvalScope = buildToolApprovalScope(input);

      if (consumeApprovedRun(input.organizationId, input.runId, approvalScope)) {
        return inner.invoke(input);
      }
      const decision = await permissions.check(context);

      if (!decision.allowed && decision.gate === 'approval' && requestApproval) {
        const approval = requestApproval({
          organizationId: input.organizationId,
          runId: input.runId,
          toolCallId: input.toolCallId,
          requestedBy: input.memberId,
          resourceType: input.resourceType,
          resourcePath: input.resourcePath ?? '',
          action: input.action,
          reason: `Tool action requires approval;scope=${encodeURIComponent(approvalScope)};note=${decision.reason}`,
          approvalScope,
        });
        recordApprovalWait?.(input, approval.id);
        return approvalWaitResult(approval.id);
      }

      if (!decision.allowed) {
        return {
          ok: false,
          error: decision.reason,
        };
      }

      return inner.invoke(input);
    },
    allowRun(organizationId, runId, approvalScope) {
      if (approvalScope) {
        approvedRunScopes.add(scopedRunKey(organizationId, runId, approvalScope));
      } else {
        approvedRuns.add(runKey(organizationId, runId));
      }
      inner.allowRun(organizationId, runId, approvalScope);
    },
  };

  function consumeApprovedRun(organizationId: string, runId: string, approvalScope: string): boolean {
    const scopedKey = scopedRunKey(organizationId, runId, approvalScope);
    if (approvedRunScopes.has(scopedKey)) {
      approvedRunScopes.delete(scopedKey);
      return true;
    }
    const key = runKey(organizationId, runId);
    if (!approvedRuns.has(key)) {
      return false;
    }
    approvedRuns.delete(key);
    return true;
  }

  function scopedRunKey(organizationId: string, runId: string, approvalScope: string): string {
    return `${runKey(organizationId, runId)}:${approvalScope}`;
  }
}
