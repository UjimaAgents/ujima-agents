import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  buildConnectorScope,
  enrichApprovalScopeForDisplay,
  enrichEditScopeFields,
  readEditRecord,
  type ResourceType,
  type ToolAction,
  type SpiritRole,
  type WakeReason,
} from '@ujima/shared';
import { redactArgs } from './connector-audit.js';
import type {
  PermissionMiddleware,
  PermissionCheckInput,
  PermissionDecision,
  PermissionDenyCode,
} from '@ujima/permissions';
import { randomUUID } from 'node:crypto';
import { ApprovedRunScopeTracker } from '../utils/approved-run-scopes.js';
import type { ApiRepository } from './repository-reader.js';
import { buildShellApprovalScope } from './shell-scope.js';
import { ERR_PATH_ESCAPE } from './workspace-root.js';

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
  // Active task session propagated through worker/supervisor tool calls.
  taskSessionId?: string;
  /**
   * Spirit role that originated this invocation. Set by `SpiritService`
   * when it builds tool definitions; absent on every other invocation
   * path (which is treated the same as `'worker'`).
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
  code?: PermissionDenyCode | 'ERR_PATH_ESCAPE';
  requiresApprovalId?: string;
}

export type RecordPermissionDenial = (
  input: ToolInvocationInput,
  decision: Extract<PermissionDecision, { allowed: false }>,
) => void;

export function permissionDenialResult(
  decision: Extract<PermissionDecision, { allowed: false }>,
): ToolInvocationResult {
  return blockedToolResult(decision.code, decision.reason);
}

export function pathEscapeToolResult(message: string): ToolInvocationResult {
  return blockedToolResult(ERR_PATH_ESCAPE, message);
}

function blockedToolResult(
  code: PermissionDenyCode | 'ERR_PATH_ESCAPE',
  error: string,
): ToolInvocationResult {
  return {
    ok: false,
    error,
    code,
    output: {
      status: 'blocked',
      code,
      error,
    },
  };
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
  // MCP tools must use the same connector:{json} scope shape that the
  // approval row + persisted grant are stored in (buildConnectorActionScope).
  // The matching/gate path used to fall through to the generic
  // `mcp:mcp:server:tool` shape here, so a stored "always allow" grant
  // (connector shape) never matched the gate check (generic shape) and
  // re-prompted forever. Routing MCP through the connector scope unifies
  // store-time and check-time so grants actually stick.
  if (input.toolId === 'mcp') {
    return buildConnectorActionScope(input);
  }
  return buildGenericToolApprovalScope(input);
}

function buildGenericToolApprovalScope(input: ToolInvocationInput): string {
  if (input.toolId === 'shell') {
    return buildShellApprovalScope({ input: input.input, resourcePath: input.resourcePath });
  }
  if (input.toolId === 'mcp') {
    return buildConnectorActionScope(input);
  }
  if (input.toolId === 'write') {
    return `write:${JSON.stringify({ resourcePath: input.resourcePath, content: input.input.content })}`;
  }
  if (input.toolId === 'edit') {
    const fields = enrichEditScopeFields({
      oldString: String(input.input.oldString ?? input.input.old_string ?? ''),
      newString: String(input.input.newString ?? input.input.new_string ?? ''),
      replaceAll: input.input.replaceAll === true || input.input.replace_all === true,
      matchStrategy: input.input.matchStrategy === 'whitespace' || input.input.match_strategy === 'whitespace' ? 'whitespace' : 'exact',
    });
    return `edit:${JSON.stringify({ resourcePath: input.resourcePath, ...fields })}`;
  }
  if (input.toolId === 'multiedit') {
    const edits = (Array.isArray(input.input.edits) ? input.input.edits : [])
      .map((edit) => readEditRecord(edit))
      .filter((edit): edit is NonNullable<typeof edit> => edit !== null)
      .map((edit) => enrichEditScopeFields(edit));
    return `multiedit:${JSON.stringify({ resourcePath: input.resourcePath, edits })}`;
  }
  if (input.toolId === 'download') {
    return `download:${JSON.stringify({ resourcePath: input.resourcePath, url: input.input.url, timeout: input.input.timeout })}`;
  }
  if (input.toolId === 'job_kill') {
    return `job_kill:${JSON.stringify({ job_id: input.input.job_id })}`;
  }
  return `${input.toolId}:${input.action}:${input.resourcePath ?? ''}`;
}

function readApprovalScopeFileContent(resourcePath?: string): string | undefined {
  if (!resourcePath) return undefined;
  try {
    return readFileSync(resourcePath, 'utf8');
  } catch {
    return undefined;
  }
}

export function enrichToolApprovalScopeForRequest(
  scope: string,
  input: ToolInvocationInput,
): string {
  if (!scope.startsWith('edit:') && !scope.startsWith('multiedit:')) {
    return scope;
  }
  return enrichApprovalScopeForDisplay(scope, readApprovalScopeFileContent(input.resourcePath));
}

/**
 * Build the PR 7 `connector:{json}` display scope for an MCP tool
 * invocation that hit the approval gate. Reads server name + tool
 * name + args from the standard MCP invocation `input` shape (the
 * same fields the V2 spawn + legacy MCP wrap both populate). Args
 * are redacted via the §12 secret-key list so the rendered card
 * never displays a token / api_key even if the model handed one in.
 *
 * Falls back to the generic enrichment shape when any required
 * field is missing — the approval card then renders the legacy
 * variant rather than crashing on a partial payload.
 */
