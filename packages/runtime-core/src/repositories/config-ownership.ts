import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import {
  ConfigFieldOwnershipSchema,
  type ConfigFieldOwnership,
} from '@ujima/shared';
import { now, rowString } from './common.js';

type Row = Record<string, unknown>;

function rowToConfigFieldOwnership(row: Row): ConfigFieldOwnership {
  return ConfigFieldOwnershipSchema.parse({
    organizationId: rowString(row, 'organization_id'),
    entityType: rowString(row, 'entity_type'),
    entityId: rowString(row, 'entity_id'),
    fieldName: rowString(row, 'field_name'),
    owner: rowString(row, 'owner'),
    allowDashboardOverride: Number(row.allow_dashboard_override) === 1,
    updatedAt: rowString(row, 'updated_at'),
  });
}

export function saveConfigFieldOwnership(
  db: DbHandle,
  ownership: ConfigFieldOwnership,
): ConfigFieldOwnership {
  const payload = ConfigFieldOwnershipSchema.parse(ownership);
  const timestamp = payload.updatedAt ?? now();

  db.prepare(
    `INSERT INTO config_field_ownership (
       organization_id,
       entity_type,
       entity_id,
       field_name,
       owner,
       allow_dashboard_override,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(organization_id, entity_type, entity_id, field_name) DO UPDATE SET
       owner = excluded.owner,
       allow_dashboard_override = excluded.allow_dashboard_override,
       updated_at = excluded.updated_at`,
  ).run(
    payload.organizationId,
    payload.entityType,
    payload.entityId,
    payload.fieldName,
    payload.owner,
    payload.allowDashboardOverride ? 1 : 0,
    timestamp,
  );

  return {
    ...payload,
    updatedAt: timestamp,
  };
}

export function getConfigFieldOwnership(
  db: DbHandle,
  organizationId: string,
  entityType: ConfigFieldOwnership['entityType'],
  entityId: string,
  fieldName: string,
): ConfigFieldOwnership | null {
  const row = db
    .prepare(
      `SELECT * FROM config_field_ownership
       WHERE organization_id = ?
         AND entity_type = ?
         AND entity_id = ?
         AND field_name = ?`,
    )
    .get(organizationId, entityType, entityId, fieldName) as Row | null;

  return row ? rowToConfigFieldOwnership(row) : null;
}

export function listConfigFieldOwnership(
  db: DbHandle,
  organizationId: string,
  entityType?: ConfigFieldOwnership['entityType'],
): ConfigFieldOwnership[] {
  const rows = (
    entityType
      ? db
          .prepare(
            `SELECT * FROM config_field_ownership
             WHERE organization_id = ? AND entity_type = ?
             ORDER BY entity_type, entity_id, field_name`,
          )
          .all(organizationId, entityType)
      : db
          .prepare(
            `SELECT * FROM config_field_ownership
             WHERE organization_id = ?
             ORDER BY entity_type, entity_id, field_name`,
          )
          .all(organizationId)
  ) as Row[];

  return rows.map(rowToConfigFieldOwnership);
}
