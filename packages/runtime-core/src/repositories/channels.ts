import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { ChannelSchema, type Channel, type ChannelKind, type ChannelMemberMode, type ChannelMemberSettings } from '@ujima/shared';
import { now, replaceMemberLinks, rowString } from './common.js';
import { cursorWhereClause, decodeCursor, encodeCursor } from '@ujima/shared';
import { listThreadIdsForChannel } from './threads.js';

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

  return rowToChannel(row, listChannelMemberIds(db, rowString(row, 'id')));
}

function rowToChannel(row: Row, memberIds: string[]): Channel {
  return ChannelSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    name: rowString(row, 'name'),
    kind: rowString(row, 'kind'),
    topic: rowString(row, 'topic'),
    memberIds,
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
    // Rows stay in DESC order end-to-end, so the extra `(limit + 1)` item is
    // the oldest row in the fetched window. Dropping the tail preserves the
    // requested page slice, and the next cursor should point at the oldest row
    // that remains in this page.
    rows.pop();
  }

  const memberIds = listChannelMemberIdsForChannelIds(db, rows.map((row) => rowString(row, 'id')));
  const data = rows.map((row) => rowToChannel(row, memberIds.get(rowString(row, 'id')) ?? []));

  const tail = hasMore ? data[data.length - 1] : undefined;
  const nextCursor = tail?.createdAt && tail.id ? encodeCursor(tail.createdAt, tail.id) : undefined;

  return { data, hasMore, nextCursor };
}

export function listAllChannels(db: DbHandle, organizationId: string): Channel[] {
  const rows = db
    .prepare('SELECT * FROM channels WHERE organization_id = ? ORDER BY created_at DESC, id DESC')
    .all(organizationId) as Row[];

  const memberIds = listChannelMemberIdsForChannelIds(db, rows.map((row) => rowString(row, 'id')));
  return rows.map((row) => rowToChannel(row, memberIds.get(rowString(row, 'id')) ?? []));
}

export function setChannelMembers(db: DbHandle, channelId: string, memberIds: string[]): void {
  replaceMemberLinks(db, 'channel_members', 'channel_id', channelId, memberIds);
  for (const threadId of listThreadIdsForChannel(db, channelId)) {
    replaceMemberLinks(db, 'thread_members', 'thread_id', threadId, memberIds);
  }
}

export function listChannelMemberIds(db: DbHandle, channelId: string): string[] {
  return listChannelMemberIdsForChannelIds(db, [channelId]).get(channelId) ?? [];
}

function listChannelMemberIdsForChannelIds(
  db: DbHandle,
  channelIds: string[],
): Map<string, string[]> {
  if (channelIds.length === 0) return new Map();
  const placeholders = channelIds.map(() => '?').join(', ');
  const membersByChannelId = new Map(channelIds.map((id) => [id, new Set<string>()]));

  const rows = db
    .prepare(
      `SELECT channel_id, member_id
         FROM channel_members
        WHERE channel_id IN (${placeholders})
       UNION
       SELECT
         CASE
           WHEN t.channel_id IN (${placeholders}) THEN t.channel_id
           ELSE t.id
         END AS channel_id,
         tm.member_id
         FROM thread_members tm
         JOIN threads t ON t.id = tm.thread_id
        WHERE t.channel_id IN (${placeholders}) OR t.id IN (${placeholders})`,
    )
    .all(...channelIds, ...channelIds, ...channelIds, ...channelIds) as {
      channel_id: string;
      member_id: string;
    }[];

  for (const row of rows) {
    membersByChannelId.get(row.channel_id)?.add(row.member_id);
  }

  return new Map(
    [...membersByChannelId.entries()].map(([channelId, memberIds]) => [
      channelId,
      [...memberIds].sort(),
    ]),
  );
}

export function deleteChannel(db: DbHandle, channelId: string): void {
  db.prepare('DELETE FROM channel_members WHERE channel_id = ?').run(channelId);
  db.prepare('DELETE FROM channel_member_modes WHERE channel_id = ?').run(channelId);
  db.prepare('DELETE FROM channels WHERE id = ?').run(channelId);
}

// -----------------------------------------------------------------------
// Channel member modes (active / passive / muted / temp_disable)
// -----------------------------------------------------------------------

export function setChannelMemberMode(
  db: DbHandle,
  channelId: string,
  memberId: string,
  mode: ChannelMemberMode,
): void {
  const timestamp = now();
  db.prepare(
    `INSERT INTO channel_member_modes (channel_id, member_id, mode, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(channel_id, member_id) DO UPDATE SET
       mode = excluded.mode,
       updated_at = excluded.updated_at`,
  ).run(channelId, memberId, mode, timestamp);
}

export function getChannelMemberMode(
  db: DbHandle,
  channelId: string,
  memberId: string,
): ChannelMemberMode | null {
  const row = db
    .prepare('SELECT mode FROM channel_member_modes WHERE channel_id = ? AND member_id = ?')
    .get(channelId, memberId) as { mode: string } | null;
  return row?.mode as ChannelMemberMode | null;
}

export function listChannelMemberModes(db: DbHandle, memberId: string): ChannelMemberSettings[] {
  const rows = db
    .prepare('SELECT channel_id, member_id, mode, updated_at FROM channel_member_modes WHERE member_id = ?')
    .all(memberId) as { channel_id: string; member_id: string; mode: string; updated_at: string }[];

  return rows.map((row) => ({
    channelId: row.channel_id,
    memberId: row.member_id,
    mode: row.mode as ChannelMemberMode,
    updatedAt: row.updated_at,
  }));
}

export function listChannelMemberModesForChannel(
  db: DbHandle,
  channelId: string,
): ChannelMemberSettings[] {
  const rows = db
    .prepare('SELECT channel_id, member_id, mode, updated_at FROM channel_member_modes WHERE channel_id = ?')
    .all(channelId) as { channel_id: string; member_id: string; mode: string; updated_at: string }[];

  return rows.map((row) => ({
    channelId: row.channel_id,
    memberId: row.member_id,
    mode: row.mode as ChannelMemberMode,
    updatedAt: row.updated_at,
  }));
}

export function removeChannelMemberMode(db: DbHandle, channelId: string, memberId: string): void {
  db.prepare('DELETE FROM channel_member_modes WHERE channel_id = ? AND member_id = ?').run(channelId, memberId);
}
