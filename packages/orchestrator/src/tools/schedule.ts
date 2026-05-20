import { z } from 'zod';
import type { OrchestratorTool } from './types.js';
import { createScheduledJobRecord } from '../services/scheduler.js';

const ScheduleCreateSchema = z.object({
  action: z.literal('create'),
  name: z.string().min(1).optional(),
  cron_expression: z.string().min(1),
  prompt: z.string().min(1),
  channel_id: z.string().min(1).optional(),
});

const ScheduleListSchema = z.object({
  action: z.literal('list'),
});

const ScheduleCancelSchema = z.object({
  action: z.literal('cancel'),
  job_id: z.string().min(1),
});

const ScheduleSchema = z.discriminatedUnion('action', [
  ScheduleCreateSchema,
  ScheduleListSchema,
  ScheduleCancelSchema,
]);

function defaultScheduleName(prompt: string): string {
  return prompt.trim().slice(0, 60);
}

export const scheduleTool: OrchestratorTool<typeof ScheduleSchema> = {
  id: 'schedule',
  schema: ScheduleSchema,
  toInvocation: (args) => ({
    action: args.action === 'list' ? 'read' : 'execute',
    resourceType: 'message',
    input: args,
  }),
  execute: ({ invocation, repo }) => {
    if (invocation.input.action === 'list') {
      return { jobs: repo.listScheduledJobs(invocation.organizationId) };
    }

    if (invocation.input.action === 'cancel') {
      const job = repo.getScheduledJob(invocation.organizationId, invocation.input.job_id);
      if (!job) {
        return { removed: false };
      }
      repo.deleteScheduledJob(invocation.organizationId, invocation.input.job_id);
      return { removed: true, job };
    }

    const threadChannelId = invocation.threadId
      ? repo.getThread(invocation.organizationId, invocation.threadId)?.channelId
      : undefined;
    const job = createScheduledJobRecord({
      organizationId: invocation.organizationId,
      memberId: invocation.memberId,
      name: invocation.input.name?.trim() || defaultScheduleName(invocation.input.prompt),
      cronExpression: invocation.input.cron_expression,
      prompt: invocation.input.prompt,
      channelId: invocation.input.channel_id ?? threadChannelId ?? undefined,
    });
    repo.saveScheduledJob(job);
    return { job };
  },
};
