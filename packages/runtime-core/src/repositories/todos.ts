import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { TodoSchema, type Todo, type TodoStatus } from '@ujima/shared';
import { optionalRowString, rowString } from './common.js';

type Row = Record<string, unknown>;

function rowToTodo(row: Row): Todo {
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
       created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
 * List todos by channel — Bet 4 / Bet 2. Used by the goals rail and
 * by the scheduler when it needs to enumerate "open commitments in
 * this channel" without first looking up the task session.
 */
export function listTodosForChannel(
  db: DbHandle,
  organizationId: string,
  channelId: string,
  options: { status?: TodoStatus; memberId?: string } = {},
): Todo[] {
  const params: string[] = [organizationId, channelId];
  let query = 'SELECT * FROM todos WHERE organization_id = ? AND channel_id = ?';
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
 * Scheduler query — return commitments that need a follow-up wake
 * (idle worker, not yet expired). Returned ordered by last-progress
 * so the oldest stale commitments wake first.
 *
 * NB: this is a *read* — caller must claim each row via
 * {@link claimIdleCommitment} before invoking the wake to avoid
 * double-waking when two sweeps overlap or the daemon restarts mid-
 * sweep. Backed by the partial index `idx_todos_idle_progress`
 * (migration 023).
 */
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
 * Atomically claim a commitment for sweeping — sets
 * `last_progress_at` to `now` ONLY if it still matches the value the
 * sweeper just read. Returns `true` on successful claim, `false` if
 * another sweep or a human update raced ahead. Standard "claim by
 * update" pattern from production queue systems; avoids double-wake
 * on daemon restart, accidental two-daemon, or concurrent ticks.
 */
export function claimIdleCommitment(
  db: DbHandle,
  todoId: string,
  expectedLastProgressAt: string | null,
  newLastProgressAt: string,
): boolean {
  const result = db
    .prepare(
      expectedLastProgressAt === null
        ? `UPDATE todos
              SET last_progress_at = ?, updated_at = ?
            WHERE id = ?
              AND last_progress_at IS NULL
              AND status IN ('pending', 'in_progress')`
        : `UPDATE todos
              SET last_progress_at = ?, updated_at = ?
            WHERE id = ?
              AND last_progress_at = ?
              AND status IN ('pending', 'in_progress')`,
    )
    .run(
      ...(expectedLastProgressAt === null
        ? [newLastProgressAt, newLastProgressAt, todoId]
        : [newLastProgressAt, newLastProgressAt, todoId, expectedLastProgressAt]),
    );
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
