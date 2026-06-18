import { randomUUID } from 'node:crypto';
import {
  ScheduleCardSchema,
  ScheduledJobSchema,
  type MessageCard,
  type MessageToolCall,
  type ScheduledJob,
} from '@ujima/shared';
import { normalizeToDottedToolName } from './run-reply-guard.js';

interface ToolCallLike {
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  input?: unknown;
}

interface ToolResultLike {
  toolCallId?: string;
  output?: unknown;
  result?: unknown;
}

export function appendScheduleToolCalls(
  toolCalls: readonly ToolCallLike[],
  toolResults: readonly ToolResultLike[] = [],
): MessageToolCall[] {
  const resultsById = new Map<string, unknown>();
  for (const result of toolResults) {
    if (typeof result.toolCallId !== 'string') continue;
    resultsById.set(result.toolCallId, result.output ?? result.result);
  }

  const cards: MessageToolCall[] = [];
  for (const call of toolCalls) {
    const toolName = normalizeToDottedToolName(call.toolName?.toLowerCase() ?? '');
    if (toolName !== 'schedule') continue;
    const card = buildScheduleCard(
      getToolInput(call),
      call.toolCallId ? resultsById.get(call.toolCallId) : undefined,
    );
    if (card) cards.push(wrapScheduleCard(card));
  }
  return cards;
}

export function buildScheduleCard(input: Record<string, unknown>, output: unknown): MessageCard | undefined {
  const action = typeof input.action === 'string' ? input.action : undefined;
  if (action === 'create') {
    const job = parseJob(output);
    return job ? scheduleCardFromJob('created', job) : undefined;
  }
  if (action === 'cancel') {
    const job = parseJob(output);
    return ScheduleCardSchema.parse({
      cardId: randomUUID(),
      kind: 'schedule',
      action: 'cancelled',
      removed: isRecord(output) ? output.removed === true : undefined,
      ...(job ? jobCardFields(job) : {}),
    });
  }
  if (action === 'list') {
    const jobs = isRecord(output) && Array.isArray(output.jobs)
      ? output.jobs.flatMap((item) => {
          const parsed = ScheduledJobSchema.safeParse(item);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
    return ScheduleCardSchema.parse({
      cardId: randomUUID(),
      kind: 'schedule',
      action: 'listed',
      jobs: jobs.slice(0, 5).map(jobPreview),
    });
  }
  return undefined;
}

function scheduleCardFromJob(action: 'created' | 'cancelled', job: ScheduledJob): MessageCard {
  return ScheduleCardSchema.parse({
    cardId: randomUUID(),
    kind: 'schedule',
    action,
    ...jobCardFields(job),
  });
}

function jobCardFields(job: ScheduledJob) {
  return {
    jobId: job.id,
    name: job.name,
    cronExpression: job.cronExpression,
    prompt: job.prompt,
    channelId: job.channelId,
    status: job.status,
    nextRunAt: job.nextRunAt,
    runCount: job.runCount,
  };
}

function jobPreview(job: ScheduledJob) {
  return {
    id: job.id,
    name: job.name,
    cronExpression: job.cronExpression,
    status: job.status,
    channelId: job.channelId,
    nextRunAt: job.nextRunAt,
    runCount: job.runCount,
  };
}

function parseJob(output: unknown): ScheduledJob | undefined {
  const raw = isRecord(output) ? output.job : output;
  const parsed = ScheduledJobSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

function getToolInput(call: ToolCallLike): Record<string, unknown> {
  if (call.input && isRecord(call.input)) return call.input;
  if (call.args?.input && isRecord(call.args.input)) return call.args.input;
  return call.args ?? {};
}

function wrapScheduleCard(card: MessageCard): MessageToolCall {
  return {
    toolCallId: randomUUID(),
    toolName: 'card.schedule',
    args: { ...card },
    result: card,
    isError: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
