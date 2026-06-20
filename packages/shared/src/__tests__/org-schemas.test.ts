import { describe, expect, it } from 'vitest';
import {
  ScheduledJobTypeSchema,
  SelfImprovementReviewSchema,
  SelfImprovementTriggerTypeSchema,
} from '../org-schemas.js';

describe('ScheduledJobTypeSchema', () => {
  it('accepts schedule', () => {
    expect(ScheduledJobTypeSchema.parse('schedule')).toBe('schedule');
  });

  it('accepts heartbeat', () => {
    expect(ScheduledJobTypeSchema.parse('heartbeat')).toBe('heartbeat');
  });

  it('accepts self_improvement', () => {
    expect(ScheduledJobTypeSchema.parse('self_improvement')).toBe('self_improvement');
  });

  it('rejects invalid types', () => {
    expect(() => ScheduledJobTypeSchema.parse('cron')).toThrow();
    expect(() => ScheduledJobTypeSchema.parse('')).toThrow();
    expect(() => ScheduledJobTypeSchema.parse(123)).toThrow();
  });
});

describe('SelfImprovementTriggerTypeSchema', () => {
  it('accepts heartbeat', () => {
    expect(SelfImprovementTriggerTypeSchema.parse('heartbeat')).toBe('heartbeat');
  });

  it('accepts post_turn', () => {
    expect(SelfImprovementTriggerTypeSchema.parse('post_turn')).toBe('post_turn');
  });

  it('accepts manual', () => {
    expect(SelfImprovementTriggerTypeSchema.parse('manual')).toBe('manual');
  });

  it('rejects invalid trigger types', () => {
    expect(() => SelfImprovementTriggerTypeSchema.parse('scheduled')).toThrow();
    expect(() => SelfImprovementTriggerTypeSchema.parse('auto')).toThrow();
  });
});

describe('SelfImprovementReviewSchema', () => {
  const validReview = {
    id: 'review-1',
    organizationId: 'org-1',
    runId: 'run-1',
    memberId: 'member-1',
    triggerType: 'post_turn',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('parses a valid review with defaults', () => {
    const result = SelfImprovementReviewSchema.parse(validReview);
    expect(result.summary).toBe('');
    expect(result.memoryWrites).toBe(0);
    expect(result.procedureWrites).toBe(0);
  });

  it('accepts overridden summary and writes', () => {
    const result = SelfImprovementReviewSchema.parse({
      ...validReview,
      summary: 'Reviewed code quality',
      memoryWrites: 3,
      procedureWrites: 2,
    });
    expect(result.summary).toBe('Reviewed code quality');
    expect(result.memoryWrites).toBe(3);
    expect(result.procedureWrites).toBe(2);
  });

  it('rejects negative write counts', () => {
    expect(() =>
      SelfImprovementReviewSchema.parse({
        ...validReview,
        memoryWrites: -1,
      }),
    ).toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => SelfImprovementReviewSchema.parse({})).toThrow();
    expect(() => SelfImprovementReviewSchema.parse({ id: 'r-1' })).toThrow();
  });

  it('rejects invalid triggerType', () => {
    expect(() =>
      SelfImprovementReviewSchema.parse({
        ...validReview,
        triggerType: 'invalid',
      }),
    ).toThrow();
  });

  it('rejects non-integer write counts', () => {
    expect(() =>
      SelfImprovementReviewSchema.parse({
        ...validReview,
        memoryWrites: 1.5,
      }),
    ).toThrow();
  });
});
