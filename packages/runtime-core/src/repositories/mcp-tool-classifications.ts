import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import {
  McpToolClassificationSchema,
  type McpToolClassification,
  type ToolRiskClass,
} from '@ujima/shared';
import { optionalRowString, rowString } from './common.js';

type Row = Record<string, unknown>;

function rowToClassification(row: Row): McpToolClassification {
  const risk = rowString(row, 'risk') as ToolRiskClass;
  const source = rowString(row, 'source') as McpToolClassification['source'];
  return McpToolClassificationSchema.parse({
    organizationId: rowString(row, 'organization_id'),
    mcpServerId: rowString(row, 'mcp_server_id'),
    toolName: rowString(row, 'tool_name'),
    risk,
    source,
    needsReview: Number(row.needs_review ?? 0) !== 0,
    reason: optionalRowString(row, 'reason'),
    updatedAt: rowString(row, 'updated_at'),
    updatedBy: optionalRowString(row, 'updated_by'),
  });
}

export function getMcpToolClassification(
  db: DbHandle,
  organizationId: string,
  mcpServerId: string,
  toolName: string,
): McpToolClassification | null {
  const row = db
    .prepare(
      `SELECT * FROM mcp_tool_classifications
         WHERE organization_id = ? AND mcp_server_id = ? AND tool_name = ?`,
    )
    .get(organizationId, mcpServerId, toolName) as Row | null;
  return row ? rowToClassification(row) : null;
}

export function listMcpToolClassifications(
  db: DbHandle,
  organizationId: string,
  mcpServerId?: string,
): McpToolClassification[] {
  const rows = mcpServerId
    ? (db
        .prepare(
          `SELECT * FROM mcp_tool_classifications
             WHERE organization_id = ? AND mcp_server_id = ?
             ORDER BY tool_name ASC`,
        )
        .all(organizationId, mcpServerId) as Row[])
    : (db
        .prepare(
          `SELECT * FROM mcp_tool_classifications
             WHERE organization_id = ?
             ORDER BY mcp_server_id ASC, tool_name ASC`,
        )
        .all(organizationId) as Row[]);
  return rows.map(rowToClassification);
}

export function upsertMcpToolClassification(
  db: DbHandle,
  payload: McpToolClassification,
): McpToolClassification {
  const parsed = McpToolClassificationSchema.parse(payload);
  db.prepare(
    `INSERT INTO mcp_tool_classifications (
       organization_id, mcp_server_id, tool_name, risk, source,
       needs_review, reason, updated_at, updated_by
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(organization_id, mcp_server_id, tool_name) DO UPDATE SET
       risk = excluded.risk,
       source = excluded.source,
       needs_review = excluded.needs_review,
       reason = excluded.reason,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
  ).run(
    parsed.organizationId,
    parsed.mcpServerId,
    parsed.toolName,
    parsed.risk,
    parsed.source,
    parsed.needsReview ? 1 : 0,
    parsed.reason ?? null,
    parsed.updatedAt,
    parsed.updatedBy ?? null,
  );
  return parsed;
}

export interface SeedClassificationEntry {
  toolName: string;
  risk: ToolRiskClass;
  needsReview?: boolean;
  reason?: string;
}

// INSERT OR IGNORE: existing rows (manual or already-inferred) are never
// overwritten — that's how admin overrides survive re-test.
//
// The whole batch runs in a single sqlite transaction so an MCP with N
// tools costs one fsync instead of N. Without this the runtime spawn
// path (which seeds on every agent run) becomes a thundering-herd
// write source under burst load and amplifies the "database is locked"
// failures the caller has try/catch protection for.
export function seedInferredClassifications(
  db: DbHandle,
  organizationId: string,
  mcpServerId: string,
  entries: readonly SeedClassificationEntry[],
  updatedBy = 'system:inference',
): number {
  if (entries.length === 0) return 0;
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO mcp_tool_classifications (
       organization_id, mcp_server_id, tool_name, risk, source,
       needs_review, reason, updated_at, updated_by
     )
     VALUES (?, ?, ?, ?, 'inferred', ?, ?, ?, ?)`,
  );
  let inserted = 0;
  db.exec('BEGIN');
  try {
    for (const e of entries) {
      const result = stmt.run(
        organizationId,
        mcpServerId,
        e.toolName,
        e.risk,
        e.needsReview ? 1 : 0,
        e.reason ?? null,
        now,
        updatedBy,
      );
      if (result.changes > 0) inserted += 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return inserted;
}

export function deleteMcpToolClassification(
  db: DbHandle,
  organizationId: string,
  mcpServerId: string,
  toolName: string,
): void {
  db.prepare(
    `DELETE FROM mcp_tool_classifications
       WHERE organization_id = ? AND mcp_server_id = ? AND tool_name = ?`,
  ).run(organizationId, mcpServerId, toolName);
}
