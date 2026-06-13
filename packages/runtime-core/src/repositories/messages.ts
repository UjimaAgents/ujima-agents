import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { MessageMetadataSchema, MessageSchema, type Attachment, type Message } from '@ujima/shared';
import { parseJsonArray, parseJsonArrayRaw, rowString, optionalRowString } from './common.js';
import { cursorWhereClause, decodeCursor, encodeCursor } from '@ujima/shared';
import { listMessageAttachmentsForMessageIds } from './attachments.js';

type Row = Record<string, unknown>;

export interface PaginatedMessages {
  data: Message[];
  nextCursor?: string;
  hasMore: boolean;
  searchRanks?: Record<string, number>;
}

function messagePage(db: DbHandle, rows: Row[], limit: number): PaginatedMessages {
  const hasMore = rows.length > limit;
  if (hasMore) rows.shift();
  const attachments = listMessageAttachmentsForMessageIds(
    db,
    rows.map((row) => rowString(row, 'id')),
  );
  const data = rows.map((row) =>
    rowToMessage(row, attachments.get(rowString(row, 'id'))),
  );
  const head = hasMore ? data[0] : undefined;
  return {
    data,
    hasMore,
    nextCursor: head ? encodeCursor(head.createdAt, head.id) : undefined,
  };
}

export function saveMessage(db: DbHandle, message: Message): Message {
  const payload = MessageSchema.parse(message);

  // L10 — persist the client-supplied idempotency key into the
  // metadata JSON blob so `findMessageByClientId` can recover it
  // on retry. We deliberately do not add a SQL column today; the
  // JSON-scan path is enough for the retry-glitch use case and
  // avoids a larger schema migration. Keep the blob shape:
  //   { ...metadata, clientMessageId: '...' }
  //
  // Race-safety: migration 021 created a UNIQUE partial index on
  // (organization_id, sender_id, json_extract(metadata,
  // '$.clientMessageId')). Two concurrent inserts with the same
  // (org, sender, clientMessageId) will both pass the application
  // lookup but only one will commit — the other hits
  // SQLITE_CONSTRAINT, and we recover by returning the row that
  // won the race. This matches the lookup-hit semantics in
  // conversations.ts (request returns the existing message,
  // wake-fanout fires only once).
  const metadataBlob: Record<string, unknown> = {
    ...(payload.metadata ?? {}),
    ...(payload.clientMessageId ? { clientMessageId: payload.clientMessageId } : {}),
  };

  try {
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
        reasoning_content,
        input_tokens,
        output_tokens,
        mentions,
        tool_calls,
        metadata,
        created_at,
        edited_at,
        deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      payload.reasoningContent ?? null,
      payload.inputTokens ?? null,
      payload.outputTokens ?? null,
      JSON.stringify(payload.mentions),
      JSON.stringify(payload.toolCalls ?? []),
      JSON.stringify(metadataBlob),
      payload.createdAt,
      payload.editedAt ?? null,
      payload.deletedAt ?? null,
    );
    return payload;
  } catch (error) {
    if (isUniqueConstraintViolation(error) && payload.clientMessageId) {
      // Another concurrent insert won the race for this
      // clientMessageId. Recover by returning the winner — same
      // semantics as the lookup-hit path. No wake fanout from
      // this caller because we're not the one who inserted.
      const winner = findMessageByClientId(
        db,
        payload.organizationId,
        payload.senderId,
        payload.threadId,
        payload.clientMessageId,
      );
      if (winner) return winner;
    }
    throw error;
  }
}

