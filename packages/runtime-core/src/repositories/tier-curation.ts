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
