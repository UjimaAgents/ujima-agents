import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { AuditEventSchema, type AuditEvent } from '@ujima/shared';
import { optionalRowString, rowString } from './common.js';

type Row = Record<string, unknown>;

export function saveAuditEvent(db: DbHandle, event: AuditEvent): AuditEvent {
  const payload = AuditEventSchema.parse(event);

  // Connector-action unwrap (§12): writes the (server_id, tool_name,
  // args_json) tuple to the indexed columns added in migration 049 so
  // operator queries hit the `idx_audit_server_tool` index. Legacy events
  // leave all three NULL — no behavior change.
  db.prepare(
    `INSERT INTO audit_events
       (id, organization_id, actor_id, action, target_type, target_id,
        status, metadata, created_at,
        server_id, tool_name, args_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.actorId ?? null,
    payload.action,
    payload.targetType,
    payload.targetId ?? null,
    payload.status,
    JSON.stringify(payload.metadata),
    payload.createdAt,
    payload.serverId ?? null,
    payload.toolName ?? null,
    payload.argsJson ?? null,
  );

  return payload;
}

export function listAuditEvents(db: DbHandle, organizationId: string): AuditEvent[] {
  const rows = db
    .prepare(
      'SELECT * FROM audit_events WHERE organization_id = ? ORDER BY created_at DESC',
    )
    .all(organizationId) as Row[];

  return rows.map((row) =>
    AuditEventSchema.parse({
      id: rowString(row, 'id'),
      organizationId: rowString(row, 'organization_id'),
      actorId: optionalRowString(row, 'actor_id'),
      action: rowString(row, 'action'),
      targetType: rowString(row, 'target_type'),
      targetId: optionalRowString(row, 'target_id'),
      status: rowString(row, 'status'),
      metadata:
        typeof row.metadata === 'string' && row.metadata.length > 0
          ? (JSON.parse(row.metadata) as Record<string, unknown>)
          : {},
      createdAt: rowString(row, 'created_at'),
      serverId: optionalRowString(row, 'server_id'),
      toolName: optionalRowString(row, 'tool_name'),
      argsJson: optionalRowString(row, 'args_json'),
    }),
  );
}
