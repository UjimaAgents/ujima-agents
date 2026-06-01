import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';

type Row = Record<string, unknown>;

export function now(): string {
  return new Date().toISOString();
}

export function rowString(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') {
    throw new Error(`Expected string column "${key}"`);
  }
  return value;
}

export function optionalRowString(row: Row, key: string): string | undefined {
  const value = row[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function parseJsonObject(value: unknown): Record<string, string[]> {
  if (typeof value !== 'string' || value.length === 0) {
    return {};
  }
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, string[]>;
}

export function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || value.length === 0) {
    return [];
  }
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : [];
}

export function parseJsonArrayRaw(value: unknown): unknown[] {
  if (typeof value !== 'string' || value.length === 0) {
    return [];
  }
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Replace the channel_members rows for one tenant's channel. Scoping by
 * organization_id is required: post-migration 042 the channel id is only
 * unique inside an organization, so deleting by channel_id alone would wipe
 * another tenant's identically-named channel.
 */
export function replaceChannelMemberLinks(
  db: DbHandle,
  organizationId: string,
  channelId: string,
  memberIds: string[],
): void {
  const uniqueMemberIds = [...new Set(memberIds)].sort();
  db.prepare(
    'DELETE FROM channel_members WHERE organization_id = ? AND channel_id = ?',
  ).run(organizationId, channelId);
  const insert = db.prepare(
    'INSERT INTO channel_members (organization_id, channel_id, member_id) VALUES (?, ?, ?)',
  );
  for (const memberId of uniqueMemberIds) {
    insert.run(organizationId, channelId, memberId);
  }
}

/**
 * Replace the thread_members rows for a thread. Thread ids are still globally
 * unique (threads.id remains the sole primary key), so no organization scope
 * is required here — but callers must still resolve the thread id from a
 * tenant-scoped lookup before reaching this point.
 */
export function replaceThreadMemberLinks(
  db: DbHandle,
  threadId: string,
  memberIds: string[],
): void {
  const uniqueMemberIds = [...new Set(memberIds)].sort();
  db.prepare('DELETE FROM thread_members WHERE thread_id = ?').run(threadId);
  const insert = db.prepare(
    'INSERT INTO thread_members (thread_id, member_id) VALUES (?, ?)',
  );
  for (const memberId of uniqueMemberIds) {
    insert.run(threadId, memberId);
  }
}
