import { SocketEventNames } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import type { ConversationService } from './conversation.js';
import type { RealtimeService } from './context.js';

/**
 * Parse a 5-field cron expression and return the next Date
 * at or after `from` that matches. Returns null if the expression
 * is invalid or no match exists within a reasonable window.
 *
 * Fields: minute (0-59), hour (0-23), day-of-month (1-31),
 *         month (1-12), day-of-week (0-6, 0=Sunday).
 * Supports: * (wildcard), N (exact), N-M (range), N,M (list).
 */
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

const CRON_SENDER_ID = '__ujima_scheduler__';

export class SchedulerService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs: number;
  private running = false;

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
    this.timer = setInterval(() => this.tick(), this.pollIntervalMs);
    // Run immediately on start
    queueMicrotask(() => this.tick());
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
    try {
      const due = this.repo.listDueJobsGlobally();
      const now = new Date();

      for (const job of due) {
        if (!this.running) break;
        try {
          const matcher = parseCronExpression(job.cronExpression);
          const nextRun = matcher ? matcher(now) : null;

          const updatedJob = {
            ...job,
            lastRunAt: now.toISOString(),
            nextRunAt: nextRun?.toISOString(),
            runCount: job.runCount + 1,
            lastError: undefined,
            updatedAt: now.toISOString(),
          };

          // Execute the job
          await this.executeJob(job);

          this.repo.saveScheduledJob(updatedJob);
        } catch (error) {
          const updatedJob = {
            ...job,
            lastError: error instanceof Error ? error.message : String(error),
            updatedAt: new Date().toISOString(),
          };
          this.repo.saveScheduledJob(updatedJob);
        }
      }
    } catch {
      // Swallow tick-level errors so the loop continues
    }
  }

  private async executeJob(job: {
    organizationId: string;
    channelId?: string;
    prompt: string;
    memberId: string;
    name: string;
  }): Promise<void> {
    // Ensure the scheduler sender member exists
    const sender = this.repo.getMember(job.organizationId, CRON_SENDER_ID);
    if (!sender) {
      this.repo.saveMember({
        id: CRON_SENDER_ID,
        organizationId: job.organizationId,
        name: 'Scheduler',
        kind: 'agent',
        roleName: 'system',
        presence: 'offline',
        createdAt: new Date().toISOString(),
      });
    }

    if (job.channelId) {
      await this.conversations.sendMessage({
        organizationId: job.organizationId,
        channelId: job.channelId,
        threadId: job.channelId,
        senderId: CRON_SENDER_ID,
        content: `**⏰ Scheduled: ${job.name}**\n\n${job.prompt}`,
      });
    }

    this.realtime.emit(SocketEventNames.scheduledJobExecuted, {
      organizationId: job.organizationId,
      jobName: job.name,
      channelId: job.channelId,
      prompt: job.prompt,
    });
  }
}
