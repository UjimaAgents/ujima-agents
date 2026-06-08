import { randomUUID } from 'node:crypto';
import { AuditEventSchema, type AuditEvent } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';

// Connector telemetry — §12 of mcp_connector_dispatch_plan.md.
//
// One helper per §12.2 event type. All five route through saveAuditEvent
// with the unwrapped (server_id, tool_name, args_json) tuple in their
// own columns (PR 7's substrate) so operator queries hit the
// `idx_audit_server_tool` index instead of scanning metadata blobs.
//
// PR 8 ships the writers only. Reading these rows back lands in the
// curation job (PR 9). The §5.3 timeline rows (PR 7) bind to a
// snapshot of these audit rows surfaced through the run-timeline API,
// not by querying the audit table directly per render.
//
// args_json is redacted at write time by the default policy below.
// `password`, `token`, `secret`, `api_key`, and `authorization` are
// stripped from any top-level or nested object key (case-insensitive,
// matches snake_case + camelCase variants). The un-redacted args still
// live in the per-task `task_audit_events` table's `tool_input` for
// debug; this is the org-wide grep-able copy.

interface WriterDeps {
  /** The narrow slice of the repository surface we need. */
  repo: Pick<ApiRepository, 'saveAuditEvent'>;
  /** Override for tests. Defaults to a fresh UUID per call. */
  generateId?: () => string;
  /** Override for tests. Defaults to `new Date().toISOString()`. */
  now?: () => string;
  /**
   * Override the default secret-key redaction list. Per-org policy
   * (§12.2) lives here; the dispatch plan doesn't specify the per-org
   * store yet so PR 8 ships the default policy in-process. PR 9 can
   * thread an OrgRedactionPolicy through without touching call sites.
   */
  redactKeys?: string[];
}

const DEFAULT_REDACT_KEYS = [
  'password',
  'token',
  'secret',
  'api_key',
  'apikey',
  'authorization',
  'auth',
];

const REDACTED_VALUE = '***';

/**
 * Walks a structured value and replaces any leaf whose key (or nested
 * parent key) matches a redact-list entry with `***`. Case-insensitive
 * and matches both `apiKey` and `api_key` variants so the policy
 * doesn't drift across the snake/camel boundary.
 *
 * Returns the original value unchanged when there's nothing to redact
 * so the common case (no secrets in args) costs one allocation, not a
 * full deep clone.
 */
export function redactArgs(value: unknown, redactKeys: string[] = DEFAULT_REDACT_KEYS): unknown {
  const lowered = new Set(redactKeys.map((k) => k.toLowerCase().replace(/_/g, '')));
  function walk(node: unknown): unknown {
    if (Array.isArray(node)) {
      return node.map((item) => walk(item));
    }
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        const normalized = key.toLowerCase().replace(/_/g, '');
        out[key] = lowered.has(normalized) ? REDACTED_VALUE : walk(child);
      }
      return out;
    }
    return node;
  }
  return walk(value);
}

function serializeArgs(args: unknown, redactKeys?: string[]): string {
  try {
    return JSON.stringify(redactArgs(args, redactKeys));
  } catch {
    // Circular or non-serialisable args — record their shape rather than
    // dropping the audit row entirely. The actual call still proceeds;
    // the operator just loses arg-level grep on this one event.
    return JSON.stringify({ _serializeError: true });
  }
}

export interface ConnectorAuditWriter {
  toolsListed(input: ConnectorToolsListedInput): void;
  invocationRequested(input: ConnectorInvocationInput): void;
  invocationResolved(input: ConnectorInvocationResolvedInput): void;
  invocationCompleted(input: ConnectorInvocationCompletedInput): void;
  tierChanged(input: ConnectorTierChangedInput): void;
}

export interface ConnectorToolsListedInput {
  organizationId: string;
  /** Member id of the agent that called get_connector_tools. */
  actorMemberId: string;
  runId: string;
  serverId: string;
  /** Tool count actually returned to the model (after grant filtering). */
  fetchedToolCount: number;
}

export interface ConnectorInvocationInput {
  organizationId: string;
  actorMemberId: string;
  runId: string;
  serverId: string;
  toolName: string;
  args: unknown;
  /** Classification at the gate. 'unknown' when classifier returned nothing. */
  riskClass?: string;
}

