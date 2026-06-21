import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { MemoryEntrySchema, type MemoryEntry, type MemoryEntryKind } from '@ujima/shared';
import { rowString, optionalRowString } from './common.js';
import { upsertMemoryEntry as writeMemoryEntry } from './memory-entries.js';

type Row = Record<string, unknown>;
const ORG_SCOPE_MEMBER_SENTINEL = '__org__';

function normalizeMemberId(memberId: string | null | undefined): string | undefined {
  if (!memberId || memberId === ORG_SCOPE_MEMBER_SENTINEL) return undefined;
  return memberId;
}

function rowToMemoryEntry(row: Row): MemoryEntry {
  const id = rowString(row, 'id');
  return MemoryEntrySchema.parse({
    id,
    organizationId: rowString(row, 'organization_id'),
    memberId: normalizeMemberId(optionalRowString(row, 'member_id')),
    kind: rowString(row, 'kind') as MemoryEntryKind,
    key: optionalRowString(row, 'key') ?? id,
    content: rowString(row, 'content'),
    metadata: parseMetadata(row.metadata),
    expiresAt: optionalRowString(row, 'expires_at'),
    sourceMessageId: optionalRowString(row, 'source_message_id'),
    lastRecalledAt: optionalRowString(row, 'last_recalled_at'),
    createdAt: rowString(row, 'created_at'),
  });
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value.length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

export async function saveMemory(db: DbHandle, entry: MemoryEntry): Promise<MemoryEntry> {
  return await writeMemoryEntry(db, entry);
}

export function getMemory(db: DbHandle, organizationId: string, memoryId: string): MemoryEntry | null {
  const row = db
    .prepare('SELECT * FROM memory_entries WHERE id = ? AND organization_id = ?')
    .get(memoryId, organizationId) as Row | null;
  return row ? rowToMemoryEntry(row) : null;
}

export function listMemories(db: DbHandle, organizationId: string, memberId: string): MemoryEntry[] {
  const rows = db
    .prepare(
      'SELECT * FROM memory_entries WHERE organization_id = ? AND member_id = ? ORDER BY created_at DESC',
    )
    .all(organizationId, memberId) as Row[];
  return rows.map(rowToMemoryEntry);
}

export function listOrgMemories(db: DbHandle, organizationId: string): MemoryEntry[] {
  const rows = db
    .prepare('SELECT * FROM memory_entries WHERE organization_id = ? ORDER BY created_at DESC')
    .all(organizationId) as Row[];
  return rows.map(rowToMemoryEntry);
}

export async function deleteMemory(db: DbHandle, organizationId: string, memoryId: string): Promise<void> {
  db.prepare('DELETE FROM memory_entries WHERE id = ? AND organization_id = ?').run(
    memoryId,
    organizationId,
  );
}
