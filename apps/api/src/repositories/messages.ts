import type { Database } from "bun:sqlite";
import { MessageSchema, type Message } from "@ujima/shared";
import { parseJsonArray, rowString } from "./common.ts";

type Row = Record<string, unknown>;

export function saveMessage(db: Database, message: Message): Message {
  const payload = MessageSchema.parse(message);

  db.run(
    `
    INSERT INTO messages (id, organization_id, thread_id, channel_id, sender_id, sender_kind, kind, content, mentions, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      payload.id,
      payload.organizationId,
      payload.threadId,
      payload.channelId ?? null,
      payload.senderId,
      payload.senderKind,
      payload.kind,
      payload.content,
      JSON.stringify(payload.mentions),
      payload.createdAt,
    ],
  );

  return payload;
}

export function listMessages(
  db: Database,
  organizationId: string,
  threadId: string,
  cursor?: string,
  limit: number = 50,
): { data: Message[]; nextCursor?: string; hasMore: boolean } {
  let innerQuery = "SELECT * FROM messages WHERE organization_id = ? AND thread_id = ?";
  const params: any[] = [organizationId, threadId];

  if (cursor) {
    innerQuery += " AND created_at < ?";
    params.push(cursor);
  }

  innerQuery += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit + 1);

  const query = `SELECT * FROM (${innerQuery}) ORDER BY created_at ASC`;
  const rows = db.query(query).all(...params) as Row[];

  // Note: the rows are in ASC order (oldest first).
  // The 'limit+1' fetches the older messages down to the limit. 
  // If we fetched > limit, it means there are MORE OLDER messages.
  // We need to pop the OLDEST one since it's ASC. Wait, if it's ASC, rows[0] is the oldest, rows[length-1] is the newest.
  const hasMore = rows.length > limit;
  if (hasMore) {
    rows.shift(); // remove the oldest one that proved we have more
  }

  const data = rows.map((row) =>
    MessageSchema.parse({
      id: rowString(row, "id"),
      organizationId: rowString(row, "organization_id"),
      threadId: rowString(row, "thread_id"),
      channelId: typeof row.channel_id === "string" ? row.channel_id : undefined,
      senderId: rowString(row, "sender_id"),
      senderKind: rowString(row, "sender_kind"),
      kind: rowString(row, "kind"),
      content: rowString(row, "content"),
      mentions: parseJsonArray(row.mentions),
      createdAt: rowString(row, "created_at"),
    }),
  );

  const nextCursor = hasMore && data.length > 0 ? data[0].createdAt : undefined;

  return { data, hasMore, nextCursor };
}

