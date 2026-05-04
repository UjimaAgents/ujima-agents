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

export function createPermissionGatedToolService(
  inner: ToolService,
  permissions: PermissionMiddleware,
  buildContext: PermissionContextBuilder,
): ToolService {
  return {
    async invoke(input) {
      if (input.bypassPermission) {
        return inner.invoke(input);
      }
      const context = await buildContext(input);
      const decision = await permissions.check(context);

      if (!decision.allowed) {
        return {
          ok: false,
          error: decision.reason,
        };
      }

      return inner.invoke(input);
    },
    allowRun(organizationId, runId) {
      inner.allowRun(organizationId, runId);
    },
  };
}
