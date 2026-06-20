import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { SelfImprovementReviewSchema } from '@ujima/shared';
import { openDatabase } from '@ujima/context-store';
import { Repository } from './index.js';

describe('self-improvement reviews repository', () => {
  let repo: Repository;
  const organizationId = randomUUID();
  const runId = randomUUID();
  const memberId = randomUUID();
  const now = new Date().toISOString();

  beforeEach(() => {
    repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  });

  function baseReview(overrides: Record<string, unknown> = {}) {
    return SelfImprovementReviewSchema.parse({
      id: randomUUID(),
      organizationId,
      runId,
      memberId,
      triggerType: 'post_turn' as const,
      summary: 'Reviewed code quality and updated linting rules.',
      memoryWrites: 2,
      procedureWrites: 1,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  }

  it('creates and retrieves a review', () => {
    const review = baseReview({ id: 'review-1' });
    repo.saveSelfImprovementReview(review);
    const stored = repo.getSelfImprovementReview(organizationId, 'review-1');
    expect(stored).not.toBeNull();
    expect(stored?.summary).toBe('Reviewed code quality and updated linting rules.');
    expect(stored?.memoryWrites).toBe(2);
    expect(stored?.procedureWrites).toBe(1);
    expect(stored?.triggerType).toBe('post_turn');
  });

  it('returns null for a non-existent review', () => {
    const stored = repo.getSelfImprovementReview(organizationId, 'nonexistent');
    expect(stored).toBeNull();
  });

  it('lists reviews most recent first', () => {
    const older = baseReview({ id: 'review-old', createdAt: new Date(Date.now() - 10_000).toISOString() });
    const newer = baseReview({ id: 'review-new', createdAt: new Date(Date.now() - 1_000).toISOString() });
    repo.saveSelfImprovementReview(older);
    repo.saveSelfImprovementReview(newer);

    const reviews = repo.listSelfImprovementReviews(organizationId);
    expect(reviews.length).toBeGreaterThanOrEqual(2);
    const ids = reviews.map((r) => r.id);
    expect(ids.indexOf('review-new')).toBeLessThan(ids.indexOf('review-old'));
  });

  it('lists reviews with a limit', () => {
    for (let i = 0; i < 5; i++) {
      repo.saveSelfImprovementReview(baseReview({ id: `review-limit-${i}` }));
    }
    const limited = repo.listSelfImprovementReviews(organizationId, 2);
    expect(limited.length).toBe(2);
  });

  it('lists reviews by run ID', () => {
    const runA = baseReview({ id: 'review-run-a', runId: 'run-a' });
    const runB = baseReview({ id: 'review-run-b', runId: 'run-b' });
    repo.saveSelfImprovementReview(runA);
    repo.saveSelfImprovementReview(runB);

    const reviews = repo.listSelfImprovementReviewsByRun(organizationId, 'run-a');
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.id).toBe('review-run-a');
  });

  it('upserts on duplicate ID', () => {
    const review = baseReview({ id: 'review-upsert', summary: 'Original' });
    repo.saveSelfImprovementReview(review);

    const updated = baseReview({
      id: 'review-upsert',
      summary: 'Updated summary after second pass',
      memoryWrites: 5,
    });
    repo.saveSelfImprovementReview(updated);

    const stored = repo.getSelfImprovementReview(organizationId, 'review-upsert');
    expect(stored?.summary).toBe('Updated summary after second pass');
    expect(stored?.memoryWrites).toBe(5);
  });

  it('deletes a review', () => {
    const review = baseReview({ id: 'review-delete' });
    repo.saveSelfImprovementReview(review);
    expect(repo.getSelfImprovementReview(organizationId, 'review-delete')).not.toBeNull();

    repo.deleteSelfImprovementReview(organizationId, 'review-delete');
    expect(repo.getSelfImprovementReview(organizationId, 'review-delete')).toBeNull();
  });

  it('only deletes within the correct organization', () => {
    const otherOrg = randomUUID();
    const review = baseReview({ id: 'review-org-guard' });
    repo.saveSelfImprovementReview(review);

    repo.deleteSelfImprovementReview(otherOrg, 'review-org-guard');
    expect(repo.getSelfImprovementReview(organizationId, 'review-org-guard')).not.toBeNull();
  });

  it('accepts all trigger types', () => {
    for (const triggerType of ['heartbeat', 'post_turn', 'manual'] as const) {
      const review = baseReview({ id: `review-trigger-${triggerType}`, triggerType });
      repo.saveSelfImprovementReview(review);
      const stored = repo.getSelfImprovementReview(organizationId, `review-trigger-${triggerType}`);
      expect(stored?.triggerType).toBe(triggerType);
    }
  });

  it('stores zero values for memoryWrites and procedureWrites', () => {
    const review = baseReview({
      id: 'review-zero-writes',
      memoryWrites: 0,
      procedureWrites: 0,
    });
    repo.saveSelfImprovementReview(review);
    const stored = repo.getSelfImprovementReview(organizationId, 'review-zero-writes');
    expect(stored?.memoryWrites).toBe(0);
    expect(stored?.procedureWrites).toBe(0);
  });

  it('scopes list, get, and delete by organization', () => {
    const otherOrgId = randomUUID();
    const review = baseReview({ id: 'review-scope' });
    repo.saveSelfImprovementReview(review);

    expect(repo.listSelfImprovementReviews(otherOrgId)).toHaveLength(0);
    expect(repo.getSelfImprovementReview(otherOrgId, 'review-scope')).toBeNull();
  });
});
