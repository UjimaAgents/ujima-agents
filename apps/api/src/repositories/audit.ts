import type { Database } from "bun:sqlite";
import { AuditEventSchema, type AuditEvent } from "@ujima/shared";
import { now, optionalRowString, rowString } from "./common.ts";

type Row = Record<string, unknown>;

export function saveAuditEvent(db: Database, event: AuditEvent): AuditEvent {
  const payload = AuditEventSchema.parse(event);

  db.run(
    `
    INSERT INTO audit_events (id, organization_id, actor_id, action, target_type, target_id, status, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      payload.id,
      payload.organizationId,
      payload.actorId ?? null,
      payload.action,
      payload.targetType,
      payload.targetId ?? null,
      payload.status,
      JSON.stringify(payload.metadata),
      payload.createdAt,
    ],
  );

  return payload;
}

export function listAuditEvents(db: Database, organizationId: string): AuditEvent[] {
  const rows = db.query("SELECT * FROM audit_events WHERE organization_id = ? ORDER BY created_at DESC").all(
    organizationId,
  ) as Row[];

  return rows.map((row) =>
    AuditEventSchema.parse({
      id: rowString(row, "id"),
      organizationId: rowString(row, "organization_id"),
      actorId: optionalRowString(row, "actor_id"),
      action: rowString(row, "action"),
      targetType: rowString(row, "target_type"),
      targetId: optionalRowString(row, "target_id"),
      status: rowString(row, "status"),
      metadata: typeof row.metadata === "string" && row.metadata.length > 0 ? JSON.parse(row.metadata) : {},
      createdAt: rowString(row, "created_at"),
    }),
  );
}

