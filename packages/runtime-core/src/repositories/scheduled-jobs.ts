import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { ScheduledJobSchema, type ScheduledJob, type JobStatus } from '@ujima/shared';
import { now, optionalRowString, rowString } from './common.js';

type Row = Record<string, unknown>;

function rowToScheduledJob(row: Row): ScheduledJob {
  return ScheduledJobSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    name: rowString(row, 'name'),
    cronExpression: rowString(row, 'cron_expression'),
    prompt: rowString(row, 'prompt'),
    channelId: optionalRowString(row, 'channel_id'),
    memberId: rowString(row, 'member_id'),
    status: rowString(row, 'status'),
    lastRunAt: optionalRowString(row, 'last_run_at'),
    nextRunAt: optionalRowString(row, 'next_run_at'),
    runCount: Number(row.run_count ?? 0),
    lastError: optionalRowString(row, 'last_error'),
    createdAt: rowString(row, 'created_at'),
    updatedAt: rowString(row, 'updated_at'),
  });
}

export function saveScheduledJob(db: DbHandle, job: ScheduledJob): ScheduledJob {
  const timestamp = now();
  db.prepare(
    `INSERT INTO scheduled_jobs (
      id, organization_id, name, cron_expression, prompt,
      channel_id, member_id, status, last_run_at, next_run_at,
      run_count, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      cron_expression = excluded.cron_expression,
      prompt = excluded.prompt,
      channel_id = excluded.channel_id,
      member_id = excluded.member_id,
      status = excluded.status,
      last_run_at = excluded.last_run_at,
      next_run_at = excluded.next_run_at,
      run_count = excluded.run_count,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at`,
  ).run(
    job.id,
    job.organizationId,
    job.name,
    job.cronExpression,
    job.prompt,
    job.channelId ?? null,
    job.memberId,
    job.status,
    job.lastRunAt ?? null,
    job.nextRunAt ?? null,
    job.runCount,
    job.lastError ?? null,
    job.createdAt ?? timestamp,
    timestamp,
  );
  return job;
}

export function getScheduledJob(db: DbHandle, organizationId: string, jobId: string): ScheduledJob | null {
  const row = db
    .prepare('SELECT * FROM scheduled_jobs WHERE id = ? AND organization_id = ?')
    .get(jobId, organizationId) as Row | null;
  return row ? rowToScheduledJob(row) : null;
}

export function listScheduledJobs(db: DbHandle, organizationId: string): ScheduledJob[] {
  const rows = db
    .prepare('SELECT * FROM scheduled_jobs WHERE organization_id = ? ORDER BY created_at ASC')
    .all(organizationId) as Row[];
  return rows.map(rowToScheduledJob);
}

export function listDueScheduledJobs(db: DbHandle, organizationId: string): ScheduledJob[] {
  const rows = db
    .prepare(
      `SELECT * FROM scheduled_jobs
       WHERE organization_id = ? AND status = 'active'
         AND (next_run_at IS NULL OR next_run_at <= ?)
       ORDER BY next_run_at ASC`,
    )
    .all(organizationId, now()) as Row[];
  return rows.map(rowToScheduledJob);
}

export function deleteScheduledJob(db: DbHandle, organizationId: string, jobId: string): void {
  db.prepare('DELETE FROM scheduled_jobs WHERE id = ? AND organization_id = ?').run(jobId, organizationId);
}

export function listDueJobsGlobally(db: DbHandle): ScheduledJob[] {
  const rows = db
    .prepare(
      `SELECT * FROM scheduled_jobs
       WHERE status = 'active'
         AND (next_run_at IS NULL OR next_run_at <= ?)
       ORDER BY next_run_at ASC`,
    )
    .all(now()) as Row[];
  return rows.map(rowToScheduledJob);
}
