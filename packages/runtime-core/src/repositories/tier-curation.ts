import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import {
  TierCurationSuggestionSchema,
  type TierCurationSuggestion,
} from '@ujima/shared';
import { optionalRowString, rowString } from './common.js';

type Row = Record<string, unknown>;

/**
 * Repository surface for the tier_curation_suggestions table
 * (mcp_connector_dispatch_plan.md §9.4 / PR 9).
 *
 * PR 8 ships the schema + the writer + the lister. The cron job that
 * actually produces suggestions lands in PR 9; until then the table
 * stays empty and the settings panel reads a zero-state.
 *
 * The UNIQUE (organization_id, member_id, mcp_server_id, direction,
 * status) constraint in migration 050 means a re-run of the analysis
 * job doesn't duplicate a pending suggestion — INSERT OR IGNORE
 * preserves the original `created_at`, which the panel may eventually
 * use to show "first surfaced N days ago".
 */

function rowToSuggestion(row: Row): TierCurationSuggestion {
  return TierCurationSuggestionSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    memberId: rowString(row, 'member_id'),
    mcpServerId: rowString(row, 'mcp_server_id'),
    direction: rowString(row, 'direction'),
    rationale: rowString(row, 'rationale'),
    signalMetadata:
      typeof row.signal_metadata === 'string' && row.signal_metadata.length > 0
        ? (JSON.parse(row.signal_metadata) as Record<string, unknown>)
        : {},
    status: rowString(row, 'status'),
    createdAt: rowString(row, 'created_at'),
    resolvedAt: optionalRowString(row, 'resolved_at'),
  });
}

export function saveTierCurationSuggestion(
  db: DbHandle,
  suggestion: TierCurationSuggestion,
): TierCurationSuggestion {
  const payload = TierCurationSuggestionSchema.parse(suggestion);
  db.prepare(
    `INSERT INTO tier_curation_suggestions
       (id, organization_id, member_id, mcp_server_id, direction, rationale,
        signal_metadata, status, created_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (organization_id, member_id, mcp_server_id, direction, status)
       DO NOTHING`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.memberId,
    payload.mcpServerId,
    payload.direction,
    payload.rationale,
    JSON.stringify(payload.signalMetadata),
    payload.status,
    payload.createdAt,
    payload.resolvedAt ?? null,
  );
  return payload;
}

export function listTierCurationSuggestions(
  db: DbHandle,
  organizationId: string,
): TierCurationSuggestion[] {
  const rows = db
    .prepare(
      `SELECT * FROM tier_curation_suggestions
       WHERE organization_id = ?
       ORDER BY created_at DESC`,
    )
    .all(organizationId) as Row[];
  return rows.map(rowToSuggestion);
}

/**
 * PR 9 — persist the operator's decision on a suggestion.
 *
 * The panel calls this from Apply / Dismiss so a refresh or page
 * reload doesn't resurface a candidate the operator has already
 * acted on.
 *
 * The UNIQUE constraint on (org, member, server, direction, status)
 * from migration 050 means we have to be careful with terminal
 * statuses: the apply-revert-reapply flow can race itself otherwise.
 *
 *   1. Analyzer writes pending row A → (org, m, s, demote, pending)
 *   2. Apply A → flips to (org, m, s, demote, applied)
 *   3. Operator manually reverts the tier
 *   4. Analyzer writes pending row B → (org, m, s, demote, pending)
 *   5. Apply B → tries to flip to (org, m, s, demote, applied)
 *      → conflicts with row A → UNIQUE violation, the Apply 500s
 *
 * So before flipping a row to a terminal status, delete any existing
 * terminal row for the same (org, member, server, direction). The
 * operator's most recent decision wins — older terminal rows are not
 * load-bearing (they have no UI surface; the audit trail
 * connector_tier_changed is the durable record). The two operations
 * run in a single transaction so a partial failure can't leave the
 * table in a "no terminal row" intermediate state.
 *
 * Returns the updated row, or null if no such row exists (missing
 * rows are silently skipped because a stale UI Apply on a deleted
 * org/suggestion shouldn't surface as a 500).
 */
export function updateTierCurationSuggestionStatus(
  db: DbHandle,
  organizationId: string,
  suggestionId: string,
  nextStatus: 'pending' | 'applied' | 'dismissed',
  resolvedAt: string,
): TierCurationSuggestion | null {
  const target = db
    .prepare(
      `SELECT * FROM tier_curation_suggestions
       WHERE organization_id = ? AND id = ?`,
    )
    .get(organizationId, suggestionId) as Row | undefined;
  if (!target) return null;

  const isTerminal = nextStatus === 'applied' || nextStatus === 'dismissed';
  const memberId = rowString(target, 'member_id');
  const mcpServerId = rowString(target, 'mcp_server_id');
  const direction = rowString(target, 'direction');

  // Single transaction so a crash between DELETE and UPDATE can't
  // leave the (org, member, server, direction) slot with neither a
  // terminal nor a pending row. Matches the BEGIN/COMMIT/ROLLBACK
  // pattern Repository.transaction uses — bun:sqlite + better-sqlite3
  // both queue per-statement, so awaiting inside the transaction
  // would either deadlock or silently commit out of order.
  db.exec('BEGIN');
  try {
    if (isTerminal) {
      db.prepare(
        `DELETE FROM tier_curation_suggestions
           WHERE organization_id = ?
             AND member_id = ?
             AND mcp_server_id = ?
             AND direction = ?
             AND id != ?
             AND (status = 'applied' OR status = 'dismissed')`,
      ).run(organizationId, memberId, mcpServerId, direction, suggestionId);
    }
    db.prepare(
      `UPDATE tier_curation_suggestions
         SET status = ?, resolved_at = ?
         WHERE organization_id = ? AND id = ?`,
    ).run(nextStatus, resolvedAt, organizationId, suggestionId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const row = db
    .prepare(
      `SELECT * FROM tier_curation_suggestions
       WHERE organization_id = ? AND id = ?`,
    )
    .get(organizationId, suggestionId) as Row | undefined;
  return row ? rowToSuggestion(row) : null;
}
