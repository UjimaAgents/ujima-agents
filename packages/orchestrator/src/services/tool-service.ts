import type { ResourceType, ToolAction, SpiritRole } from '@ujima/shared';
import type { PermissionMiddleware, PermissionCheckInput } from '@ujima/permissions';

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
}

export interface ToolInvocationResult {
  ok: boolean;
  output?: unknown;
  error?: string;
  requiresApprovalId?: string;
}

export interface ToolService {
  invoke(input: ToolInvocationInput): Promise<ToolInvocationResult>;
  allowRun(organizationId: string, runId: string): void;
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

export function createPermissionGatedToolService(
  inner: ToolService,
  permissions: PermissionMiddleware,
  buildContext: PermissionContextBuilder,
  requestApproval?: ApprovalRequester['requestApproval'],
): ToolService {
  const approvedRuns = new Set<string>();

  const runKey = (organizationId: string, runId: string) => `${organizationId}:${runId}`;

  return {
    async invoke(input) {
      if (input.bypassPermission) {
        return inner.invoke(input);
      }
      if (approvedRuns.has(runKey(input.organizationId, input.runId))) {
        return inner.invoke(input);
      }
      const context = await buildContext(input);
      const decision = await permissions.check(context);

      if (!decision.allowed && decision.gate === 'approval' && requestApproval) {
        const approvalScope =
          input.toolId === 'shell'
            ? buildShellApprovalScope(input)
            : `${input.toolId}:${JSON.stringify(input.input)}`;
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
        return {
          ok: false,
          requiresApprovalId: approval.id,
          output: { status: 'waiting_for_approval', approvalId: approval.id },
        };
      }

      if (!decision.allowed) {
        return {
          ok: false,
          error: decision.reason,
        };
      }

      return inner.invoke(input);
    },
    allowRun(organizationId, runId) {
      approvedRuns.add(runKey(organizationId, runId));
      inner.allowRun(organizationId, runId);
    },
  };
}

function buildShellApprovalScope(input: ToolInvocationInput): string {
  const command = typeof input.input.command === 'string' ? input.input.command : '';
  const cwd = typeof input.input.cwd === 'string' ? input.input.cwd : input.resourcePath ?? '';
  return `shell:${JSON.stringify({ cwd, command })}`;
}
