import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { WorkspaceFileSchema, type WorkspaceFile } from '@ujima/shared';
import { optionalRowString, rowString } from './common.js';

type Row = Record<string, unknown>;

/** Per-org cap on indexed workspace bytes. Above this, oldest rows evict. */
const PER_ORG_BYTE_CAP_DEFAULT = 50 * 1024 * 1024;
/** Per-file body cap. Larger files are tracked by path only with truncated body. */
const PER_FILE_BYTE_CAP_DEFAULT = 100 * 1024;

// Kept for future read-by-path API; intentionally retained behind
// an underscore alias so the rest of the file can use the same row
// shape without rewriting the column mapping later.
function _rowToWorkspaceFile(row: Row): WorkspaceFile {
  const sizeBytesRaw = row['size_bytes'];
  const sizeBytes =
    typeof sizeBytesRaw === 'number'
      ? sizeBytesRaw
      : typeof sizeBytesRaw === 'string'
        ? Number.parseInt(sizeBytesRaw, 10) || 0
        : 0;
  return WorkspaceFileSchema.parse({
    organizationId: rowString(row, 'organization_id'),
    path: rowString(row, 'path'),
    body: rowString(row, 'body'),
    writtenBy: rowString(row, 'written_by'),
    channelId: optionalRowString(row, 'channel_id'),
    sizeBytes,
    updatedAt: rowString(row, 'updated_at'),
  });
}

/**
 * Upsert an indexed workspace file. Bodies larger than `perFileByteCap`
 * are truncated for FTS purposes — the agent always sees the truncated
 * snippet via `channel.recall`, full reads still go through the
 * filesystem `view` tool. Eviction of the oldest rows keeps the per-
 * org footprint bounded; this is best-effort recall, not a system of
 * record.
 */
export function upsertWorkspaceFile(
  db: DbHandle,
  input: WorkspaceFile,
  caps: { perOrgByteCap?: number; perFileByteCap?: number } = {},
): WorkspaceFile {
  const perOrgCap = caps.perOrgByteCap ?? PER_ORG_BYTE_CAP_DEFAULT;
  const perFileCap = caps.perFileByteCap ?? PER_FILE_BYTE_CAP_DEFAULT;
  const truncatedBody =
    input.body.length > perFileCap ? input.body.slice(0, perFileCap) : input.body;
  const payload = WorkspaceFileSchema.parse({
    ...input,
    body: truncatedBody,
    sizeBytes: input.body.length,
  });

  db.prepare(
    `INSERT INTO workspace_files (
       organization_id, path, body, written_by, channel_id, size_bytes, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(organization_id, path) DO UPDATE SET
       body = excluded.body,
       written_by = excluded.written_by,
       channel_id = excluded.channel_id,
       size_bytes = excluded.size_bytes,
       updated_at = excluded.updated_at`,
  ).run(
    payload.organizationId,
    payload.path,
    payload.body,
    payload.writtenBy,
    payload.channelId ?? null,
    payload.sizeBytes,
    payload.updatedAt,
  );

  // Eviction sweep — drop oldest rows until under cap. Best-effort.
  const totalRow = db
    .prepare(`SELECT COALESCE(SUM(LENGTH(body)), 0) AS total FROM workspace_files WHERE organization_id = ?`)
    .get(payload.organizationId) as { total: number } | undefined;
  const total = totalRow?.total ?? 0;
  if (total > perOrgCap) {
    db.prepare(
      `DELETE FROM workspace_files
        WHERE organization_id = ?
          AND rowid IN (
            SELECT rowid FROM workspace_files
              WHERE organization_id = ?
              ORDER BY updated_at ASC
              LIMIT 10
          )`,
    ).run(payload.organizationId, payload.organizationId);
  }
  return payload;
}

export function deleteWorkspaceFile(
  db: DbHandle,
  organizationId: string,
  path: string,
): boolean {
  const result = db
    .prepare(`DELETE FROM workspace_files WHERE organization_id = ? AND path = ?`)
    .run(organizationId, path);
  return (result.changes ?? 0) > 0;
}

/**
 * Recent-artifacts projection — returns the most-recently-written
 * workspace files in this org. Used by the `<workspace-state>`
 * block to surface file paths the agent (or anyone on the team)
 * wrote in the last lookback window, so wakes don't have to
 * re-derive what was just produced. Bounded by limit + sinceIso.
 */
