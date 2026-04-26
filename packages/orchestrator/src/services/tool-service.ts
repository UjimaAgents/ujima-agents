import type { ResourceType, ToolAction } from '@ujima/shared';
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