export function buildConnectorActionScope(input: ToolInvocationInput): string {
  const data = (input.input ?? {}) as Record<string, unknown>;
  const serverId =
    input.permissionMcpId ??
    (typeof data.mcpServerId === 'string' ? data.mcpServerId : undefined);
  const toolName =
    typeof data.toolName === 'string' ? data.toolName : undefined;
  const serverName =
    typeof data.mcpServerName === 'string' ? data.mcpServerName : serverId;
  if (!serverId || !toolName || !serverName) {
    // Fall back to the generic builder (not buildToolApprovalScope) — the
    // latter routes MCP tools back here, which would recurse.
    return buildGenericToolApprovalScope(input);
  }
  const redacted = redactArgs(data.args);
  let argsPreview = '';
  try {
    argsPreview = JSON.stringify(redacted, null, 2);
  } catch {
    argsPreview = '';
  }
  let argsFingerprint: string | undefined;
  try {
    argsFingerprint = createHash('sha256')
      .update(JSON.stringify(data.args ?? null))
      .digest('hex');
  } catch {
    argsFingerprint = undefined;
  }
  return buildConnectorScope({
    serverId,
    serverDisplayName: serverName,
    toolName,
    argsPreview,
    ...(argsFingerprint ? { argsFingerprint } : {}),
  });
}

export function saveBlockedToolRunStep(
  repo: Pick<ApiRepository, 'saveRunStep'>,
  invocation: ToolInvocationInput,
  output: Record<string, unknown>,
  status: 'ok' | 'blocked',
): void {
  repo.saveRunStep({
    id: randomUUID(),
    organizationId: invocation.organizationId,
    runId: invocation.runId,
    threadId: invocation.threadId,
    agentId: invocation.memberId,
    toolCallId: invocation.toolCallId,
    toolId: invocation.toolId,
    action: invocation.action,
    resourceType: invocation.resourceType,
    resourcePath: invocation.resourcePath ?? '',
    input: invocation.input ?? {},
    output,
    status,
    createdAt: new Date().toISOString(),
  });
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
  approvedRunScopes?: ApprovedRunScopeTracker,
  requestApproval?: ApprovalRequester['requestApproval'],
  recordApprovalWait?: ApprovalWaitRecorder,
  recordPermissionDenial?: RecordPermissionDenial,
): ToolService {
  const scopes = approvedRunScopes ?? new ApprovedRunScopeTracker();

  return {
    async invoke(input) {
      if (input.bypassPermission) {
        return inner.invoke(input);
      }
      const context = await buildContext(input);
      const approvalScope = buildToolApprovalScope(input);

      // Non-destructive check — the inner gate is the sole consumer.
      // This avoids a dual-tracker desync where the replay path
      // (bypassPermission) skips the outer gate, leaving a stale
      // scope only the inner tracker consumed.
      if (scopes.hasApprovedRun(input.organizationId, input.runId, approvalScope)) {
        return inner.invoke(input);
      }
      const decision = await permissions.check(context);

      if (!decision.allowed && decision.gate === 'approval' && requestApproval) {
        // PR 7 connector_action variant — when the gated call is an MCP
        // tool invocation, encode the (server, tool, args) tuple via
        // buildConnectorScope so approval-card-data parses it through
        // parseApprovalDisplayScopesFromReason's connector branch and
        // renders the §5.2 box (Server / Tool / args inline + relabeled
        // "Allow for this run" button) instead of the generic
        // "Approve action" card. Non-MCP calls fall through to the
        // legacy displayScope unchanged.
        const displayScope = enrichToolApprovalScopeForRequest(approvalScope, input);
        const approval = requestApproval({
          organizationId: input.organizationId,
          runId: input.runId,
          toolCallId: input.toolCallId,
          requestedBy: input.memberId,
          resourceType: input.resourceType,
          resourcePath: input.resourcePath ?? '',
          action: input.action,
          reason: `Tool action requires approval;scope=${encodeURIComponent(displayScope)};note=${decision.reason}`,
          approvalScope,
        });
        recordApprovalWait?.(input, approval.id);
        return approvalWaitResult(approval.id);
      }

      if (!decision.allowed) {
        recordPermissionDenial?.(input, decision);
        return permissionDenialResult(decision);
      }

      const result = await inner.invoke(input);
      if (result.ok || result.requiresApprovalId) {
        await permissions.recordCompletedCall(context);
      }
      return result;
    },
    allowRun(organizationId, runId, approvalScope) {
      scopes.allowRun(organizationId, runId, approvalScope);
      inner.allowRun(organizationId, runId, approvalScope);
    },
  };
}
