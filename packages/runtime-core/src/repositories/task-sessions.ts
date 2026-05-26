import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import {
  TaskSessionSchema,
  cursorWhereClause,
  decodeCursor,
  encodeCursor,
  type TaskSession,
  type TaskSessionStatus,
} from '@ujima/shared';
import { optionalRowString, rowString } from './common.js';

type Row = Record<string, unknown>;

export interface PaginatedTaskSessions {
  data: TaskSession[];
  nextCursor?: string;
  hasMore: boolean;
}

function parseJsonArray(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function parseJsonRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function rowToTaskSession(row: Row): TaskSession {
  const originChannelId = optionalRowString(row, 'origin_channel_id');
  const originMessageId = optionalRowString(row, 'origin_message_id');
  return TaskSessionSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    slug: rowString(row, 'slug'),
    channelId: rowString(row, 'channel_id'),
    requestedBy: rowString(row, 'requested_by'),
    executionMode: rowString(row, 'execution_mode'),
    status: rowString(row, 'status'),
    prompt: rowString(row, 'prompt'),
    summary: rowString(row, 'summary'),
    teamMemberIds: parseJsonArray(row.team_member_ids),
    origin: {
      channelId: originChannelId,
      messageId: originMessageId,
    },
    promotionMetadata: parseJsonRecord(row.promotion_metadata),
    supervisorTurnCount: typeof row.supervisor_turn_count === 'number' ? row.supervisor_turn_count : 0,
    createdAt: rowString(row, 'created_at'),
    updatedAt: rowString(row, 'updated_at'),
    completedAt: optionalRowString(row, 'completed_at'),
  });
}

export function saveTaskSession(db: DbHandle, session: TaskSession): TaskSession {
  const payload = TaskSessionSchema.parse(session);

  db.prepare(
    `INSERT INTO task_sessions (
       id, organization_id, slug, channel_id, requested_by,
       execution_mode, status, prompt, summary, team_member_ids,
       origin_channel_id, origin_message_id, promotion_metadata,
       supervisor_turn_count, created_at, updated_at, completed_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       summary = excluded.summary,
       team_member_ids = excluded.team_member_ids,
       promotion_metadata = excluded.promotion_metadata,
       supervisor_turn_count = excluded.supervisor_turn_count,
       updated_at = excluded.updated_at,
       completed_at = excluded.completed_at`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.slug,
    payload.channelId,
    payload.requestedBy,
    payload.executionMode,
    payload.status,
    payload.prompt,
    payload.summary,
    JSON.stringify(payload.teamMemberIds),
    payload.origin.channelId ?? null,
    payload.origin.messageId ?? null,
    JSON.stringify(payload.promotionMetadata),
    payload.supervisorTurnCount,
    payload.createdAt,
    payload.updatedAt,
    payload.completedAt ?? null,
  );

  return payload;
}

export function getTaskSession(
  db: DbHandle,
  organizationId: string,
  taskSessionId: string,
): TaskSession | null {
  const row = db
    .prepare('SELECT * FROM task_sessions WHERE organization_id = ? AND id = ?')
    .get(organizationId, taskSessionId) as Row | null;
  return row ? rowToTaskSession(row) : null;
}

export function getTaskSessionBySlug(
  db: DbHandle,
  organizationId: string,
  slug: string,
): TaskSession | null {
  const row = db
    .prepare('SELECT * FROM task_sessions WHERE organization_id = ? AND slug = ?')
    .get(organizationId, slug) as Row | null;
  return row ? rowToTaskSession(row) : null;
}

export function getTaskSessionByChannel(
  db: DbHandle,
  organizationId: string,
  channelId: string,
): TaskSession | null {
  const row = db
    .prepare('SELECT * FROM task_sessions WHERE organization_id = ? AND channel_id = ?')
    .get(organizationId, channelId) as Row | null;
  return row ? rowToTaskSession(row) : null;
}

export function listTaskSessions(
  db: DbHandle,
  organizationId: string,
  options: {
    cursor?: string;
    limit?: number;
    status?: TaskSessionStatus;
  } = {},
): PaginatedTaskSessions {
  const limit = options.limit ?? 50;
  const params: (string | number)[] = [organizationId];
  let query = 'SELECT * FROM task_sessions WHERE organization_id = ?';

  if (options.status) {
    query += ' AND status = ?';
    params.push(options.status);
  }

  const decoded = decodeCursor(options.cursor);
  if (decoded) {
    const { sql, params: cursorParams } = cursorWhereClause(decoded, 'created_at', 'id');
    query += ` AND ${sql}`;
    params.push(...cursorParams);
  }

  query += ' ORDER BY created_at DESC, id DESC LIMIT ?';
  params.push(limit + 1);

  const rows = db.prepare(query).all(...params) as Row[];
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();

  const data = rows.map(rowToTaskSession);
  const tail = hasMore ? data[data.length - 1] : undefined;
  const nextCursor = tail ? encodeCursor(tail.createdAt, tail.id) : undefined;

  return { data, hasMore, nextCursor };
}

/**
 * Find the most recent open task session for a channel, if one
 * exists. Used by the commitment extractor before parking a todo on
 * the channel.
 */
export function findOpenTaskSessionForChannel(
  db: DbHandle,
  organizationId: string,
  channelId: string,
): TaskSession | null {
  const row = db
    .prepare(
      `SELECT * FROM task_sessions
        WHERE organization_id = ?
          AND channel_id = ?
          AND status IN ('queued', 'running', 'waiting_for_approval')
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .get(organizationId, channelId) as Row | null;
  return row ? rowToTaskSession(row) : null;
}

export function updateTaskSessionStatus(
  db: DbHandle,
  organizationId: string,
  taskSessionId: string,
  status: TaskSessionStatus,
  options: { summary?: string; completedAt?: string } = {},
): TaskSession | null {
  const existing = getTaskSession(db, organizationId, taskSessionId);
  if (!existing) return null;

  const updated: TaskSession = {
    ...existing,
    status,
    summary: options.summary ?? existing.summary,
    completedAt: options.completedAt ?? existing.completedAt,
    updatedAt: new Date().toISOString(),
  };
  return saveTaskSession(db, updated);
}
