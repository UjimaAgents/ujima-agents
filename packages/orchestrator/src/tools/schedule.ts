import { z } from 'zod';
import type { OrchestratorTool } from './types.js';
import { createScheduledJobRecord } from '../services/scheduler.js';

const ScheduleSchema = z.object({
  action: z.enum(['create', 'list', 'cancel']),
  name: z.string().min(1).optional(),
  cron_expression: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  channel_id: z.string().min(1).optional(),
  job_id: z.string().min(1).optional(),
});

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
    const args = ScheduleSchema.parse(invocation.input);

    if (args.action === 'list') {
      return { jobs: repo.listScheduledJobs(invocation.organizationId) };
    }

    if (args.action === 'cancel') {
      if (!args.job_id) {
        throw new Error('job_id is required for cancel');
      }
      const job = repo.getScheduledJob(invocation.organizationId, args.job_id);
      if (!job) {
        return { removed: false };
      }
      repo.deleteScheduledJob(invocation.organizationId, args.job_id);
      return { removed: true, job };
    }

    if (!args.cron_expression || !args.prompt) {
      throw new Error('cron_expression and prompt are required for create');
    }

    const threadChannelId = invocation.threadId
      ? repo.getThread(invocation.organizationId, invocation.threadId)?.channelId
      : undefined;
    const job = createScheduledJobRecord({
      organizationId: invocation.organizationId,
      memberId: invocation.memberId,
      name: args.name?.trim() || defaultScheduleName(args.prompt),
      cronExpression: args.cron_expression,
      prompt: args.prompt,
      channelId: args.channel_id ?? threadChannelId ?? undefined,
    });
    repo.saveScheduledJob(job);
    return { job };
  },
};
