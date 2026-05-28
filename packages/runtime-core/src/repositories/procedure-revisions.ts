import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import {
  ProcedureRevisionSchema,
  RunProcedureAppliedSchema,
  type ProcedureRevision,
  type RunProcedureApplied,
} from '@ujima/shared';
import { rowString } from './common.js';

type Row = Record<string, unknown>;

function rowToRevision(row: Row): ProcedureRevision {
  const enforcedRaw = row['enforced'];
  const enforced =
    typeof enforcedRaw === 'number' ? enforcedRaw === 1 : Boolean(enforcedRaw);
  return ProcedureRevisionSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    scope: rowString(row, 'scope'),
    scopeId: rowString(row, 'scope_id'),
    name: rowString(row, 'name'),
    version: Number(row['version'] ?? 1),
    bodySnapshot: rowString(row, 'body_snapshot'),
    description: rowString(row, 'description'),
    enforced,
    updatedBy: rowString(row, 'updated_by'),
    updatedAt: rowString(row, 'updated_at'),
  });
}

function rowToApplied(row: Row): RunProcedureApplied {
  const enforcedRaw = row['enforced'];
  const enforced =
    typeof enforcedRaw === 'number' ? enforcedRaw === 1 : Boolean(enforcedRaw);
  return RunProcedureAppliedSchema.parse({
    organizationId: rowString(row, 'organization_id'),
    runId: rowString(row, 'run_id'),
    scope: rowString(row, 'scope'),
    scopeId: rowString(row, 'scope_id'),
    name: rowString(row, 'name'),
    version: Number(row['version'] ?? 1),
    enforced,
    createdAt: rowString(row, 'created_at'),
  });
}

export function appendProcedureRevision(
  db: DbHandle,
  rev: ProcedureRevision,
): ProcedureRevision {
  const payload = ProcedureRevisionSchema.parse(rev);
  db.prepare(
    `INSERT INTO procedure_revisions (
       id, organization_id, scope, scope_id, name, version,
       body_snapshot, description, enforced, updated_by, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.scope,
    payload.scopeId,
    payload.name,
    payload.version,
    payload.bodySnapshot,
    payload.description,
    payload.enforced ? 1 : 0,
    payload.updatedBy,
    payload.updatedAt,
  );
  return payload;
}

export function listProcedureRevisions(
  db: DbHandle,
  input: {
    organizationId: string;
    scope: string;
    scopeId: string;
    name: string;
    limit?: number;
  },
): ProcedureRevision[] {
  const limit = input.limit ?? 25;
  const rows = db
    .prepare(
      `SELECT * FROM procedure_revisions
        WHERE organization_id = ?
          AND scope = ?
          AND scope_id = ?
          AND name = ?
        ORDER BY version DESC
        LIMIT ?`,
    )
    .all(
      input.organizationId,
      input.scope,
      input.scopeId,
      input.name,
      limit,
    ) as Row[];
  return rows.map(rowToRevision);
}

export function recordRunProceduresApplied(
  db: DbHandle,
  input: {
    organizationId: string;
    runId: string;
    applied: { scope: string; scopeId: string; name: string; version: number; enforced: boolean }[];
  },
): void {
  if (input.applied.length === 0) return;
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO run_procedures_applied (
       organization_id, run_id, scope, scope_id, name, version,
       enforced, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(organization_id, run_id, scope, scope_id, name)
       DO UPDATE SET version = excluded.version, enforced = excluded.enforced`,
  );
  for (const a of input.applied) {
    stmt.run(
      input.organizationId,
      input.runId,
      a.scope,
      a.scopeId,
      a.name,
      a.version,
      a.enforced ? 1 : 0,
      now,
    );
  }
}

export function listRunProceduresApplied(
  db: DbHandle,
  organizationId: string,
  runId: string,
): RunProcedureApplied[] {
  const rows = db
    .prepare(
      `SELECT * FROM run_procedures_applied
        WHERE organization_id = ?
          AND run_id = ?
        ORDER BY scope, name`,
    )
    .all(organizationId, runId) as Row[];
  return rows.map(rowToApplied);
}
