// Composite cursor helpers for time-ordered paginators.
//
// Paginators here all order by `<timestamp_col> DESC, id DESC`. A naive
// cursor of just the timestamp column drops rows that share the same
// millisecond as the page boundary — `created_at` is generated with
// `new Date().toISOString()`, so adjacent inserts in tight loops are very
// likely to collide. We need a composite cursor that pins both fields.
//
// Format: `${timestamp}|${id}` — the pipe is not present in ISO timestamps
// or generated UUIDs we hand out, so a single split is unambiguous. Keeping
// it human-readable (no base64) makes debugging dashboards easier.
//
// Backward compatibility: old cursors without the pipe are still parsed as
// timestamp-only. They keep the (buggy) old behaviour for one client cycle
// rather than 400'ing in flight; new responses always emit composite
// cursors so subsequent requests are correct.

export interface CursorParts {
  timestamp: string;
  /** Undefined for legacy single-column cursors only. */
  id: string | undefined;
}

const SEP = '|';

export function encodeCursor(timestamp: string, id: string): string {
  return `${timestamp}${SEP}${id}`;
}

export function decodeCursor(raw: string | undefined): CursorParts | undefined {
  if (!raw) return undefined;
  const idx = raw.indexOf(SEP);
  if (idx < 0) {
    // Legacy single-column cursor (just a timestamp). Honour for compat.
    return { timestamp: raw, id: undefined };
  }
  return { timestamp: raw.slice(0, idx), id: raw.slice(idx + 1) };
}

/**
 * Append a `WHERE` clause that walks a `<timestamp_col> DESC, id_col DESC`
 * stream past `cursor`. The clause is composite when both fields are
 * available, single-column when the cursor is a legacy timestamp.
 *
 * @returns the SQL fragment (no leading AND) and the params to push.
 */
export function cursorWhereClause(
  cursor: CursorParts,
  timestampCol: string,
  idCol: string,
): { sql: string; params: string[] } {
  if (cursor.id === undefined) {
    return { sql: `${timestampCol} < ?`, params: [cursor.timestamp] };
  }
  return {
    sql: `(${timestampCol} < ? OR (${timestampCol} = ? AND ${idCol} < ?))`,
    params: [cursor.timestamp, cursor.timestamp, cursor.id],
  };
}
