import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { TodoSchema, type Todo, type TodoStatus } from '@ujima/shared';
import { optionalRowString, rowString } from './common.js';

type Row = Record<string, unknown>;

function rowToTodo(row: Row): Todo {
  const emptyWakeCountRaw = row['empty_wake_count'];
  const emptyWakeCount =
    typeof emptyWakeCountRaw === 'number'
      ? emptyWakeCountRaw
      : typeof emptyWakeCountRaw === 'string'
        ? Number.parseInt(emptyWakeCountRaw, 10) || 0
        : 0;
  return TodoSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    taskSessionId: optionalRowString(row, 'task_session_id'),
    runId: optionalRowString(row, 'run_id'),
    memberId: rowString(row, 'member_id'),
    title: rowString(row, 'title'),
    status: rowString(row, 'status'),
    notes: rowString(row, 'notes'),
    channelId: optionalRowString(row, 'channel_id'),
    sourceMessageId: optionalRowString(row, 'source_message_id'),
    deliverableSummary: optionalRowString(row, 'deliverable_summary'),
    dueAt: optionalRowString(row, 'due_at'),
    lastProgressAt: optionalRowString(row, 'last_progress_at'),
    emptyWakeCount,
    createdAt: rowString(row, 'created_at'),
    updatedAt: rowString(row, 'updated_at'),
  });
}

export function saveTodo(db: DbHandle, todo: Todo): Todo {
  const payload = TodoSchema.parse(todo);
  db.prepare(
    `INSERT INTO todos (
       id, organization_id, task_session_id, run_id, member_id,
       title, status, notes, channel_id, source_message_id,
       deliverable_summary, due_at, last_progress_at,
       empty_wake_count, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       task_session_id = excluded.task_session_id,
       run_id = excluded.run_id,
       title = excluded.title,
       status = excluded.status,
       notes = excluded.notes,
       channel_id = excluded.channel_id,
       source_message_id = excluded.source_message_id,
       deliverable_summary = excluded.deliverable_summary,
       due_at = excluded.due_at,
       last_progress_at = excluded.last_progress_at,
       empty_wake_count = excluded.empty_wake_count,
       updated_at = excluded.updated_at`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.taskSessionId ?? null,
    payload.runId ?? null,
    payload.memberId,
    payload.title,
    payload.status,
    payload.notes,
    payload.channelId ?? null,
    payload.sourceMessageId ?? null,
    payload.deliverableSummary ?? null,
    payload.dueAt ?? null,
    payload.lastProgressAt ?? null,
    payload.emptyWakeCount,
    payload.createdAt,
    payload.updatedAt,
  );
  return payload;
}

export function getTodo(db: DbHandle, organizationId: string, todoId: string): Todo | null {
  const row = db
    .prepare('SELECT * FROM todos WHERE organization_id = ? AND id = ?')
    .get(organizationId, todoId) as Row | null;
  return row ? rowToTodo(row) : null;
}

export function listTodosForSession(
  db: DbHandle,
  organizationId: string,
  taskSessionId: string,
  options: { status?: TodoStatus; memberId?: string } = {},
): Todo[] {
  const params: (string)[] = [organizationId, taskSessionId];
  let query = 'SELECT * FROM todos WHERE organization_id = ? AND task_session_id = ?';
  if (options.status) {
    query += ' AND status = ?';
    params.push(options.status);
  }
  if (options.memberId) {
    query += ' AND member_id = ?';
    params.push(options.memberId);
  }
  query += ' ORDER BY created_at ASC';
  const rows = db.prepare(query).all(...params) as Row[];
  return rows.map(rowToTodo);
}

/**
 * Two paths into the result set:
 *   1. Direct `todos.channel_id = ?` — the commitment extractor and
 *      Tasks-tab PATCH path both write channel_id directly.
 *   2. Indirect via `task_sessions.channel_id = ?` — historical
 *      supervisor-created todos predate the channel_id backfill and
 *      only carry `task_session_id`. Without this leg the goals rail
 *      and Tasks tab would silently drop those rows.
 *
 * The UNION keeps the query covered by `idx_todos_channel` for the
 * direct hit and by `idx_task_sessions_org_status` for the indirect
 * one; rows that satisfy both paths are deduped by `id`.
 */
export function listTodosForChannel(
  db: DbHandle,
  organizationId: string,
  channelId: string,
  options: { status?: TodoStatus; memberId?: string } = {},
): Todo[] {
  const params: string[] = [organizationId, channelId, channelId];
  let where = '';
  if (options.status) {
    where += ' AND t.status = ?';
    params.push(options.status);
  }
  if (options.memberId) {
    where += ' AND t.member_id = ?';
    params.push(options.memberId);
  }
  const query = `
    SELECT DISTINCT t.* FROM todos t
      LEFT JOIN task_sessions s
        ON s.id = t.task_session_id
       AND s.organization_id = t.organization_id
     WHERE t.organization_id = ?
       AND (t.channel_id = ? OR s.channel_id = ?)
       ${where}
     ORDER BY t.created_at ASC
  `;
  const rows = db.prepare(query).all(...params) as Row[];
  return rows.map(rowToTodo);
}

