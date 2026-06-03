import { describe, expect, it, beforeEach } from 'vitest';
import { openDatabase } from '@ujima/context-store';

function createRepo() {
  const db = openDatabase({ dbPath: ':memory:' });
  return {
    save(job: Record<string, unknown>) {
      db.prepare(`INSERT INTO scheduled_jobs (id, organization_id, name, cron_expression, prompt, channel_id, member_id, status, last_run_at, next_run_at, run_count, last_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, cron_expression = excluded.cron_expression, prompt = excluded.prompt, channel_id = excluded.channel_id, status = excluded.status, last_run_at = excluded.last_run_at, next_run_at = excluded.next_run_at, run_count = excluded.run_count, last_error = excluded.last_error, updated_at = excluded.updated_at`).run(
        job.id, job.organizationId, job.name, job.cronExpression, job.prompt,
        job.channelId ?? null, job.memberId, job.status,
        job.lastRunAt ?? null, job.nextRunAt ?? null,
        job.runCount, job.lastError ?? null, job.createdAt, job.updatedAt,
      );
    },
    get(orgId: string, jobId: string) {
      const row = db.prepare('SELECT * FROM scheduled_jobs WHERE id = ? AND organization_id = ?').get(jobId, orgId);
      return (row ?? null) as Record<string, unknown> | null;
    },
    list(orgId: string) {
      return db.prepare('SELECT * FROM scheduled_jobs WHERE organization_id = ? ORDER BY created_at ASC').all(orgId) as Record<string, unknown>[];
    },
    del(orgId: string, jobId: string) {
      db.prepare('DELETE FROM scheduled_jobs WHERE id = ? AND organization_id = ?').run(jobId, orgId);
    },
    due() {
      const now = new Date().toISOString();
      return db.prepare("SELECT * FROM scheduled_jobs WHERE status = 'active' AND (next_run_at IS NULL OR next_run_at <= ?) ORDER BY next_run_at ASC").all(now) as Record<string, unknown>[];
    },
  };
}

describe('scheduled jobs repository', () => {
  let repo: ReturnType<typeof createRepo>;
  const orgId = 'test-org';
  const memberId = 'test-member';
  const now = new Date().toISOString();

  beforeEach(() => {
    repo = createRepo();
  });

  it('creates and retrieves a scheduled job', () => {
    repo.save({ id: 'job-1', organizationId: orgId, name: 'Standup', cronExpression: '0 9 * * 1-5', prompt: 'Time for standup!', channelId: 'general', memberId, status: 'active', runCount: 0, createdAt: now, updatedAt: now });
    const job = repo.get(orgId, 'job-1')!;
    expect(job.name).toBe('Standup');
  });

  it('lists scheduled jobs', () => {
    const base = { organizationId: orgId, memberId, status: 'active', runCount: 0, createdAt: now, updatedAt: now };
    repo.save({ id: 'j1', name: 'A', cronExpression: '* * * * *', prompt: 'a', ...base });
    repo.save({ id: 'j2', name: 'B', cronExpression: '* * * * *', prompt: 'b', ...base });
    expect(repo.list(orgId)).toHaveLength(2);
  });

  it('updates a scheduled job', () => {
    repo.save({ id: 'u1', organizationId: orgId, name: 'Old', cronExpression: '0 9 * * *', prompt: 'old', memberId, status: 'active', runCount: 0, createdAt: now, updatedAt: now });
    repo.save({ id: 'u1', organizationId: orgId, name: 'New', cronExpression: '0 10 * * *', prompt: 'new', memberId, status: 'active', runCount: 0, createdAt: now, updatedAt: new Date().toISOString() });
    expect((repo.get(orgId, 'u1') as any).name).toBe('New');
    expect((repo.get(orgId, 'u1') as any).cron_expression).toBe('0 10 * * *');
  });

  it('deletes a scheduled job', () => {
    repo.save({ id: 'd1', organizationId: orgId, name: 'Del', cronExpression: '* * * * *', prompt: 'del', memberId, status: 'active', runCount: 0, createdAt: now, updatedAt: now });
    repo.del(orgId, 'd1');
    expect(repo.get(orgId, 'd1')).toBeNull();
  });

  it('lists due jobs globally', () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const future = new Date(Date.now() + 3600000).toISOString();
    const base = { organizationId: orgId, memberId, runCount: 0, createdAt: now, updatedAt: now };
    repo.save({ id: 'due', name: 'Due', cronExpression: '* * * * *', prompt: 'due', status: 'active', nextRunAt: past, ...base });
    repo.save({ id: 'not-due', name: 'Not', cronExpression: '0 0 1 1 0', prompt: 'not', status: 'active', nextRunAt: future, ...base });
    repo.save({ id: 'paused', name: 'Paused', cronExpression: '* * * * *', prompt: 'pause', status: 'paused', nextRunAt: past, ...base });
    const due = repo.due();
    expect(due.some((j: any) => j.id === 'due')).toBe(true);
    expect(due.some((j: any) => j.id === 'not-due')).toBe(false);
    expect(due.some((j: any) => j.id === 'paused')).toBe(false);
  });

  it('tracks run count and lastError', () => {
    repo.save({ id: 'stats', organizationId: orgId, name: 'Stats', cronExpression: '* * * * *', prompt: 'stats', memberId, status: 'active', runCount: 0, createdAt: now, updatedAt: now });
    repo.save({ id: 'stats', organizationId: orgId, name: 'Stats', cronExpression: '* * * * *', prompt: 'stats', memberId, status: 'active', runCount: 5, lastRunAt: new Date().toISOString(), createdAt: now, updatedAt: new Date().toISOString() });
    expect((repo.get(orgId, 'stats') as any).run_count).toBe(5);
    repo.save({ id: 'stats', organizationId: orgId, name: 'Stats', cronExpression: '* * * * *', prompt: 'stats', memberId, status: 'active', runCount: 5, lastError: 'error!', createdAt: now, updatedAt: new Date().toISOString() });
    expect((repo.get(orgId, 'stats') as any).last_error).toBe('error!');
  });
});
