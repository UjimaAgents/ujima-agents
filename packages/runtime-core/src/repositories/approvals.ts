import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { ApprovalRequestSchema, parseShellScope, type ApprovalRequest } from '@ujima/shared';
import { now, optionalRowString, rowString } from './common.js';

type Row = Record<string, unknown>;

function rowToApproval(row: Row): ApprovalRequest {
  return ApprovalRequestSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    runId: optionalRowString(row, 'run_id'),
    toolCallId: optionalRowString(row, 'tool_call_id'),
    threadId: optionalRowString(row, 'thread_id'),
    requestedBy: rowString(row, 'requested_by'),
    resourceType: rowString(row, 'resource_type'),
    resourcePath: rowString(row, 'resource_path'),
    action: rowString(row, 'action'),
    status: rowString(row, 'status'),
    reason: rowString(row, 'reason'),
    createdAt: rowString(row, 'created_at'),
    resolvedAt: optionalRowString(row, 'resolved_at'),
  });
}

export function saveApproval(db: DbHandle, approval: ApprovalRequest): ApprovalRequest {
  const payload = ApprovalRequestSchema.parse(approval);

  db.prepare(
    `INSERT INTO approvals (id, organization_id, run_id, tool_call_id, thread_id, requested_by, resource_type, resource_path, action, status, reason, created_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       tool_call_id = excluded.tool_call_id,
       thread_id = COALESCE(excluded.thread_id, approvals.thread_id),
       status = excluded.status,
       reason = excluded.reason,
       resolved_at = excluded.resolved_at`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.runId ?? null,
    payload.toolCallId ?? null,
    payload.threadId ?? null,
    payload.requestedBy,
    payload.resourceType,
    payload.resourcePath,
    payload.action,
    payload.status,
    payload.reason,
    payload.createdAt,
    payload.resolvedAt ?? null,
  );

  return payload;
}

export function getApproval(
  db: DbHandle,
  organizationId: string,
  approvalId: string,
): ApprovalRequest | null {
  const row = db
    .prepare('SELECT * FROM approvals WHERE organization_id = ? AND id = ?')
    .get(organizationId, approvalId) as Row | null;

  return row ? rowToApproval(row) : null;
}

export function resolveApproval(
  db: DbHandle,
  organizationId: string,
  approvalId: string,
  status: 'approved' | 'rejected',
  reason = '',
): ApprovalRequest | null {
  const approval = getApproval(db, organizationId, approvalId);
  if (!approval) {
    return null;
  }

  const resolved = ApprovalRequestSchema.parse({
    ...approval,
    status,
    reason,
    resolvedAt: now(),
  });

  db.prepare(
    `UPDATE approvals
     SET status = ?, reason = ?, resolved_at = ?
     WHERE organization_id = ? AND id = ?`,
  ).run(
    resolved.status,
    resolved.reason,
    resolved.resolvedAt ?? null,
    organizationId,
    approvalId,
  );

  return resolved;
}

export function deleteApproval(
  db: DbHandle,
  organizationId: string,
  approvalId: string,
): void {
  db.prepare('DELETE FROM approvals WHERE organization_id = ? AND id = ?').run(
    organizationId,
    approvalId,
  );
}

export function listPendingApprovals(
  db: DbHandle,
  organizationId: string,
): ApprovalRequest[] {
  const rows = db
    .prepare(
      "SELECT * FROM approvals WHERE organization_id = ? AND status = 'pending' ORDER BY created_at ASC",
    )
    .all(organizationId) as Row[];

  return rows.map(rowToApproval);
}

export function hasApprovalGrant(
  db: DbHandle,
  input: {
    organizationId: string;
    requestedBy: string;
    resourceType: ApprovalRequest['resourceType'];
    resourcePath: string;
    action: ApprovalRequest['action'];
    approvalScope: string;
  },
): boolean {
  const escapedScope = encodeURIComponent(input.approvalScope)
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');

  const row = db
    .prepare(
      `SELECT id
       FROM approvals
       WHERE organization_id = ?
         AND requested_by = ?
         AND resource_type = ?
         AND resource_path = ?
         AND action = ?
         AND status = 'approved'
         AND reason LIKE ? ESCAPE '\\'
       ORDER BY resolved_at DESC
       LIMIT 1`,
    )
    .get(
      input.organizationId,
      input.requestedBy,
      input.resourceType,
      input.resourcePath,
      input.action,
      `grant:always_allow:scope=${escapedScope};%`,
  ) as Row | null;
  if (row) return true;
  if (!input.approvalScope.startsWith('shell:')) return false;

  const shellRows = db
    .prepare(
      `SELECT reason
       FROM approvals
       WHERE organization_id = ?
         AND requested_by = ?
         AND resource_type = ?
         AND resource_path = ?
         AND action = ?
         AND status = 'approved'
         AND reason LIKE 'grant:always_allow:scope=shell%'
       ORDER BY resolved_at DESC`,
    )
    .all(
      input.organizationId,
      input.requestedBy,
      input.resourceType,
      input.resourcePath,
      input.action,
    ) as Row[];

  return shellRows.some((candidate) =>
    shellScopesEquivalent(extractEncodedScope(rowString(candidate, 'reason')), input.approvalScope),
  );
}

function extractEncodedScope(reason: string): string | undefined {
  const match = reason.match(/(?:^|[;:])scope=([^;]+)/);
  if (!match || !match[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function shellScopesEquivalent(storedScope: string | undefined, requestedScope: string): boolean {
  if (!storedScope) return false;
  if (storedScope === requestedScope) return true;

  const stored = parseShellScope(storedScope);
  const requested = parseShellScope(requestedScope);
  if (!stored || !requested) return false;
  if (stored.cwd !== requested.cwd || stored.command !== requested.command) return false;
  if (!stored.args || !requested.args) return true;
  return arraysEqual(stored.args, requested.args);
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}