/** Return idle commitments for passive cleanup. */
export function listIdleCommitments(
  db: DbHandle,
  options: {
    idleSinceIso: string;
    statuses?: readonly TodoStatus[];
    limit?: number;
  },
): Todo[] {
  const statuses = options.statuses ?? (['pending', 'in_progress'] as const);
  const placeholders = statuses.map(() => '?').join(', ');
  const limit = options.limit ?? 50;
  const rows = db
    .prepare(
      `SELECT * FROM todos
        WHERE status IN (${placeholders})
          AND deliverable_summary IS NOT NULL
          AND (last_progress_at IS NULL OR last_progress_at < ?)
        ORDER BY last_progress_at IS NULL DESC, last_progress_at ASC
        LIMIT ?`,
    )
    .all(...statuses, options.idleSinceIso, limit) as Row[];
  return rows.map(rowToTodo);
}

/**
 * Atomic flip from "still open and past due" → `expired`. Returns
 * true when this caller successfully claimed the row, false when
 * another sweep / a human update raced ahead.
 *
 * The deadline-letter sweep used to publish first and persist the
 * status flip second. A crash between those steps left the row
 * eligible for the next sweep — and the same expiration notice
 * would publish again. With this claim helper the sweep flips the
 * status BEFORE publishing, so a crash after publish-success but
 * before the in-memory loop completes simply skips the row next
 * tick (since its status is already `expired`). The worst-case
 * outcome inverts: a publish that errors after a successful claim
 * means one missed letter rather than a duplicate letter — the
 * lesser of two evils.
 */
export function claimExpiredCommitment(
  db: DbHandle,
  todoId: string,
  nowIso: string,
): boolean {
  const result = db
    .prepare(
      `UPDATE todos
          SET status = 'expired', updated_at = ?
        WHERE id = ?
          AND status IN ('pending', 'in_progress', 'blocked')
          AND due_at IS NOT NULL
          AND due_at <= ?`,
    )
    .run(nowIso, todoId, nowIso);
  return (result.changes ?? 0) > 0;
}

/**
 * Scheduler query — return commitments whose due_at has elapsed and
 * are still open. The scheduler flips these to `expired` and posts a
 * deadline-letter system message.
 */
export function listExpiredCommitments(
  db: DbHandle,
  options: { nowIso: string; limit?: number },
): Todo[] {
  const limit = options.limit ?? 50;
  const rows = db
    .prepare(
      `SELECT * FROM todos
        WHERE status IN ('pending', 'in_progress', 'blocked')
          AND due_at IS NOT NULL
          AND due_at <= ?
        ORDER BY due_at ASC
        LIMIT ?`,
    )
    .all(options.nowIso, limit) as Row[];
  return rows.map(rowToTodo);
}

/**
 * Find an open commitment for `(organizationId, channelId, memberId)`
 * created within `sinceIso` (lookback window). Used by the commitment
 * extractor to dedup near-identical "I will proceed…" messages.
 *
 * Returns the most recently created candidate. Bounded to a single
 * row because dedup is per-pair, not per-deliverable.
 */
export function findOpenChannelCommitmentForMember(
  db: DbHandle,
  organizationId: string,
  channelId: string,
  memberId: string,
  sinceIso: string,
): Todo | null {
  const row = db
    .prepare(
      `SELECT * FROM todos
        WHERE organization_id = ?
          AND channel_id = ?
          AND member_id = ?
          AND status IN ('pending', 'in_progress')
          AND deliverable_summary IS NOT NULL
          AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .get(organizationId, channelId, memberId, sinceIso) as Row | null;
  return row ? rowToTodo(row) : null;
}

/** Find the commitment that produced a given source-message. */
export function findCommitmentBySourceMessage(
  db: DbHandle,
  organizationId: string,
  sourceMessageId: string,
): Todo | null {
  const row = db
    .prepare(
      `SELECT * FROM todos
        WHERE organization_id = ?
          AND source_message_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .get(organizationId, sourceMessageId) as Row | null;
  return row ? rowToTodo(row) : null;
}

export function updateTodoStatus(
  db: DbHandle,
  organizationId: string,
  todoId: string,
  status: TodoStatus,
  options: { notes?: string } = {},
): Todo | null {
  const existing = getTodo(db, organizationId, todoId);
  if (!existing) return null;
  return saveTodo(db, {
    ...existing,
    status,
    notes: options.notes ?? existing.notes,
    updatedAt: new Date().toISOString(),
  });
}
