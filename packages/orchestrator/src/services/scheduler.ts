import { randomUUID } from 'node:crypto';
import { SocketEventNames, channelRoom, orgRoom, type ScheduledJob } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import type { ConversationService } from './conversation.js';
import type { RealtimeService } from './context.js';

export function computeNextCronRun(cronExpression: string, after: Date = new Date()): Date | null {
  const matcher = parseCronExpression(cronExpression);
  if (!matcher) return null;
  const start = new Date(after);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);
  return matcher(start);
}

export function resolveScheduledJobNextRunAt(
  existing: { cronExpression: string; status: string; nextRunAt?: string },
  patch: { cronExpression?: string; status?: string },
  now: Date = new Date(),
): string | undefined {
  const status = patch.status ?? existing.status;
  const cronExpression = patch.cronExpression ?? existing.cronExpression;
  const recompute =
    patch.cronExpression !== undefined ||
    (status === 'active' && existing.status !== 'active');

  if (status !== 'active' || !recompute) {
    return existing.nextRunAt;
  }

  return computeNextCronRun(cronExpression, now)?.toISOString();
}

export function createScheduledJobRecord(input: {
  organizationId: string;
  memberId: string;
  name: string;
  cronExpression: string;
  prompt: string;
  channelId?: string;
  now?: Date;
}): ScheduledJob {
  const now = input.now ?? new Date();
  const nextRunAt = computeNextCronRun(input.cronExpression, now);
  if (!nextRunAt) {
    throw new Error('Invalid cron expression.');
  }

  return {
    id: randomUUID(),
    organizationId: input.organizationId,
    name: input.name,
    cronExpression: input.cronExpression,
    prompt: input.prompt,
    channelId: input.channelId,
    memberId: input.memberId,
    status: 'active',
    nextRunAt: nextRunAt.toISOString(),
    runCount: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  } as ScheduledJob;
}

/** Parse a 5-field cron expression and return the next Date at or after `from` that matches. */
export function parseCronExpression(expr: string): ((date: Date) => Date | null) | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const fieldParsers = parts.map((part) => parseCronField(part));
  if (fieldParsers.length !== 5 || fieldParsers.some((p) => p === null)) return null;

  const [minParser, hourParser, domParser, monthParser, dowParser] = fieldParsers as [
    (value: number) => boolean,
    (value: number) => boolean,
    (value: number) => boolean,
    (value: number) => boolean,
    (value: number) => boolean,
  ];

  return (from: Date): Date | null => {
    const candidate = new Date(from);
    candidate.setSeconds(0, 0);

    for (let attempts = 0; attempts < 525600; attempts++) {
      const min = candidate.getMinutes();
      const hour = candidate.getHours();
      const dom = candidate.getDate();
      const month = candidate.getMonth() + 1;
      const dow = candidate.getDay();

      if (
        minParser(min) &&
        hourParser(hour) &&
        domParser(dom) &&
        monthParser(month) &&
        dowParser(dow)
      ) {
        return candidate;
      }

      candidate.setMinutes(candidate.getMinutes() + 1);
    }

    return null;
  };
}

function parseCronField(field: string): ((value: number) => boolean) | null {
  // Wildcard
  if (field === '*') return () => true;

  // Comma-separated list
  if (field.includes(',')) {
    const values = new Set<number>();
    for (const item of field.split(',')) {
      const v = Number(item);
      if (isNaN(v) || !Number.isInteger(v)) return null;
      values.add(v);
    }
    return (v: number) => values.has(v);
  }

  // Range (N-M)
  if (field.includes('-')) {
    const parts = field.split('-');
    if (parts.length !== 2) return null;
    const lo = Number(parts[0]);
    const hi = Number(parts[1]);
    if (isNaN(lo) || isNaN(hi) || lo > hi) return null;
    return (v: number) => v >= lo && v <= hi;
  }

  // Single value
  const val = Number(field);
  if (isNaN(val) || !Number.isInteger(val)) return null;
  return (v: number) => v === val;
}

export interface SchedulerServiceOptions {
  /** How often to check for due jobs, in ms (default 30000). */
  pollIntervalMs?: number;
}


export class SchedulerService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs: number;
  private running = false;
  private tickInFlight = false;

  constructor(
    private readonly repo: ApiRepository,
    private readonly conversations: ConversationService,
    private readonly realtime: RealtimeService,
    options: SchedulerServiceOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 30000;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    setTimeout(() => void this.tick(), 0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      const due = this.repo.listDueJobsGlobally();
      const now = new Date();

      for (const job of due) {
        if (!this.running) break;
        try {
          if (!job.nextRunAt) {
            const firstRun = computeNextCronRun(job.cronExpression, now);
            if (firstRun) {
              this.repo.saveScheduledJob({
                ...job,
                nextRunAt: firstRun.toISOString(),
                updatedAt: now.toISOString(),
              });
            }
            continue;
          }

          await this.executeJob(job);

          const nextRun = computeNextCronRun(job.cronExpression, now);
          this.repo.saveScheduledJob({
            ...job,
            lastRunAt: now.toISOString(),
            nextRunAt: nextRun?.toISOString(),
            runCount: job.runCount + 1,
            lastError: undefined,
            updatedAt: now.toISOString(),
          });
        } catch (error) {
          const nextRun = computeNextCronRun(job.cronExpression, now);
          this.repo.saveScheduledJob({
            ...job,
            lastError: error instanceof Error ? error.message : String(error),
            nextRunAt: nextRun?.toISOString() ?? job.nextRunAt,
            updatedAt: now.toISOString(),
          });
        }
      }
    } catch {
      // Swallow tick-level errors so the loop continues
    } finally {
      this.tickInFlight = false;
    }
  }

  private async executeJob(job: {
    organizationId: string;
    channelId?: string;
    prompt: string;
    name: string;
    memberId: string;
  }): Promise<void> {
    if (job.channelId) {
      const sender = this.repo.getMember(job.organizationId, job.memberId);
      const channel = this.repo.getChannel(job.organizationId, job.channelId);
      if (channel && sender) {
        await this.conversations.sendMessage({
          organizationId: job.organizationId,
          threadId: job.channelId,
          channelId: job.channelId,
          senderId: job.memberId,
          content: `**⏰ Scheduled: ${job.name}**\n\n${job.prompt}`,
        });
      }
    }

    this.realtime.emit(SocketEventNames.scheduledJobExecuted, {
      organizationId: job.organizationId,
      jobName: job.name,
      channelId: job.channelId,
      prompt: job.prompt,
    }, [orgRoom(job.organizationId), ...(job.channelId ? [channelRoom(job.channelId)] : [])]);
  }
}
