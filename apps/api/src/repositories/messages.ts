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

export function listMessages(db: Database, organizationId: string, threadId: string): Message[] {
  const rows = db.query("SELECT * FROM messages WHERE organization_id = ? AND thread_id = ? ORDER BY created_at ASC").all(
    organizationId,
    threadId,
  ) as Row[];

  return rows.map((row) =>
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
}

