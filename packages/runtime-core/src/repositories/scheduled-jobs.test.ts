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

  it('lists scheduled jobs for an organization', () => {
    repo.saveScheduledJob(baseJob({ id: 'j1', name: 'A', cronExpression: '* * * * *', prompt: 'a' }));
    repo.saveScheduledJob(baseJob({ id: 'j2', name: 'B', cronExpression: '* * * * *', prompt: 'b' }));
    expect(repo.listScheduledJobs(organizationId)).toHaveLength(2);
  });

  it('updates a scheduled job on save', () => {
    repo.saveScheduledJob(baseJob({ id: 'u1', name: 'Old', cronExpression: '0 9 * * *', prompt: 'old' }));
    repo.saveScheduledJob(
      baseJob({
        id: 'u1',
        name: 'New',
        cronExpression: '0 10 * * *',
        prompt: 'new',
        updatedAt: new Date().toISOString(),
      }),
    );
    const stored = repo.getScheduledJob(organizationId, 'u1');
    expect(stored?.name).toBe('New');
    expect(stored?.cronExpression).toBe('0 10 * * *');
  });

  it('deletes a scheduled job', () => {
    repo.saveScheduledJob(baseJob({ id: 'd1', name: 'Del', cronExpression: '* * * * *', prompt: 'del' }));
    repo.deleteScheduledJob(organizationId, 'd1');
    expect(repo.getScheduledJob(organizationId, 'd1')).toBeNull();
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

  it('tracks run count and lastError', () => {
    repo.saveScheduledJob(baseJob({ id: 'stats', name: 'Stats', cronExpression: '* * * * *', prompt: 'stats' }));
    repo.saveScheduledJob(
      baseJob({
        id: 'stats',
        name: 'Stats',
        cronExpression: '* * * * *',
        prompt: 'stats',
        runCount: 5,
        lastRunAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );
    expect(repo.getScheduledJob(organizationId, 'stats')?.runCount).toBe(5);
    repo.saveScheduledJob(
      baseJob({
        id: 'stats',
        name: 'Stats',
        cronExpression: '* * * * *',
        prompt: 'stats',
        runCount: 5,
        lastError: 'error!',
        updatedAt: new Date().toISOString(),
      }),
    );
    expect(repo.getScheduledJob(organizationId, 'stats')?.lastError).toBe('error!');
  });
});
