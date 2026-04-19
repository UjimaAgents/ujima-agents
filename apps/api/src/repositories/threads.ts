import type { Database } from "bun:sqlite";
import { ConversationThreadSchema, type ConversationThread } from "@ujima/shared";
import { now, optionalRowString, rowString } from "./common.ts";

type Row = Record<string, unknown>;

export function saveThread(db: Database, thread: ConversationThread): ConversationThread {
  const payload = ConversationThreadSchema.parse({
    ...thread,
    memberIds: thread.memberIds ?? [],
  });

  db.run(
    `
    INSERT INTO threads (id, organization_id, channel_id, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      channel_id = excluded.channel_id,
      title = excluded.title,
      updated_at = excluded.updated_at
    `,
    [payload.id, payload.organizationId, payload.channelId ?? null, payload.title, payload.createdAt, now()],
  );

  setThreadMembers(db, payload.id, payload.memberIds);
  return payload;
}

export function ensureThread(db: Database, thread: ConversationThread): ConversationThread {
  const existing = getThread(db, thread.organizationId, thread.id);
  return existing ?? saveThread(db, thread);
}

export function getThread(db: Database, organizationId: string, threadId: string): ConversationThread | null {
  const row = db.query("SELECT * FROM threads WHERE organization_id = ? AND id = ?").get(
    organizationId,
    threadId,
  ) as Row | null;

  if (!row) {
    return null;
  }

  return ConversationThreadSchema.parse({
    id: rowString(row, "id"),
    organizationId: rowString(row, "organization_id"),
    channelId: optionalRowString(row, "channel_id"),
    memberIds: listThreadMemberIds(db, rowString(row, "id")),
    title: rowString(row, "title"),
    createdAt: rowString(row, "created_at"),
  });
}

export function setThreadMembers(db: Database, threadId: string, memberIds: string[]) {
  db.run("DELETE FROM thread_members WHERE thread_id = ?", [threadId]);
  for (const memberId of memberIds) {
    db.run("INSERT INTO thread_members (thread_id, member_id) VALUES (?, ?)", [threadId, memberId]);
  }
}

export function listThreadMemberIds(db: Database, threadId: string): string[] {
  const rows = db.query("SELECT member_id FROM thread_members WHERE thread_id = ? ORDER BY member_id ASC").all(
    threadId,
  ) as Array<{ member_id: string }>;

  return rows.map((row) => row.member_id);
}

