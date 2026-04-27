import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { ChannelSchema, type Channel, type ChannelKind } from '@ujima/shared';
import { now, rowString } from './common.js';
import { cursorWhereClause, decodeCursor, encodeCursor } from '@ujima/shared';

type Row = Record<string, unknown>;

export interface PaginatedChannels {
  data: Channel[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface ListChannelsOptions {
  cursor?: string;
  limit?: number;
  /**
   * Channel kinds to exclude at the SQL layer. Filtering must happen here
   * (not after pagination) so `hasMore` / `nextCursor` are computed against
   * the same result set the caller actually sees. Otherwise — once a `self`
   * or `dm` channel exists — the cursor can land on a hidden row and the
   * caller skips visible channels on the next page.
   */
  excludeKinds?: readonly ChannelKind[];
}

export function saveChannel(db: DbHandle, channel: Channel): Channel {
  const payload = ChannelSchema.parse(channel);
  const timestamp = now();

  db.prepare(
    `INSERT INTO channels (id, organization_id, name, kind, topic, created_at, updated_at, parent_message_id, archived_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       kind = excluded.kind,
       topic = excluded.topic,
       parent_message_id = excluded.parent_message_id,
       archived_at = excluded.archived_at,
       updated_at = excluded.updated_at`,
  ).run(
    payload.id,
    payload.organizationId ?? null,
    payload.name,
    payload.kind,
    payload.topic ?? '',
    timestamp,
    timestamp,
    payload.parentMessageId ?? null,
    payload.archivedAt ?? null,
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
    parentMessageId: typeof row.parent_message_id === 'string' ? row.parent_message_id : undefined,
    createdAt: typeof row.created_at === 'string' ? row.created_at : undefined,
    archivedAt: typeof row.archived_at === 'string' ? row.archived_at : undefined,
  });
}

export function listChannels(
  db: DbHandle,
  organizationId: string,
  cursor?: string,
  limit = 50,
  excludeKinds: readonly ChannelKind[] = [],
): PaginatedChannels {
  const params: (string | number)[] = [organizationId];
  let query = 'SELECT * FROM channels WHERE organization_id = ?';

  if (excludeKinds.length > 0) {
    const placeholders = excludeKinds.map(() => '?').join(', ');
    query += ` AND kind NOT IN (${placeholders})`;
    params.push(...excludeKinds);
  }

  const decoded = decodeCursor(cursor);
  if (decoded) {
    const { sql, params: cursorParams } = cursorWhereClause(decoded, 'created_at', 'id');
    query += ` AND ${sql}`;
    params.push(...cursorParams);
  }

  query += ' ORDER BY created_at DESC, id DESC LIMIT ?';
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
      parentMessageId: typeof row.parent_message_id === 'string' ? row.parent_message_id : undefined,
      createdAt: typeof row.created_at === 'string' ? row.created_at : undefined,
      archivedAt: typeof row.archived_at === 'string' ? row.archived_at : undefined,
    }),
  );

  const tail = hasMore ? data[data.length - 1] : undefined;
  const nextCursor = tail?.createdAt && tail.id ? encodeCursor(tail.createdAt, tail.id) : undefined;

  return { data, hasMore, nextCursor };
}

export function listAllChannels(db: DbHandle, organizationId: string): Channel[] {
  const rows = db
    .prepare('SELECT * FROM channels WHERE organization_id = ? ORDER BY created_at DESC, id DESC')
    .all(organizationId) as Row[];

  return rows.map((row) =>
    ChannelSchema.parse({
      id: rowString(row, 'id'),
      organizationId: rowString(row, 'organization_id'),
      name: rowString(row, 'name'),
      kind: rowString(row, 'kind'),
      topic: rowString(row, 'topic'),
      memberIds: listChannelMemberIds(db, rowString(row, 'id')),
      parentMessageId: typeof row.parent_message_id === 'string' ? row.parent_message_id : undefined,
      createdAt: typeof row.created_at === 'string' ? row.created_at : undefined,
      archivedAt: typeof row.archived_at === 'string' ? row.archived_at : undefined,
    }),
  );
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