export interface ConnectorInvocationResolvedInput {
  organizationId: string;
  /** Member id of the human resolver, when known. */
  resolverMemberId?: string;
  /** Approval row id. The matching `_requested` event lives on the same runId. */
  approvalId: string;
  runId?: string;
  serverId: string;
  toolName: string;
  resolution: 'allow_once' | 'allow_family' | 'allow_always' | 'reject';
  scope?: string;
}

export interface ConnectorInvocationCompletedInput {
  organizationId: string;
  actorMemberId: string;
  runId: string;
  serverId: string;
  toolName: string;
  success: boolean;
  errorMessage?: string;
}

export interface ConnectorTierChangedInput {
  organizationId: string;
  /** Member id of the agent whose attachment was retiered. */
  memberId: string;
  /** Member id (operator) who flipped the toggle. May be unknown today. */
  changedBy?: string;
  serverId: string;
  fromTier: 'native' | 'dispatch';
  toTier: 'native' | 'dispatch';
  reason?: string;
}

/**
 * Builds the §12.2 emitters bound to one repository instance. Call
 * sites use the typed methods; the writer handles event id, timestamp,
 * arg redaction, and serialisation.
 */
export function createConnectorAuditWriter(deps: WriterDeps): ConnectorAuditWriter {
  const newId = deps.generateId ?? (() => `aud_${randomUUID()}`);
  const newNow = deps.now ?? (() => new Date().toISOString());
  const redactKeys = deps.redactKeys;

  function write(partial: Omit<AuditEvent, 'id' | 'createdAt' | 'status'> & Partial<Pick<AuditEvent, 'status'>>): void {
    deps.repo.saveAuditEvent(
      AuditEventSchema.parse({
        id: newId(),
        createdAt: newNow(),
        status: partial.status ?? 'ok',
        ...partial,
      }),
    );
  }

  return {
    toolsListed(input) {
      write({
        organizationId: input.organizationId,
        actorId: input.actorMemberId,
        action: 'connector_tools_listed',
        targetType: 'mcp_server',
        targetId: input.serverId,
        metadata: { fetchedToolCount: input.fetchedToolCount, runId: input.runId },
        serverId: input.serverId,
      });
    },

    invocationRequested(input) {
      write({
        organizationId: input.organizationId,
        actorId: input.actorMemberId,
        action: 'connector_invocation_requested',
        targetType: 'mcp_tool',
        targetId: `${input.serverId}:${input.toolName}`,
        metadata: {
          runId: input.runId,
          ...(input.riskClass ? { riskClass: input.riskClass } : {}),
        },
        serverId: input.serverId,
        toolName: input.toolName,
        argsJson: serializeArgs(input.args, redactKeys),
      });
    },

    invocationResolved(input) {
      write({
        organizationId: input.organizationId,
        actorId: input.resolverMemberId,
        action: 'connector_invocation_resolved',
        targetType: 'mcp_tool',
        targetId: `${input.serverId}:${input.toolName}`,
        status: input.resolution === 'reject' ? 'blocked' : 'ok',
        metadata: {
          approvalId: input.approvalId,
          resolution: input.resolution,
          ...(input.runId ? { runId: input.runId } : {}),
          ...(input.scope ? { scope: input.scope } : {}),
        },
        serverId: input.serverId,
        toolName: input.toolName,
      });
    },

    invocationCompleted(input) {
      write({
        organizationId: input.organizationId,
        actorId: input.actorMemberId,
        action: 'connector_invocation_completed',
        targetType: 'mcp_tool',
        targetId: `${input.serverId}:${input.toolName}`,
        status: input.success ? 'ok' : 'error',
        metadata: {
          runId: input.runId,
          success: input.success,
          ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
        },
        serverId: input.serverId,
        toolName: input.toolName,
      });
    },

    tierChanged(input) {
      write({
        organizationId: input.organizationId,
        actorId: input.changedBy,
        action: 'connector_tier_changed',
        targetType: 'agent_mcp_attachment',
        targetId: `${input.memberId}:${input.serverId}`,
        metadata: {
          memberId: input.memberId,
          fromTier: input.fromTier,
          toTier: input.toTier,
          ...(input.reason ? { reason: input.reason } : {}),
        },
        serverId: input.serverId,
      });
    },
  };
}