/**
 * SQLite UNIQUE constraint detection. Bun's sqlite + better-sqlite3
 * both surface the constraint as a regular Error with the code
 * `SQLITE_CONSTRAINT_UNIQUE` (or the broader `SQLITE_CONSTRAINT`).
 * String-matching the message keeps this driver-agnostic.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: unknown; message?: unknown };
  if (typeof err.code === 'string') {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
    if (err.code === 'SQLITE_CONSTRAINT') return true;
  }
  if (typeof err.message === 'string') {
    if (/UNIQUE\s+constraint\s+failed/i.test(err.message)) return true;
  }
  return false;
}

export function updateMessage(db: DbHandle, message: Message): Message {
  const payload = MessageSchema.parse(message);

  // B4 fix — preserve `clientMessageId` inside the stored metadata
  // blob on update, matching the saveMessage path. Without this,
  // any edit / re-publish / compaction strips the idempotency
  // token and a subsequent retry would no longer dedupe.
  const metadataBlob: Record<string, unknown> = {
    ...(payload.metadata ?? {}),
    ...(payload.clientMessageId ? { clientMessageId: payload.clientMessageId } : {}),
  };

  db.prepare(
    `UPDATE messages
        SET thread_id = ?,
            channel_id = ?,
            parent_message_id = ?,
            sender_id = ?,
            sender_kind = ?,
            kind = ?,
            content = ?,
            reasoning_content = ?,
            input_tokens = ?,
            output_tokens = ?,
            mentions = ?,
            tool_calls = ?,
            metadata = ?,
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
    payload.reasoningContent ?? null,
    payload.inputTokens ?? null,
    payload.outputTokens ?? null,
    JSON.stringify(payload.mentions),
    JSON.stringify(payload.toolCalls ?? []),
    JSON.stringify(metadataBlob),
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

  if (!row) return null;
  const attachments = listMessageAttachmentsForMessageIds(db, [messageId]).get(messageId);
  return rowToMessage(row, attachments);
}

/**
 * L10 — idempotency lookup. Searches for a previously saved message
 * whose metadata JSON blob carries the same `clientMessageId` from
 * the same sender in the same org and thread. Uses SQLite's
 * json_extract so the scan is bounded by the (org, sender, thread)
 * prefix on the messages table; even on busy orgs this is cheap
 * because clientMessageId dedup only runs when the client explicitly
 * sends one (so only for retried POSTs).
 */
export function findMessageByClientId(
  db: DbHandle,
  organizationId: string,
  senderId: string,
  threadId: string,
  clientMessageId: string,
): Message | null {
  const row = db
    .prepare(
      `SELECT * FROM messages
       WHERE organization_id = ? AND sender_id = ? AND thread_id = ?
         AND json_extract(metadata, '$.clientMessageId') = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    )
    .get(organizationId, senderId, threadId, clientMessageId) as Row | null;

  if (!row) return null;
  const messageId = rowString(row, 'id');
  const attachments = listMessageAttachmentsForMessageIds(db, [messageId]).get(messageId);
  return rowToMessage(row, attachments);
}

export function getLatestHumanMessageInThread(
  db: DbHandle,
  organizationId: string,
  threadId: string,
): Message | null {
  const row = db
    .prepare(
      `SELECT * FROM messages
       WHERE organization_id = ? AND thread_id = ? AND kind = 'human'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    )
    .get(organizationId, threadId) as Row | null;

  if (!row) return null;
  const messageId = rowString(row, 'id');
  const attachments = listMessageAttachmentsForMessageIds(db, [messageId]).get(messageId);
  return rowToMessage(row, attachments);
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

  return messagePage(db, rows, limit);
}

export function countMessagesSince(
  db: DbHandle,
  organizationId: string,
  threadId: string,
  input: {
    since?: string;
    excludeSenderId?: string;
  } = {},
): number {
  const params: (string | number)[] = [organizationId, threadId];
  let query = 'SELECT COUNT(*) AS count FROM messages WHERE organization_id = ? AND thread_id = ?';

  if (input.since) {
    query += ' AND created_at > ?';
    params.push(input.since);
  }
  if (input.excludeSenderId) {
    query += ' AND sender_id <> ?';
    params.push(input.excludeSenderId);
  }

  const row = db.prepare(query).get(...params) as { count?: number } | undefined;
  return typeof row?.count === 'number' ? row.count : 0;
}

