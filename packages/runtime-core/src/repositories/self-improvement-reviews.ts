import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import {
  SelfImprovementReviewSchema,
  type SelfImprovementReview,
} from '@ujima/shared';
import { now, rowString } from './common.js';

type Row = Record<string, unknown>;

function rowToReview(row: Row): SelfImprovementReview {
  return SelfImprovementReviewSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    runId: rowString(row, 'run_id'),
    memberId: rowString(row, 'member_id'),
    triggerType: rowString(row, 'trigger_type'),
    summary: rowString(row, 'summary') ?? '',
    memoryWrites: Number(row.memory_writes ?? 0),
    procedureWrites: Number(row.procedure_writes ?? 0),
    createdAt: rowString(row, 'created_at'),
    updatedAt: rowString(row, 'updated_at'),
  });
}

export function saveSelfImprovementReview(
  db: DbHandle,
  review: SelfImprovementReview,
): SelfImprovementReview {
  const timestamp = now();
  db.prepare(
    `INSERT INTO self_improvement_reviews (
      id, organization_id, run_id, member_id, trigger_type,
      summary, memory_writes, procedure_writes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      summary = excluded.summary,
      memory_writes = excluded.memory_writes,
      procedure_writes = excluded.procedure_writes,
      updated_at = excluded.updated_at`,
  ).run(
    review.id,
    review.organizationId,
    review.runId,
    review.memberId,
    review.triggerType,
    review.summary,
    review.memoryWrites,
    review.procedureWrites,
    review.createdAt ?? timestamp,
    timestamp,
  );
  return review;
}

export function listSelfImprovementReviews(
  db: DbHandle,
  organizationId: string,
  limit = 50,
): SelfImprovementReview[] {
  const rows = db
    .prepare(
      `SELECT * FROM self_improvement_reviews
       WHERE organization_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(organizationId, limit) as Row[];
  return rows.map(rowToReview);
}

export function getSelfImprovementReview(
  db: DbHandle,
  organizationId: string,
  reviewId: string,
): SelfImprovementReview | null {
  const row = db
    .prepare(
      'SELECT * FROM self_improvement_reviews WHERE id = ? AND organization_id = ?',
    )
    .get(reviewId, organizationId) as Row | undefined;
  return row ? rowToReview(row) : null;
}

export function listSelfImprovementReviewsByRun(
  db: DbHandle,
  organizationId: string,
  runId: string,
): SelfImprovementReview[] {
  const rows = db
    .prepare(
      `SELECT * FROM self_improvement_reviews
       WHERE organization_id = ? AND run_id = ?
       ORDER BY created_at DESC`,
    )
    .all(organizationId, runId) as Row[];
  return rows.map(rowToReview);
}

export function deleteSelfImprovementReview(
  db: DbHandle,
  organizationId: string,
  reviewId: string,
): void {
  db.prepare(
    'DELETE FROM self_improvement_reviews WHERE id = ? AND organization_id = ?',
  ).run(reviewId, organizationId);
}
