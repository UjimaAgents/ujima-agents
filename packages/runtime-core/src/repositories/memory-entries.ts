import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { MemoryEntrySchema, type MemoryEntry, type MemoryEntryKind } from '@ujima/shared';
import { optionalRowString, rowString } from './common.js';

type Row = Record<string, unknown>;

function rowToMemoryEntry(row: Row): MemoryEntry {
  const metadataRaw = optionalRowString(row, 'metadata');
  let metadata: Record<string, unknown> = {};
  if (metadataRaw) {
    try {
      const parsed = JSON.parse(metadataRaw);
      if (parsed && typeof parsed === 'object') metadata = parsed as Record<string, unknown>;
    } catch {
      // best-effort — malformed JSON in metadata stays {}
    }
  }
  return MemoryEntrySchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    memberId: optionalRowString(row, 'member_id'),
    kind: rowString(row, 'kind') as MemoryEntryKind,
    key: rowString(row, 'key'),
    content: rowString(row, 'content'),
    metadata,
    expiresAt: optionalRowString(row, 'expires_at'),
    sourceMessageId: optionalRowString(row, 'source_message_id'),
    lastRecalledAt: optionalRowString(row, 'last_recalled_at'),
    createdAt: rowString(row, 'created_at'),
  });
}

/**
 * Upsert a memory entry by (organization_id, member_id, key). Replaces
 * the existing row's content + metadata + expires_at when the key
 * already exists; otherwise inserts. The unique index from migration
 * 027 enforces one row per (org, member, key) tuple, so this is a
 * safe write path for the `memory.write` tool.
 */
export function upsertMemoryEntry(db: DbHandle, entry: MemoryEntry): MemoryEntry {
  const payload = MemoryEntrySchema.parse(entry);
  db.prepare(
    `INSERT INTO memory_entries (
       id, organization_id, member_id, kind, key, content, metadata,
       expires_at, source_message_id, last_recalled_at, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(organization_id, member_id, key)
     WHERE key IS NOT NULL
     DO UPDATE SET
       kind = excluded.kind,
       content = excluded.content,
       metadata = excluded.metadata,
       expires_at = excluded.expires_at,
       source_message_id = excluded.source_message_id,
       last_recalled_at = excluded.last_recalled_at`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.memberId ?? null,
    payload.kind,
    payload.key,
    payload.content,
    JSON.stringify(payload.metadata ?? {}),
    payload.expiresAt ?? null,
    payload.sourceMessageId ?? null,
    payload.lastRecalledAt ?? null,
    payload.createdAt,
  );
  return payload;
}

/**
 * Recall memory entries for an agent. `keyPrefix` does a prefix match
 * on the key; `query` runs a LIKE against content (cheap fallback for
 * non-FTS callers). Excludes expired entries. Ordered by
 * last_recalled_at DESC then created_at DESC so frequently-touched
 * memories stay hot. Touches `last_recalled_at` on read so the
 * surface order in the next wake reflects what the agent uses.
 */
export function recallMemoryEntries(
  db: DbHandle,
  input: {
    organizationId: string;
    memberId?: string;
    kind?: MemoryEntryKind;
    keyPrefix?: string;
    query?: string;
    limit?: number;
    touch?: boolean;
  },
): MemoryEntry[] {
  const now = new Date().toISOString();
  const limit = input.limit ?? 20;
  const params: (string | number)[] = [input.organizationId, now];
  let sql =
    'SELECT * FROM memory_entries WHERE organization_id = ? AND (expires_at IS NULL OR expires_at > ?) AND key IS NOT NULL';
  if (input.memberId !== undefined) {
    sql += ' AND (member_id = ? OR member_id IS NULL)';
    params.push(input.memberId);
  }
  if (input.kind) {
    sql += ' AND kind = ?';
    params.push(input.kind);
  }
  if (input.keyPrefix) {
    sql += ' AND key LIKE ?';
    params.push(`${input.keyPrefix}%`);
  }
  if (input.query) {
    sql += ' AND content LIKE ?';
    params.push(`%${input.query}%`);
  }
  sql += ` ORDER BY COALESCE(last_recalled_at, created_at) DESC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as Row[];
  const entries = rows.map(rowToMemoryEntry);

  if (input.touch && entries.length > 0) {
    const stmt = db.prepare('UPDATE memory_entries SET last_recalled_at = ? WHERE id = ?');
    for (const e of entries) stmt.run(now, e.id);
  }
  return entries;
}

/**
 * Drop expired memory entries. Called periodically by the same
 * sweeper that handles commitment expiry — best-effort, no return
 * value beyond the count.
 */
export function deleteExpiredMemoryEntries(db: DbHandle, nowIso: string): number {
  const result = db
    .prepare(
      `DELETE FROM memory_entries
        WHERE expires_at IS NOT NULL
          AND expires_at <= ?`,
    )
    .run(nowIso);
  return result.changes ?? 0;
}

export function deleteMemoryEntry(
  db: DbHandle,
  organizationId: string,
  memberId: string | null,
  key: string,
): boolean {
  const result = db
    .prepare(
      `DELETE FROM memory_entries
        WHERE organization_id = ?
          AND (member_id = ? OR (member_id IS NULL AND ? IS NULL))
          AND key = ?`,
    )
    .run(organizationId, memberId, memberId, key);
  return (result.changes ?? 0) > 0;
}
