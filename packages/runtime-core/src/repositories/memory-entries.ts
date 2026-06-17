import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { MemoryEntrySchema, type MemoryEntry, type MemoryEntryKind } from '@ujima/shared';
import { optionalRowString, rowString } from './common.js';
import {
  deleteChromaMemory,
  getChromaMemoriesByMetadata,
  queryChromaMemories,
  upsertChromaMemory,
} from './chroma.js';

type Row = Record<string, unknown>;

/**
 * Sentinel value stored for `memory_entries.member_id` when a write is
 * org-scoped (`memberId === undefined` in the public API). SQLite
 * treats NULL as distinct in unique indexes, so without a sentinel
 * two org-scoped writes to the same key would create duplicate rows
 * instead of upserting the existing one. The sentinel restores the
 * documented "one key, one value" contract. Internal-only — readers
 * coalesce it back to `undefined` before returning to callers.
 */
const ORG_SCOPE_MEMBER_SENTINEL = '__org__';

function toStoredMemberId(memberId: string | null | undefined): string {
  return memberId === undefined || memberId === null || memberId === ORG_SCOPE_MEMBER_SENTINEL
    ? ORG_SCOPE_MEMBER_SENTINEL
    : memberId;
}

function fromStoredMemberId(stored: string | null | undefined): string | undefined {
  if (!stored) return undefined;
  return stored === ORG_SCOPE_MEMBER_SENTINEL ? undefined : stored;
}

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
    memberId: fromStoredMemberId(optionalRowString(row, 'member_id')),
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
export async function upsertMemoryEntry(db: DbHandle, entry: MemoryEntry): Promise<MemoryEntry> {
  const payload = MemoryEntrySchema.parse(entry);
  await upsertChromaMemory(payload);
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
    toStoredMemberId(payload.memberId),
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
 * Recall memory entries for an agent. Chroma selects candidate ids;
 * SQLite stores row metadata and content. Excludes expired entries.
 * Touches `last_recalled_at` on read so the surface order in the next
 * wake reflects what the agent uses.
 */
export async function recallMemoryEntries(
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
): Promise<MemoryEntry[]> {
  const now = new Date().toISOString();
  const limit = input.limit ?? 20;

  const matchedIds = input.query
    ? await queryChromaMemories(
        input.organizationId,
        input.memberId,
        input.query,
        limit,
        input.kind,
      )
    : await getChromaMemoriesByMetadata(input.organizationId, input.memberId, limit, input.kind);
  const entries = matchedIds
    .map((id) =>
      db
        .prepare('SELECT * FROM memory_entries WHERE id = ? AND organization_id = ?')
        .get(id, input.organizationId) as Row | null,
    )
    .filter((row): row is Row => row !== null)
    .map(rowToMemoryEntry)
    .filter(
      (entry) =>
        (!entry.expiresAt || entry.expiresAt > now) &&
        (!input.keyPrefix || entry.key.startsWith(input.keyPrefix)),
    )
    .sort(
      (left, right) =>
        Date.parse(right.lastRecalledAt ?? right.createdAt) -
        Date.parse(left.lastRecalledAt ?? left.createdAt),
    )
    .slice(0, limit);
  if (input.touch && entries.length > 0) {
    const stmt = db.prepare('UPDATE memory_entries SET last_recalled_at = ? WHERE id = ?');
    for (const e of entries) stmt.run(now, e.id);
  }
  return entries;
}

/**
 * Drop expired memory entries. Best-effort, no return value beyond the count.
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

export async function deleteMemoryEntry(
  db: DbHandle,
  organizationId: string,
  memberId: string | null,
  key: string,
): Promise<boolean> {
  await deleteChromaMemory(organizationId, memberId, key);
  const stored = toStoredMemberId(memberId);
  const result = db
    .prepare(
      `DELETE FROM memory_entries
        WHERE organization_id = ?
          AND member_id = ?
          AND key = ?`,
    )
    .run(organizationId, stored, key);
  return (result.changes ?? 0) > 0;
}