export function countUncompactedMessageChars(
  db: DbHandle,
  organizationId: string,
  threadId: string,
): number {
  const row = db.prepare(
    `SELECT COALESCE(SUM(LENGTH(content)), 0) AS count
     FROM messages
     WHERE organization_id = ?
       AND thread_id = ?
       AND json_extract(metadata, '$.compactedInto') IS NULL
       AND content NOT LIKE '[[CONVERSATION_SUMMARY_%'
       AND content NOT LIKE '[[CONVERSATION_COMPACTED_%'
       AND content NOT LIKE '[[CONVERSATION_ARCHIVE_%'`,
  ).get(organizationId, threadId) as { count?: number } | undefined;
  return typeof row?.count === 'number' ? row.count : 0;
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
  return messagePage(db, rows, limit);
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
    ranked?: boolean;
  } = {},
): PaginatedMessages {
  const limit = options.limit ?? 50;
  const terms = normalizeSearchTerms(queryText);
  const safeFtsQuery = buildSafeFtsQuery(terms);
  const params: (string | number)[] = [organizationId, channelId, safeFtsQuery];
  let innerQuery = `
    SELECT m.*, bm25(messages_fts) AS search_rank
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

  innerQuery += options.ranked
    ? ' ORDER BY search_rank ASC, m.created_at DESC, m.id DESC LIMIT ?'
    : ' ORDER BY m.created_at DESC, m.id DESC LIMIT ?';
  params.push(limit + 1);

  try {
    const query = options.ranked
      ? innerQuery
      : `SELECT * FROM (${innerQuery}) ORDER BY created_at ASC, id ASC`;
    const rows = db.prepare(query).all(...params) as Row[];
    const hasMore = rows.length > limit;
    if (hasMore) {
      if (options.ranked) {
        rows.pop();
      } else {
        rows.shift();
      }
    }
    const attachmentsByMessageId = listMessageAttachmentsForMessageIds(
      db,
      rows.map((row) => rowString(row, 'id')),
    );
    const data = rows.map((row) => rowToMessage(row, attachmentsByMessageId.get(rowString(row, 'id'))));
    const head = hasMore ? data[0] : undefined;
    const searchRanks = options.ranked
      ? Object.fromEntries(data.map((message, index) => [message.id, rowSearchRank(rows[index])]))
      : undefined;
    return {
      data,
      hasMore,
      nextCursor: options.ranked ? undefined : head ? encodeCursor(head.createdAt, head.id) : undefined,
      ...(searchRanks ? { searchRanks } : {}),
    };
  } catch {
    // User-entered search text can contain broken FTS syntax like unmatched
    // quotes. Fall back to substring search instead of surfacing an SQL error.
    return searchChannelMessagesBySubstring(db, organizationId, channelId, terms, options);
  }
}

function rowSearchRank(row: Row | undefined): number {
  if (!row) return Number.POSITIVE_INFINITY;
  const raw = row['search_rank'];
  const rank = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(rank) ? rank : Number.POSITIVE_INFINITY;
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

function rowToMessage(row: Row, attachments: Attachment[] = []): Message {
  const kind = rowString(row, 'kind');
  const content = rowString(row, 'content');
  const { metadata, clientMessageId } = parseRowMetadata(row.metadata);
  const inputTokens = rowInteger(row, 'input_tokens');
  const outputTokens = rowInteger(row, 'output_tokens');
  return MessageSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    threadId: rowString(row, 'thread_id'),
    channelId: optionalRowString(row, 'channel_id'),
    parentMessageId: optionalRowString(row, 'parent_message_id'),
    senderId: rowString(row, 'sender_id'),
    senderKind: rowString(row, 'sender_kind'),
    kind,
    content,
    reasoningContent: optionalRowString(row, 'reasoning_content'),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    mentions: parseJsonArray(row.mentions),
    toolCalls: parseJsonArrayRaw(row.tool_calls),
    attachments,
    ...(metadata ? { metadata } : {}),
    ...(clientMessageId ? { clientMessageId } : {}),
    createdAt: rowString(row, 'created_at'),
    editedAt: optionalRowString(row, 'edited_at'),
    deletedAt: optionalRowString(row, 'deleted_at'),
  });
}

/**
 * Split the stored metadata blob into the structured metadata
 * (parsed by MessageMetadataSchema) and the top-level
 * `clientMessageId` field. L10 — clientMessageId is persisted
 * inside the same blob to avoid a SQL migration, but exposed as
 * a top-level field on the parsed Message.
 */
function parseRowMetadata(raw: unknown): {
  metadata: Message['metadata'];
  clientMessageId?: string;
} {
  if (typeof raw !== 'string' || raw.length === 0 || raw === '{}') {
    return { metadata: undefined };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const clientMessageId =
      typeof parsed.clientMessageId === 'string' && parsed.clientMessageId.length > 0
        ? parsed.clientMessageId
        : undefined;
    // Strip clientMessageId out before letting the metadata schema
    // see it — the schema doesn't declare it, and `.strict()` is
    // not used so unknown keys are dropped silently, but being
    // explicit keeps the contract clear.
    const { clientMessageId: _, ...rest } = parsed;
    void _;
    const result = MessageMetadataSchema.safeParse(rest);
    if (!result.success || result.data === undefined) {
      return { metadata: undefined, clientMessageId };
    }
    const metadata =
      Object.keys(result.data).length > 0 ? result.data : undefined;
    return { metadata, clientMessageId };
  } catch {
    return { metadata: undefined };
  }
}

function rowInteger(row: Row, key: string): number | undefined {
  const value = row[key];
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
  }
  return undefined;
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
  return messagePage(db, rows, limit);
}

function escapeLikePattern(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}
