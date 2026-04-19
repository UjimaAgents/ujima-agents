import type { Database } from "bun:sqlite";
import { ApprovalRequestSchema, type ApprovalRequest } from "@ujima/shared";
import { now, optionalRowString, rowString } from "./common.ts";

type Row = Record<string, unknown>;

export function saveApproval(db: Database, approval: ApprovalRequest): ApprovalRequest {
  const payload = ApprovalRequestSchema.parse(approval);

  db.run(
    `
    INSERT INTO approvals (id, organization_id, run_id, requested_by, resource_type, resource_path, action, status, reason, created_at, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      reason = excluded.reason,
      resolved_at = excluded.resolved_at
    `,
    [
      payload.id,
      payload.organizationId,
      payload.runId ?? null,
      payload.requestedBy,
      payload.resourceType,
      payload.resourcePath,
      payload.action,
      payload.status,
      payload.reason,
      payload.createdAt,
      payload.resolvedAt ?? null,
    ],
  );

  return payload;
}

export function getApproval(db: Database, organizationId: string, approvalId: string): ApprovalRequest | null {
  const row = db.query("SELECT * FROM approvals WHERE organization_id = ? AND id = ?").get(
    organizationId,
    approvalId,
  ) as Row | null;

  if (!row) {
    return null;
  }

  return ApprovalRequestSchema.parse({
    id: rowString(row, "id"),
    organizationId: rowString(row, "organization_id"),
    runId: optionalRowString(row, "run_id"),
    requestedBy: rowString(row, "requested_by"),
    resourceType: rowString(row, "resource_type"),
    resourcePath: rowString(row, "resource_path"),
    action: rowString(row, "action"),
    status: rowString(row, "status"),
    reason: rowString(row, "reason"),
    createdAt: rowString(row, "created_at"),
    resolvedAt: optionalRowString(row, "resolved_at"),
  });
}

export function resolveApproval(
  db: Database,
  organizationId: string,
  approvalId: string,
  status: "approved" | "rejected",
  reason = "",
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

  db.run(
    `
    UPDATE approvals
    SET status = ?, reason = ?, resolved_at = ?
    WHERE organization_id = ? AND id = ?
    `,
    [resolved.status, resolved.reason, resolved.resolvedAt ?? null, organizationId, approvalId],
  );

  return resolved;
}

export function listPendingApprovals(db: Database, organizationId: string): ApprovalRequest[] {
  const rows = db.query("SELECT * FROM approvals WHERE organization_id = ? AND status = 'pending' ORDER BY created_at ASC").all(
    organizationId,
  ) as Row[];

  return rows.map((row) =>
    ApprovalRequestSchema.parse({
      id: rowString(row, "id"),
      organizationId: rowString(row, "organization_id"),
      runId: optionalRowString(row, "run_id"),
      requestedBy: rowString(row, "requested_by"),
      resourceType: rowString(row, "resource_type"),
      resourcePath: rowString(row, "resource_path"),
      action: rowString(row, "action"),
      status: rowString(row, "status"),
      reason: rowString(row, "reason"),
      createdAt: rowString(row, "created_at"),
      resolvedAt: optionalRowString(row, "resolved_at"),
    }),
  );
}

