import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { ChannelSchema, type Channel } from '@ujima/shared';
import { now, rowString } from './common.js';

type Row = Record<string, unknown>;

export interface PaginatedChannels {
  data: Channel[];
  nextCursor?: string;
  hasMore: boolean;
}

export function saveChannel(db: DbHandle, channel: Channel): Channel {
  const payload = ChannelSchema.parse(channel);
  const timestamp = now();

  db.prepare(
    `INSERT INTO channels (id, organization_id, name, kind, topic, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       kind = excluded.kind,
       topic = excluded.topic,
       updated_at = excluded.updated_at`,
  ).run(
    payload.id,
    payload.organizationId ?? null,
    payload.name,
    payload.kind,
    payload.topic ?? '',
    timestamp,
    timestamp,
  );

  return payload;
}

export function getChannel(
  db: DbHandle,
  organizationId: string,
  channelId: string,
): Channel | null {
  const row = db
    .prepare('SELECT * FROM channels WHERE organization_id = ? AND id = ?')
    .get(organizationId, channelId) as Row | null;

  if (!row) {
    return null;
  }

  return ChannelSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    name: rowString(row, 'name'),
    kind: rowString(row, 'kind'),
    topic: rowString(row, 'topic'),
    memberIds: listChannelMemberIds(db, rowString(row, 'id')),
    createdAt: typeof row.created_at === 'string' ? row.created_at : undefined,
  });
}

export function listChannels(
  db: DbHandle,
  organizationId: string,
  cursor?: string,
  limit = 50,
): PaginatedChannels {
  const params: (string | number)[] = [organizationId];
  let query = 'SELECT * FROM channels WHERE organization_id = ?';

  if (cursor) {
    query += ' AND created_at < ?';
    params.push(cursor);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit + 1);

  const rows = db.prepare(query).all(...params) as Row[];

  const hasMore = rows.length > limit;
  if (hasMore) {
    rows.pop();
  }

  const data = rows.map((row) =>
    ChannelSchema.parse({
      id: rowString(row, 'id'),
      organizationId: rowString(row, 'organization_id'),
      name: rowString(row, 'name'),
      kind: rowString(row, 'kind'),
      topic: rowString(row, 'topic'),
      memberIds: listChannelMemberIds(db, rowString(row, 'id')),
      createdAt: typeof row.created_at === 'string' ? row.created_at : undefined,
    }),
  );

  const tail = hasMore ? data[data.length - 1] : undefined;
  const nextCursor = tail?.createdAt;

  return { data, hasMore, nextCursor };
}

export function setChannelMembers(db: DbHandle, channelId: string, memberIds: string[]): void {
  db.prepare('DELETE FROM channel_members WHERE channel_id = ?').run(channelId);
  const insert = db.prepare('INSERT INTO channel_members (channel_id, member_id) VALUES (?, ?)');
  for (const memberId of memberIds) {
    insert.run(channelId, memberId);
  }
}

export function listChannelMemberIds(db: DbHandle, channelId: string): string[] {
  const rows = db
    .prepare(
      'SELECT member_id FROM channel_members WHERE channel_id = ? ORDER BY member_id ASC',
    )
    .all(channelId) as { member_id: string }[];

  return rows.map((row) => row.member_id);
}
