import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { DecisionLogEntrySchema, type DecisionLogEntry } from '@ujima/shared';
import { optionalRowString, rowString } from './common.js';

type Row = Record<string, unknown>;

function rowToDecisionLogEntry(row: Row): DecisionLogEntry {
  return DecisionLogEntrySchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    channelId: rowString(row, 'channel_id'),
    decidedAt: rowString(row, 'decided_at'),
    decidedBy: rowString(row, 'decided_by'),
    decisionText: rowString(row, 'decision_text'),
    sourceMessageId: rowString(row, 'source_message_id'),
    supersedesId: optionalRowString(row, 'supersedes_id'),
    createdAt: rowString(row, 'created_at'),
  });
}

/**
 * Append-only decision log insert. There is no update path — once a
 * decision is logged it stays logged. To "revise" a decision, insert
 * a new row with `supersedesId` pointing at the old one. Read paths
 * filter out superseded entries by default.
 */
export function appendDecisionLogEntry(
  db: DbHandle,
  entry: DecisionLogEntry,
): DecisionLogEntry {
  const payload = DecisionLogEntrySchema.parse(entry);
  // Post-review fix — uniqueness is enforced at the SCHEMA level by
  // migration 031's unique index on (organization_id,
  // source_message_id). The previous `INSERT OR IGNORE` keyed on the
  // UUID primary key didn't deduplicate because every call generated
  // a fresh UUID, so a replayed publish could insert twice before
  // the `findDecisionBySourceMessage` pre-check raced to catch it.
  // Now the database itself rejects the second insert.
  db.prepare(
    `INSERT INTO decision_log (
       id, organization_id, channel_id, decided_at, decided_by,
       decision_text, source_message_id, supersedes_id, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(organization_id, source_message_id) DO NOTHING`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.channelId,
    payload.decidedAt,
    payload.decidedBy,
    payload.decisionText,
    payload.sourceMessageId,
    payload.supersedesId ?? null,
    payload.createdAt,
  );
  return payload;
}

/**
 * List recent decisions for a channel, excluding superseded entries.
 * Surfaced into the `<workspace-state>` block at wake time so the
 * model never has to re-derive a load-bearing decision after L1
 * compaction. Newest first.
 */
export function listDecisionLogForChannel(
  db: DbHandle,
  organizationId: string,
  channelId: string,
  limit = 10,
): DecisionLogEntry[] {
  const rows = db
    .prepare(
      `SELECT d.* FROM decision_log d
        WHERE d.organization_id = ?
          AND d.channel_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM decision_log d2
             WHERE d2.organization_id = d.organization_id
               AND d2.supersedes_id = d.id
          )
        ORDER BY d.decided_at DESC
        LIMIT ?`,
    )
    .all(organizationId, channelId, limit) as Row[];
  return rows.map(rowToDecisionLogEntry);
}

/**
 * Find a decision by its source message id — used by the extractor
 * to avoid double-logging the same line on a re-summarization pass.
 */
export function findDecisionBySourceMessage(
  db: DbHandle,
  organizationId: string,
  sourceMessageId: string,
): DecisionLogEntry | null {
  const row = db
    .prepare(
      `SELECT * FROM decision_log
        WHERE organization_id = ?
          AND source_message_id = ?
        ORDER BY decided_at DESC
        LIMIT 1`,
    )
    .get(organizationId, sourceMessageId) as Row | null;
  return row ? rowToDecisionLogEntry(row) : null;
}