export interface RecentWorkspaceArtifact {
  path: string;
  writtenBy: string;
  channelId?: string;
  updatedAt: string;
  sizeBytes: number;
}

export function listRecentWorkspaceArtifacts(
  db: DbHandle,
  input: {
    organizationId: string;
    sinceIso?: string;
    memberId?: string;
    channelId?: string;
    limit?: number;
  },
): RecentWorkspaceArtifact[] {
  const limit = input.limit ?? 6;
  const params: (string | number)[] = [input.organizationId];
  let sql =
    'SELECT path, written_by, channel_id, updated_at, size_bytes FROM workspace_files WHERE organization_id = ?';
  if (input.sinceIso) {
    sql += ' AND updated_at >= ?';
    params.push(input.sinceIso);
  }
  if (input.memberId) {
    sql += ' AND written_by = ?';
    params.push(input.memberId);
  }
  if (input.channelId) {
    sql += ' AND channel_id = ?';
    params.push(input.channelId);
  }
  sql += ' ORDER BY updated_at DESC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as Row[];
  return rows.map((row) => {
    const sizeRaw = row['size_bytes'];
    const sizeBytes =
      typeof sizeRaw === 'number'
        ? sizeRaw
        : typeof sizeRaw === 'string'
          ? Number.parseInt(sizeRaw, 10) || 0
          : 0;
    return {
      path: rowString(row, 'path'),
      writtenBy: rowString(row, 'written_by'),
      channelId: optionalRowString(row, 'channel_id'),
      updatedAt: rowString(row, 'updated_at'),
      sizeBytes,
    };
  });
}

/**
 * Search workspace files by FTS5 BM25 ranking. Returns top-N matches
 * scoped to the given organization. Caller is responsible for filtering
 * by member visibility (which agents may not see all files in
 * future privacy modes).
 */
export interface WorkspaceFileSearchHit {
  path: string;
  snippet: string;
  rank: number;
  writtenBy: string;
  channelId?: string;
  updatedAt: string;
}

export function searchWorkspaceFiles(
  db: DbHandle,
  input: { organizationId: string; query: string; limit?: number; sinceIso?: string },
): WorkspaceFileSearchHit[] {
  const limit = input.limit ?? 5;
  // FTS5 syntax: callers pass natural-language queries; we MATCH on
  // the body+path index. Escape double-quotes; multi-word queries
  // become AND by default in FTS5.
  const ftsQuery = sanitizeFtsQuery(input.query);
  if (!ftsQuery) return [];
  const params: (string | number)[] = [input.organizationId, ftsQuery];
  let sql = `
    SELECT f.path, f.written_by, f.channel_id, f.updated_at,
           snippet(workspace_files_fts, 1, '<<', '>>', '...', 24) AS snippet,
           bm25(workspace_files_fts) AS rank
      FROM workspace_files_fts
      JOIN workspace_files f ON f.rowid = workspace_files_fts.rowid
     WHERE f.organization_id = ?
       AND workspace_files_fts MATCH ?
  `;
  if (input.sinceIso) {
    sql += ' AND f.updated_at >= ?';
    params.push(input.sinceIso);
  }
  sql += ' ORDER BY rank LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as Row[];
  return rows.map((row) => ({
    path: rowString(row, 'path'),
    snippet: rowString(row, 'snippet'),
    rank: Number(row['rank'] ?? 0),
    writtenBy: rowString(row, 'written_by'),
    channelId: optionalRowString(row, 'channel_id'),
    updatedAt: rowString(row, 'updated_at'),
  }));
}

/**
 * Escape an FTS5 query: strip control chars, wrap multi-word tokens
 * in quotes so punctuation doesn't trigger FTS5's tokenizer rules.
 * Empty result means no usable query — caller should short-circuit.
 */
function sanitizeFtsQuery(input: string): string | null {
  const cleaned = input
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, ' ')
    .replace(/"/g, '')
    .trim();
  if (cleaned.length === 0) return null;
  // Tokens: alphanumeric runs of length ≥ 2; quote each so FTS5
  // doesn't choke on the colons / slashes / dots that appear in
  // paths and URLs.
  const tokens = cleaned
    .split(/[^A-Za-z0-9_]+/)
    .filter((t) => t.length >= 2)
    .map((t) => `"${t}"`);
  if (tokens.length === 0) return null;
  return tokens.join(' ');
}
