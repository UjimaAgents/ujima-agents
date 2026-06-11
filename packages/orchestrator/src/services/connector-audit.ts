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
  /** PR 11 — discovery. Emit one row per search_catalog call. */
  catalogSearch(input: CatalogSearchInput): void;
  /** PR 11 — discovery. Emit when request_attachment surfaces an approval card. */
  attachmentRequestCreated(input: AttachmentRequestCreatedInput): void;
  /** PR 11 — discovery. Emit when an operator resolves an attachment_request. */
  attachmentRequestResolved(input: AttachmentRequestResolvedInput): void;
  /** Agent-attachments — fires per capture write. */
  agentAttachmentCreated(input: AgentAttachmentCreatedInput): void;
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

// PR 11 — discovery telemetry. Three events tracking the
// search → request → resolve lifecycle for the discovery escalation
// path (§17.5.5). All carry runId so operators can correlate the
// chain across the agent's trajectory.

export interface CatalogSearchInput {
  organizationId: string;
  actorMemberId: string;
  runId: string;
  /** The raw query string the agent passed. Trimmed but not censored. */
  query: string;
  /** Result count actually returned to the model (after top-K truncation). */
  matchCount: number;
}

export interface AttachmentRequestCreatedInput {
  organizationId: string;
  actorMemberId: string;
  runId: string;
  /** Server the agent is asking to attach. */
  serverId: string;
  /** Where the agent wants the attachment to land. */
  target: 'agent' | 'channel';
  targetId: string;
  /** The agent's own reasoning text — surfaced to the operator. */
  reason: string;
  /** Approval row id; ties to the matching `_resolved` event. */
  approvalId: string;
}

export interface AttachmentRequestResolvedInput {
  organizationId: string;
  /** Member id of the human resolver, when known. */
  resolverMemberId?: string;
  approvalId: string;
  runId?: string;
  serverId: string;
  target: 'agent' | 'channel';
  targetId: string;
  /**
   * Outcome of the two-grant decision (§17.5.6):
   *   `attached_allow_action` — grant 1 + grant 2 both yes
   *   `attached_action_rejected` — grant 1 yes, grant 2 no (rare)
   *   `rejected` — grant 1 no (attachment denied)
   *   `attach_failed` — operator approved but the attachment write
   *     threw post-resolution (registry instantiation failed, name
   *     clash, duplicate row, transient repo error). Operators see
   *     this in the audit log + can retry via settings UI. The
   *     approval row stays resolved; the attachment just didn't
   *     land. Without this distinct outcome the failure was silent.
   */
  resolution:
    | 'attached_allow_action'
    | 'attached_action_rejected'
    | 'rejected'
    | 'attach_failed';
}

export interface AgentAttachmentCreatedInput {
  organizationId: string;
  /** The agent that produced the attachment. */
  actorMemberId: string;
  runId: string;
  /** agent_attachments row id. */
  attachmentId: string;
  category: string;
  mimeType: string;
  byteSize: number;
  /** Origin: 'tool_capture' | 'agent_post' (workspace path / base64). */
  source: 'tool_capture' | 'agent_post';
  /** When source='tool_capture'. */
  toolCallId?: string;
  serverId?: string;
  toolName?: string;
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

  // §12 telemetry is BEST-EFFORT by design. The connector hot paths
  // (invoke_connector_tool, get_connector_tools, native V2 wrapper,
  // tier-toggle PATCH, approval-resolution emit, replay-completion
  // emit) all call these emitters inline. If `saveAuditEvent` throws
  // — DB lock, schema drift, disk-full, transient bun:sqlite hiccup
  // — that exception must NOT escape and abort the connector call or
  // turn an already-committed mutation into a 500.
  //
  // Centralising the swallow here is the only way to keep every call
  // site safe without a parallel try/catch at each emit. Per-emit
  // wrappers are easy to miss when new emit sites are added; future
  // PRs would re-introduce the same regression. The trade-off is one
  // dropped audit row on the failure path, which the operator notices
  // via the warn log + the existing structured logging spine.
  function write(partial: Omit<AuditEvent, 'id' | 'createdAt' | 'status'> & Partial<Pick<AuditEvent, 'status'>>): void {
    try {
      deps.repo.saveAuditEvent(
        AuditEventSchema.parse({
          id: newId(),
          createdAt: newNow(),
          status: partial.status ?? 'ok',
          ...partial,
        }),
      );
    } catch (err) {
      console.warn(
        '[connector-audit] saveAuditEvent failed; dropping one event to keep tool path alive',
        {
          action: partial.action,
          serverId: partial.serverId,
          toolName: partial.toolName,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
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

    catalogSearch(input) {
      write({
        organizationId: input.organizationId,
        actorId: input.actorMemberId,
        action: 'catalog_search',
        targetType: 'discovery',
        targetId: 'search_catalog',
        metadata: {
          runId: input.runId,
          // Store the query verbatim — discovery search is operator-
          // visible context, not a tool-arg that needs the secret
          // redaction policy. Trimmed length keeps the audit row
          // bounded (the search tool itself caps query length).
          query: input.query,
          matchCount: input.matchCount,
        },
      });
    },

    attachmentRequestCreated(input) {
      write({
        organizationId: input.organizationId,
        actorId: input.actorMemberId,
        action: 'attachment_request_created',
        targetType: 'mcp_server',
        targetId: input.serverId,
        metadata: {
          runId: input.runId,
          approvalId: input.approvalId,
          target: input.target,
          targetId: input.targetId,
          // The agent's reason is part of the consent chain (§17.5.6)
          // and gets surfaced verbatim to the operator on the
          // approval card. Persisting it in the audit row gives
          // operators a queryable trail of "why did Snoop ask for
          // Censys?" without re-rendering the card.
          reason: input.reason,
        },
        serverId: input.serverId,
      });
    },

    attachmentRequestResolved(input) {
      write({
        organizationId: input.organizationId,
        actorId: input.resolverMemberId,
        action: 'attachment_request_resolved',
        targetType: 'mcp_server',
        targetId: input.serverId,
        metadata: {
          approvalId: input.approvalId,
          ...(input.runId ? { runId: input.runId } : {}),
          target: input.target,
          targetId: input.targetId,
          resolution: input.resolution,
        },
        serverId: input.serverId,
      });
    },

    agentAttachmentCreated(input) {
      write({
        organizationId: input.organizationId,
        actorId: input.actorMemberId,
        action: 'agent_attachment_created',
        targetType: 'agent_attachment',
        targetId: input.attachmentId,
        metadata: {
          runId: input.runId,
          category: input.category,
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          source: input.source,
          ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
          ...(input.serverId ? { serverId: input.serverId } : {}),
          ...(input.toolName ? { toolName: input.toolName } : {}),
        },
        ...(input.serverId ? { serverId: input.serverId } : {}),
        ...(input.toolName ? { toolName: input.toolName } : {}),
      });
    },
  };
}
