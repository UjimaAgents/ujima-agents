import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { MessageSchema, type Message } from '@ujima/shared';
import { parseJsonArray, parseJsonArrayRaw, rowString } from './common.js';

type Row = Record<string, unknown>;

export interface PaginatedMessages {
  data: Message[];
  nextCursor?: string;
  hasMore: boolean;
}

export function saveMessage(db: DbHandle, message: Message): Message {
  const payload = MessageSchema.parse(message);

  db.prepare(
    `INSERT INTO messages (id, organization_id, thread_id, channel_id, sender_id, sender_kind, kind, content, mentions, tool_calls, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.threadId,
    payload.channelId ?? null,
    payload.senderId,
    payload.senderKind,
    payload.kind,
    payload.content,
    JSON.stringify(payload.mentions),
    JSON.stringify(payload.toolCalls ?? []),
    payload.createdAt,
  );

  return payload;
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

  if (cursor) {
    innerQuery += ' AND created_at < ?';
    params.push(cursor);
  }

  innerQuery += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit + 1);

  const query = `SELECT * FROM (${innerQuery}) ORDER BY created_at ASC`;
  const rows = db.prepare(query).all(...params) as Row[];

  const hasMore = rows.length > limit;
  if (hasMore) {
    rows.shift();
  }

  const data = rows.map((row) =>
    MessageSchema.parse({
      id: rowString(row, 'id'),
      organizationId: rowString(row, 'organization_id'),
      threadId: rowString(row, 'thread_id'),
      channelId: typeof row.channel_id === 'string' ? row.channel_id : undefined,
      senderId: rowString(row, 'sender_id'),
      senderKind: rowString(row, 'sender_kind'),
      kind: rowString(row, 'kind'),
      content: rowString(row, 'content'),
      mentions: parseJsonArray(row.mentions),
      toolCalls: parseJsonArrayRaw(row.tool_calls),
      createdAt: rowString(row, 'created_at'),
    }),
  );

  const head = hasMore ? data[0] : undefined;
  const nextCursor = head?.createdAt;

  return { data, hasMore, nextCursor };
}
