import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { MemoryEntrySchema, type MemoryEntry, type MemoryKind } from '@ujima/shared';
import { now, rowString, optionalRowString } from './common.js';

type Row = Record<string, unknown>;

function rowToMemoryEntry(row: Row): MemoryEntry {
  return MemoryEntrySchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    memberId: optionalRowString(row, 'member_id') ?? null,
    kind: rowString(row, 'kind') as MemoryKind,
    content: rowString(row, 'content'),
    metadata: parseMetadata(row.metadata),
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

export function saveMemory(db: DbHandle, entry: MemoryEntry): MemoryEntry {
  const timestamp = now();
  const payload = MemoryEntrySchema.parse(entry);
  const metadataStr = JSON.stringify(payload.metadata || {});

  db.prepare(
    `INSERT INTO memory_entries (
      id, organization_id, member_id, kind, content, metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      organization_id = excluded.organization_id,
      member_id = excluded.member_id,
      kind = excluded.kind,
      content = excluded.content,
      metadata = excluded.metadata`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.memberId ?? null,
    payload.kind,
    payload.content,
    metadataStr,
    payload.createdAt ?? timestamp,
  );

  return payload;
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

export function deleteMemory(db: DbHandle, organizationId: string, memoryId: string): void {
  db.prepare('DELETE FROM memory_entries WHERE id = ? AND organization_id = ?').run(
    memoryId,
    organizationId,
  );
}
