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
    createdAt: rowString(row, 'created_at'),
    updatedAt: rowString(row, 'updated_at'),
  });
}

export function saveTodo(db: DbHandle, todo: Todo): Todo {
  const payload = TodoSchema.parse(todo);
  db.prepare(
    `INSERT INTO todos (
       id, organization_id, task_session_id, run_id, member_id,
       title, status, notes, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       task_session_id = excluded.task_session_id,
       run_id = excluded.run_id,
       title = excluded.title,
       status = excluded.status,
       notes = excluded.notes,
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
