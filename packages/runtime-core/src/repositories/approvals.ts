import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import {
  ApprovalRequestSchema,
  canonicalizeApprovalFamilyScope,
  canonicalizeApprovalGrantScope,
  parseApprovalReasonValue,
  type ApprovalRequest,
} from '@ujima/shared';
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
      `SELECT
         a.id,
         a.organization_id,
         a.run_id,
         a.tool_call_id,
         COALESCE(a.thread_id, r.thread_id) AS thread_id,
         a.requested_by,
         a.resource_type,
         a.resource_path,
         a.action,
         a.status,
         a.reason,
         a.created_at,
         a.resolved_at
       FROM approvals a
       LEFT JOIN runs r ON r.organization_id = a.organization_id AND r.id = a.run_id
       WHERE a.organization_id = ? AND a.status = 'pending'
       ORDER BY a.created_at ASC`,
    )
    .all(organizationId) as Row[];

  return rows.map(rowToApproval);
}

export function hasApprovalGrant(
  db: DbHandle,
  input: {
    organizationId: string;
    resourceType: ApprovalRequest['resourceType'];
    action: ApprovalRequest['action'];
    approvalScope: string;
  },
): boolean {
  const currentGrantScope = canonicalizeApprovalGrantScope(input.approvalScope);
  const currentFamilyScope = canonicalizeApprovalFamilyScope(input.approvalScope);

  const rows = db
    .prepare(
      `SELECT reason
       FROM approvals
       WHERE organization_id = ?
         AND resource_type = ?
         AND action = ?
         AND status = 'approved'
         AND reason LIKE 'grant:always_allow:scope=%'
       ORDER BY resolved_at DESC`,
    )
    .all(
      input.organizationId,
      input.resourceType,
      input.action,
    ) as Row[];

  return rows.some((candidate) => {
    const storedScope = parseApprovalReasonValue(rowString(candidate, 'reason'), 'scope');
    if (!storedScope) return false;
    const canonicalStored = canonicalizeApprovalGrantScope(storedScope);
    return canonicalStored === currentGrantScope || canonicalStored === currentFamilyScope;
  });
}
