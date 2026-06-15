import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ScheduledJobSchema } from '@ujima/shared';
import { openDatabase } from '@ujima/context-store';
import { Repository } from './index.js';

describe('scheduled jobs repository', () => {
  let repo: Repository;
  const organizationId = randomUUID();
  const memberId = randomUUID();
  const now = new Date().toISOString();

  beforeEach(() => {
    repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  });

  function baseJob(overrides: Record<string, unknown> = {}) {
    return ScheduledJobSchema.parse({
      id: randomUUID(),
      organizationId,
      name: 'Standup',
      cronExpression: '0 9 * * 1-5',
      prompt: 'Time for standup!',
      channelId: 'general',
      memberId,
      status: 'active',
      runCount: 0,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  }

  it('creates and retrieves a scheduled job', () => {
    const job = baseJob({ id: 'job-1' });
    repo.saveScheduledJob(job);
    const stored = repo.getScheduledJob(organizationId, 'job-1');
    expect(stored?.name).toBe('Standup');
  });

  it('lists due jobs globally', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    repo.saveScheduledJob(
      baseJob({ id: 'due', name: 'Due', cronExpression: '* * * * *', prompt: 'due', nextRunAt: past }),
    );
    repo.saveScheduledJob(
      baseJob({
        id: 'not-due',
        name: 'Not',
        cronExpression: '0 0 1 1 0',
        prompt: 'not',
        nextRunAt: future,
      }),
    );
    repo.saveScheduledJob(
      baseJob({
        id: 'paused',
        name: 'Paused',
        cronExpression: '* * * * *',
        prompt: 'pause',
        status: 'paused',
        nextRunAt: past,
      }),
    );
    const due = repo.listDueJobsGlobally();
    expect(due.some((job) => job.id === 'due')).toBe(true);
    expect(due.some((job) => job.id === 'not-due')).toBe(false);
    expect(due.some((job) => job.id === 'paused')).toBe(false);
  });

});
