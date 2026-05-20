import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { RunStateSchema, type RunState } from '@ujima/shared';
import { optionalRowString, rowString } from './common.js';
import { cursorWhereClause, decodeCursor, encodeCursor } from '@ujima/shared';

type Row = Record<string, unknown>;

export interface PaginatedRuns {
  data: RunState[];
  nextCursor?: string;
  hasMore: boolean;
}

function rowToRun(row: Row): RunState {
  return RunStateSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    agentId: rowString(row, 'agent_id'),
    threadId: optionalRowString(row, 'thread_id'),
    status: rowString(row, 'status'),
    step: rowString(row, 'step'),
    summary: rowString(row, 'summary'),
    startedAt: rowString(row, 'started_at'),
    endedAt: optionalRowString(row, 'ended_at'),
    wakeReason: optionalRowString(row, 'wake_reason') ?? null,
    terminatingTool: optionalRowString(row, 'terminating_tool') ?? null,
    sourceMessageId: optionalRowString(row, 'source_message_id') ?? null,
    byMemberId: optionalRowString(row, 'by_member_id') ?? null,
  });
}

export function saveRun(db: DbHandle, run: RunState): RunState {
  const payload = RunStateSchema.parse(run);

  db.prepare(
    `INSERT INTO runs (
       id,
       organization_id,
       agent_id,
       thread_id,
       status,
       step,
       summary,
       started_at,
       ended_at,
       terminating_tool,
       wake_reason,
       source_message_id,
       by_member_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       step = excluded.step,
       summary = excluded.summary,
       ended_at = excluded.ended_at,
       terminating_tool = excluded.terminating_tool,
       wake_reason = excluded.wake_reason,
       source_message_id = excluded.source_message_id,
       by_member_id = excluded.by_member_id`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.agentId,
    payload.threadId ?? null,
    payload.status,
    payload.step,
    payload.summary,
    payload.startedAt,
    payload.endedAt ?? null,
    payload.terminatingTool ?? null,
    payload.wakeReason ?? null,
    payload.sourceMessageId ?? null,
    payload.byMemberId ?? null,
  );

  return payload;
}

export function getRun(
  db: DbHandle,
  organizationId: string,
  runId: string,
): RunState | null {
  const row = db
    .prepare('SELECT * FROM runs WHERE organization_id = ? AND id = ?')
    .get(organizationId, runId) as Row | null;

  return row ? rowToRun(row) : null;
}

const ACTIVE_RUN_STATUSES = ['queued', 'running', 'waiting_for_approval'] as const;

/**
 * Returns a non-terminal run for the same agent + conversation thread, if any.
 * Used to suppress duplicate conversational wakes while a run is still active.
 */
export function findActiveRunForMemberThread(
  db: DbHandle,
  organizationId: string,
  agentId: string,
  threadId: string,
): RunState | null {
  const placeholders = ACTIVE_RUN_STATUSES.map(() => '?').join(', ');
  const row = db
    .prepare(
      `SELECT * FROM runs
       WHERE organization_id = ?
         AND agent_id = ?
         AND thread_id = ?
         AND status IN (${placeholders})
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .get(organizationId, agentId, threadId, ...ACTIVE_RUN_STATUSES) as Row | null;

  return row ? rowToRun(row) : null;
}

export function listActiveRuns(db: DbHandle, organizationId: string): RunState[] {
  const placeholders = ACTIVE_RUN_STATUSES.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT * FROM runs
       WHERE organization_id = ?
         AND status IN (${placeholders})
       ORDER BY started_at DESC, id DESC`,
    )
    .all(organizationId, ...ACTIVE_RUN_STATUSES) as Row[];

  return rows.map(rowToRun);
}

export function listRuns(
  db: DbHandle,
  organizationId: string,
  cursor?: string,
  limit = 50,
): PaginatedRuns {
  const params: (string | number)[] = [organizationId];
  let query = 'SELECT * FROM runs WHERE organization_id = ?';

  const decoded = decodeCursor(cursor);
  if (decoded) {
    const { sql, params: cursorParams } = cursorWhereClause(decoded, 'started_at', 'id');
    query += ` AND ${sql}`;
    params.push(...cursorParams);
  }

  query += ' ORDER BY started_at DESC, id DESC LIMIT ?';
  params.push(limit + 1);

  const rows = db.prepare(query).all(...params) as Row[];

  const hasMore = rows.length > limit;
  if (hasMore) {
    rows.pop();
  }

  const data = rows.map(rowToRun);
  const tail = hasMore ? data[data.length - 1] : undefined;
  const nextCursor = tail ? encodeCursor(tail.startedAt, tail.id) : undefined;

  return { data, hasMore, nextCursor };
}

export function listThreadRuns(
  db: DbHandle,
  organizationId: string,
  threadId: string,
  cursor?: string,
  limit = 50,
): PaginatedRuns {
  const params: (string | number)[] = [organizationId, threadId];
  let query = 'SELECT * FROM runs WHERE organization_id = ? AND thread_id = ?';

  const decoded = decodeCursor(cursor);
  if (decoded) {
    const { sql, params: cursorParams } = cursorWhereClause(decoded, 'started_at', 'id');
    query += ` AND ${sql}`;
    params.push(...cursorParams);
  }

  query += ' ORDER BY started_at DESC, id DESC LIMIT ?';
  params.push(limit + 1);

  const rows = db.prepare(query).all(...params) as Row[];
  const hasMore = rows.length > limit;
  if (hasMore) {
    rows.pop();
  }

  const data = rows.map(rowToRun);
  const tail = hasMore ? data[data.length - 1] : undefined;
  const nextCursor = tail ? encodeCursor(tail.startedAt, tail.id) : undefined;

  return { data, hasMore, nextCursor };
}
