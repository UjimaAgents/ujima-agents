import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import {
  SpiritSchema,
  type Spirit,
  type SpiritRole,
} from '@ujima/shared';
import { optionalRowString, rowString } from './common.js';

type Row = Record<string, unknown>;

function rowToSpirit(row: Row): Spirit {
  return SpiritSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    taskSessionId: rowString(row, 'task_session_id'),
    memberId: rowString(row, 'member_id'),
    role: rowString(row, 'role'),
    runId: optionalRowString(row, 'run_id'),
    status: rowString(row, 'status'),
    iteration: typeof row.iteration === 'number' ? row.iteration : 0,
    tokensUsed: typeof row.tokens_used === 'number' ? row.tokens_used : 0,
    lastMessageId: optionalRowString(row, 'last_message_id'),
    lastError: optionalRowString(row, 'last_error'),
    createdAt: rowString(row, 'created_at'),
    updatedAt: rowString(row, 'updated_at'),
    endedAt: optionalRowString(row, 'ended_at'),
  });
}

export function saveSpirit(db: DbHandle, spirit: Spirit): Spirit {
  const payload = SpiritSchema.parse(spirit);
  db.prepare(
    `INSERT INTO spirits (
       id, organization_id, task_session_id, member_id, role,
       run_id, status, iteration, tokens_used, last_message_id, last_error,
       created_at, updated_at, ended_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       run_id = excluded.run_id,
       status = excluded.status,
       iteration = excluded.iteration,
       tokens_used = excluded.tokens_used,
       last_message_id = excluded.last_message_id,
       last_error = excluded.last_error,
       updated_at = excluded.updated_at,
       ended_at = excluded.ended_at`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.taskSessionId,
    payload.memberId,
    payload.role,
    payload.runId ?? null,
    payload.status,
    payload.iteration,
    payload.tokensUsed,
    payload.lastMessageId ?? null,
    payload.lastError ?? null,
    payload.createdAt,
    payload.updatedAt,
    payload.endedAt ?? null,
  );
  return payload;
}

export function getSpirit(db: DbHandle, organizationId: string, spiritId: string): Spirit | null {
  const row = db
    .prepare('SELECT * FROM spirits WHERE organization_id = ? AND id = ?')
    .get(organizationId, spiritId) as Row | null;
  return row ? rowToSpirit(row) : null;
}

export function getSpiritByTriple(
  db: DbHandle,
  organizationId: string,
  taskSessionId: string,
  memberId: string,
  role: SpiritRole,
): Spirit | null {
  const row = db
    .prepare(
      'SELECT * FROM spirits WHERE organization_id = ? AND task_session_id = ? AND member_id = ? AND role = ?',
    )
    .get(organizationId, taskSessionId, memberId, role) as Row | null;
  return row ? rowToSpirit(row) : null;
}

export function getSpiritByRunId(
  db: DbHandle,
  organizationId: string,
  runId: string,
): Spirit | null {
  const row = db
    .prepare('SELECT * FROM spirits WHERE organization_id = ? AND run_id = ?')
    .get(organizationId, runId) as Row | null;
  return row ? rowToSpirit(row) : null;
}

export function listSpiritsForSession(
  db: DbHandle,
  organizationId: string,
  taskSessionId: string,
): Spirit[] {
  const rows = db
    .prepare(
      'SELECT * FROM spirits WHERE organization_id = ? AND task_session_id = ? ORDER BY role, created_at',
    )
    .all(organizationId, taskSessionId) as Row[];
  return rows.map(rowToSpirit);
}

export function listActiveSpiritsForMember(
  db: DbHandle,
  organizationId: string,
  memberId: string,
): Spirit[] {
  // "Active" = anything still alive on the worker side. queued/running/
  // waiting_for_approval all count — the supervisor cares about whether
  // there is a live worker context to answer questions about. This DB
  // query is also the recovery path the in-memory ActiveSpiritRegistry
  // uses on cold start to repopulate itself.
  //
  // NB: the role filter is deliberate. Callers that need a role-
  // agnostic lookup by runId (e.g. AiService picking SpiritRole for
  // the wake-run MCP resolver) MUST use `getSpiritByRunId` instead —
  // that one returns any spirit owning the run, worker or supervisor.
  const rows = db
    .prepare(
      `SELECT * FROM spirits
       WHERE organization_id = ? AND member_id = ?
         AND status IN ('queued','running','waiting_for_approval','waiting_for_input')
         AND role = 'worker'
       ORDER BY updated_at DESC`,
    )
    .all(organizationId, memberId) as Row[];
  return rows.map(rowToSpirit);
}
