import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '@ujima/context-store';
import { Repository } from '@ujima/runtime-core';
import { createScheduledJobRecord } from '@ujima/orchestrator';
import { ScheduledJobSchema } from '@ujima/shared';

describe('heartbeat repository', () => {
  const organizationId = 'org-1';
  const memberId = 'member-1';
  const channelId = 'general';

  let repo: Repository;

  beforeEach(() => {
    repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  });

  function heartbeatRecord(overrides: Record<string, unknown> = {}) {
    return createScheduledJobRecord({
      organizationId,
      memberId,
      name: 'Daily check',
      cronExpression: '0 9 * * *',
      prompt: 'Check in',
      channelId,
      type: 'heartbeat',
      ...overrides,
    });
  }

  it('creates and retrieves a heartbeat job', () => {
    const job = heartbeatRecord();
    repo.saveScheduledJob(job);

    const saved = repo.getScheduledJob(organizationId, job.id);
    expect(saved).not.toBeNull();
    expect(saved?.type).toBe('heartbeat');
    expect(saved?.channelId).toBe(channelId);
  });

  it('lists only heartbeat jobs', () => {
    const hb = heartbeatRecord();
    repo.saveScheduledJob(hb);

    const schedule = createScheduledJobRecord({
      organizationId,
      memberId,
      name: 'Daily schedule',
      cronExpression: '0 9 * * *',
      prompt: 'Regular schedule',
      channelId,
    });
    repo.saveScheduledJob(schedule);

    const all = repo.listScheduledJobs(organizationId);
    const heartbeats = all.filter((job) => job.type === 'heartbeat');
    expect(heartbeats).toHaveLength(1);
    expect(heartbeats[0]?.id).toBe(hb.id);
  });

  it('updates a heartbeat job', () => {
    const job = heartbeatRecord();
    repo.saveScheduledJob(job);

    const updated = ScheduledJobSchema.parse({
      ...job,
      status: 'paused' as const,
      updatedAt: new Date().toISOString(),
    });
    repo.saveScheduledJob(updated);

    const saved = repo.getScheduledJob(organizationId, job.id);
    expect(saved?.status).toBe('paused');
    expect(saved?.type).toBe('heartbeat');
  });

  it('deletes a heartbeat job', () => {
    const job = heartbeatRecord();
    repo.saveScheduledJob(job);

    repo.deleteScheduledJob(organizationId, job.id);

    const saved = repo.getScheduledJob(organizationId, job.id);
    expect(saved).toBeNull();
  });

  it('preserves type through persistence round-trip', () => {
    const job = heartbeatRecord();
    repo.saveScheduledJob(job);

    const saved = repo.getScheduledJob(organizationId, job.id);
    expect(saved).not.toBeNull();
    expect(saved!.type).toBe('heartbeat');

    // Verify a regular schedule defaults to 'schedule'
    const sched = createScheduledJobRecord({
      organizationId,
      memberId,
      name: 'Regular',
      cronExpression: '0 9 * * *',
      prompt: 'Regular',
      channelId,
    });
    repo.saveScheduledJob(sched);
    const savedSched = repo.getScheduledJob(organizationId, sched.id);
    expect(savedSched?.type).toBe('schedule');
  });
});
