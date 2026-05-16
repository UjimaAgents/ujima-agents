import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { ConversationThreadSchema, type ConversationThread } from '@ujima/shared';
import { now, optionalRowString, replaceMemberLinks, rowString } from './common.js';

type Row = Record<string, unknown>;

export function saveThread(db: DbHandle, thread: ConversationThread): ConversationThread {
  const payload = ConversationThreadSchema.parse({
    ...thread,
    memberIds: thread.memberIds ?? [],
  });

  db.prepare(
    `INSERT INTO threads (id, organization_id, channel_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       channel_id = excluded.channel_id,
       title = excluded.title,
       updated_at = excluded.updated_at`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.channelId ?? null,
    payload.title,
    payload.createdAt,
    now(),
  );

  setThreadMembers(db, payload.id, payload.memberIds);
  return payload;
}

export function ensureThread(
  db: DbHandle,
  thread: ConversationThread,
): ConversationThread {
  const existing = getThread(db, thread.organizationId, thread.id);
  return existing ?? saveThread(db, thread);
}

export function getThread(
  db: DbHandle,
  organizationId: string,
  threadId: string,
): ConversationThread | null {
  const row = db
    .prepare('SELECT * FROM threads WHERE organization_id = ? AND id = ?')
    .get(organizationId, threadId) as Row | null;

  if (!row) {
    return null;
  }

  return ConversationThreadSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    channelId: optionalRowString(row, 'channel_id'),
    memberIds: listThreadMemberIds(db, rowString(row, 'id')),
    title: rowString(row, 'title'),
    createdAt: rowString(row, 'created_at'),
  });
}

export function setThreadMembers(
  db: DbHandle,
  threadId: string,
  memberIds: string[],
): void {
  replaceMemberLinks(db, 'thread_members', 'thread_id', threadId, memberIds);
  const channelId = getThreadChannelId(db, threadId);
  if (channelId) {
    replaceMemberLinks(db, 'channel_members', 'channel_id', channelId, memberIds);
  }
}

export function listThreadMemberIds(db: DbHandle, threadId: string): string[] {
  const rows = db
    .prepare(
      'SELECT member_id FROM thread_members WHERE thread_id = ? ORDER BY member_id ASC',
    )
    .all(threadId) as { member_id: string }[];

  return rows.map((row) => row.member_id);
}

export function getThreadChannelId(db: DbHandle, threadId: string): string | undefined {
  const row = db
    .prepare('SELECT channel_id FROM threads WHERE id = ?')
    .get(threadId) as Row | null;

  return row ? optionalRowString(row, 'channel_id') : undefined;
}

export function listThreadIdsForChannel(db: DbHandle, channelId: string): string[] {
  const rows = db
    .prepare('SELECT id FROM threads WHERE channel_id = ? OR id = ? ORDER BY id ASC')
    .all(channelId, channelId) as { id: string }[];

  return rows.map((row) => row.id);
}
