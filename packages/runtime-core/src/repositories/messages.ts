import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { MessageSchema, type Message } from '@ujima/shared';
import { parseJsonArray, parseJsonArrayRaw, rowString, optionalRowString } from './common.js';
import { cursorWhereClause, decodeCursor, encodeCursor } from '@ujima/shared';

type Row = Record<string, unknown>;

export interface PaginatedMessages {
  data: Message[];
  nextCursor?: string;
  hasMore: boolean;
}

export function saveMessage(db: DbHandle, message: Message): Message {
  const payload = MessageSchema.parse(message);

  db.prepare(
    `INSERT INTO messages (
      id,
      organization_id,
      thread_id,
      channel_id,
      parent_message_id,
      sender_id,
      sender_kind,
      kind,
      content,
      mentions,
      tool_calls,
      created_at,
      edited_at,
      deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.threadId,
    payload.channelId ?? null,
    payload.parentMessageId ?? null,
    payload.senderId,
    payload.senderKind,
    payload.kind,
    payload.content,
    JSON.stringify(payload.mentions),
    JSON.stringify(payload.toolCalls ?? []),
    payload.createdAt,
    payload.editedAt ?? null,
    payload.deletedAt ?? null,
  );

  return payload;
}

export function updateMessage(db: DbHandle, message: Message): Message {
  const payload = MessageSchema.parse(message);

  db.prepare(
    `UPDATE messages
        SET thread_id = ?,
            channel_id = ?,
            parent_message_id = ?,
            sender_id = ?,
            sender_kind = ?,
            kind = ?,
            content = ?,
            mentions = ?,
            tool_calls = ?,
            edited_at = ?,
            deleted_at = ?
      WHERE organization_id = ? AND id = ?`,
  ).run(
    payload.threadId,
    payload.channelId ?? null,
    payload.parentMessageId ?? null,
    payload.senderId,
    payload.senderKind,
    payload.kind,
    payload.content,
    JSON.stringify(payload.mentions),
    JSON.stringify(payload.toolCalls ?? []),
    payload.editedAt ?? null,
    payload.deletedAt ?? null,
    payload.organizationId,
    payload.id,
  );

  return payload;
}

export function getMessage(
  db: DbHandle,
  organizationId: string,
  messageId: string,
): Message | null {
  const row = db
    .prepare('SELECT * FROM messages WHERE organization_id = ? AND id = ?')
    .get(organizationId, messageId) as Row | null;

  return row ? rowToMessage(row) : null;
}

export function listMessages(
  db: DbHandle,
  organizationId: string,
  threadId: string,
  cursor?: string,
  limit = 50,
): PaginatedMessages {
  const params: (string | number)[] = [organizationId, threadId];
  let innerQuery = 'SELECT * FROM messages WHERE organization_id = ? AND thread_id = ?';

  const decoded = decodeCursor(cursor);
  if (decoded) {
    const { sql, params: cursorParams } = cursorWhereClause(decoded, 'created_at', 'id');
    innerQuery += ` AND ${sql}`;
    params.push(...cursorParams);
  }

  innerQuery += ' ORDER BY created_at DESC, id DESC LIMIT ?';
  params.push(limit + 1);

  const query = `SELECT * FROM (${innerQuery}) ORDER BY created_at ASC, id ASC`;
  const rows = db.prepare(query).all(...params) as Row[];

  const hasMore = rows.length > limit;
  if (hasMore) {
    rows.shift();
  }

  const data = rows.map((row) =>
    rowToMessage(row),
  );

  const head = hasMore ? data[0] : undefined;
  const nextCursor = head ? encodeCursor(head.createdAt, head.id) : undefined;

  return { data, hasMore, nextCursor };
}

export function listChannelMessages(
  db: DbHandle,
  organizationId: string,
  channelId: string,
  options: {
    cursor?: string;
    since?: string;
    limit?: number;
  } = {},
): PaginatedMessages {
  const limit = options.limit ?? 50;
  const params: (string | number)[] = [organizationId, channelId];
  let innerQuery = 'SELECT * FROM messages WHERE organization_id = ? AND channel_id = ?';

  if (options.since) {
    innerQuery += ' AND created_at >= ?';
    params.push(options.since);
  }
  const decoded = decodeCursor(options.cursor);
  if (decoded) {
    const { sql, params: cursorParams } = cursorWhereClause(decoded, 'created_at', 'id');
    innerQuery += ` AND ${sql}`;
    params.push(...cursorParams);
  }

  innerQuery += ' ORDER BY created_at DESC, id DESC LIMIT ?';
  params.push(limit + 1);

  const query = `SELECT * FROM (${innerQuery}) ORDER BY created_at ASC, id ASC`;
  const rows = db.prepare(query).all(...params) as Row[];
  const hasMore = rows.length > limit;
  if (hasMore) rows.shift();
  const data = rows.map(rowToMessage);
  const head = hasMore ? data[0] : undefined;
  return { data, hasMore, nextCursor: head ? encodeCursor(head.createdAt, head.id) : undefined };
}

export function searchChannelMessages(
  db: DbHandle,
  organizationId: string,
  channelId: string,
  queryText: string,
  options: {
    cursor?: string;
    since?: string;
    limit?: number;
  } = {},
): PaginatedMessages {
  const limit = options.limit ?? 50;
  const terms = normalizeSearchTerms(queryText);
  const safeFtsQuery = buildSafeFtsQuery(terms);
  const params: (string | number)[] = [organizationId, channelId, safeFtsQuery];
  let innerQuery = `
    SELECT m.*
      FROM messages_fts f
      JOIN messages m ON m.rowid = f.rowid
     WHERE m.organization_id = ?
       AND m.channel_id = ?
       AND messages_fts MATCH ?
  `;

  if (options.since) {
    innerQuery += ' AND m.created_at >= ?';
    params.push(options.since);
  }
  const decoded = decodeCursor(options.cursor);
  if (decoded) {
    const { sql, params: cursorParams } = cursorWhereClause(decoded, 'm.created_at', 'm.id');
    innerQuery += ` AND ${sql}`;
    params.push(...cursorParams);
  }

  innerQuery += ' ORDER BY m.created_at DESC, m.id DESC LIMIT ?';
  params.push(limit + 1);

  try {
    const query = `SELECT * FROM (${innerQuery}) ORDER BY created_at ASC, id ASC`;
    const rows = db.prepare(query).all(...params) as Row[];
    const hasMore = rows.length > limit;
    if (hasMore) rows.shift();
    const data = rows.map(rowToMessage);
    const head = hasMore ? data[0] : undefined;
    return {
      data,
      hasMore,
      nextCursor: head ? encodeCursor(head.createdAt, head.id) : undefined,
    };
  } catch {
    // User-entered search text can contain broken FTS syntax like unmatched
    // quotes. Fall back to substring search instead of surfacing an SQL error.
    return searchChannelMessagesBySubstring(db, organizationId, channelId, terms, options);
  }
}

export function deleteMessages(
  db: DbHandle,
  organizationId: string,
  messageIds: string[],
): void {
  if (messageIds.length === 0) return;
  const del = db.prepare('DELETE FROM messages WHERE organization_id = ? AND id = ?');
  for (const messageId of messageIds) {
    del.run(organizationId, messageId);
  }
}

function rowToMessage(row: Row): Message {
  return MessageSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    threadId: rowString(row, 'thread_id'),
    channelId: optionalRowString(row, 'channel_id'),
    parentMessageId: optionalRowString(row, 'parent_message_id'),
    senderId: rowString(row, 'sender_id'),
    senderKind: rowString(row, 'sender_kind'),
    kind: rowString(row, 'kind'),
    content: rowString(row, 'content'),
    mentions: parseJsonArray(row.mentions),
    toolCalls: parseJsonArrayRaw(row.tool_calls),
    createdAt: rowString(row, 'created_at'),
    editedAt: optionalRowString(row, 'edited_at'),
    deletedAt: optionalRowString(row, 'deleted_at'),
  });
}

function normalizeSearchTerms(queryText: string): string[] {
  const terms = queryText
    .trim()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  return terms.length > 0 ? terms : [queryText.trim()];
}

function buildSafeFtsQuery(terms: string[]): string {
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' AND ');
}

function searchChannelMessagesBySubstring(
  db: DbHandle,
  organizationId: string,
  channelId: string,
  terms: string[],
  options: {
    cursor?: string;
    since?: string;
    limit?: number;
  },
): PaginatedMessages {
  const limit = options.limit ?? 50;
  const params: (string | number)[] = [organizationId, channelId];
  let innerQuery = 'SELECT * FROM messages WHERE organization_id = ? AND channel_id = ?';

  for (const term of terms) {
    innerQuery += " AND lower(content) LIKE ? ESCAPE '\\'";
    params.push(`%${escapeLikePattern(term.toLowerCase())}%`);
  }

  if (options.since) {
    innerQuery += ' AND created_at >= ?';
    params.push(options.since);
  }
  const decoded = decodeCursor(options.cursor);
  if (decoded) {
    const { sql, params: cursorParams } = cursorWhereClause(decoded, 'created_at', 'id');
    innerQuery += ` AND ${sql}`;
    params.push(...cursorParams);
  }

  innerQuery += ' ORDER BY created_at DESC, id DESC LIMIT ?';
  params.push(limit + 1);

  const query = `SELECT * FROM (${innerQuery}) ORDER BY created_at ASC, id ASC`;
  const rows = db.prepare(query).all(...params) as Row[];
  const hasMore = rows.length > limit;
  if (hasMore) rows.shift();
  const data = rows.map(rowToMessage);
  const head = hasMore ? data[0] : undefined;
  return { data, hasMore, nextCursor: head ? encodeCursor(head.createdAt, head.id) : undefined };
}

function escapeLikePattern(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}
