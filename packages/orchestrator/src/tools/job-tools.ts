import { z } from 'zod';
import type { OrchestratorTool } from './types.js';
import { peekBackgroundJob, terminateBackgroundJob, waitForBackgroundJob } from './shell.js';

const JobOutputSchema = z.object({
  job_id: z.string().min(1),
  wait: z.boolean().default(false),
});

const JobKillSchema = z.object({
  job_id: z.string().min(1),
});

export const jobOutputTool: OrchestratorTool<typeof JobOutputSchema> = {
  id: 'job_output',
  schema: JobOutputSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'shell',
    input: args,
  }),
  execute: async ({ invocation }) => {
    const jobId = String(invocation.input?.job_id ?? '');
    if (!jobId) {
      throw new Error('job_id is required');
    }

    const wait = invocation.input?.wait === true;
    const snapshot = wait
      ? await waitForBackgroundJob(invocation.runId, jobId)
      : peekBackgroundJob(invocation.runId, jobId);

    if (!snapshot) {
      throw new Error(`Job ${jobId} not found or already terminated`);
    }

    return snapshot;
  },
};

export const jobKillTool: OrchestratorTool<typeof JobKillSchema> = {
  id: 'job_kill',
  schema: JobKillSchema,
  toInvocation: (args) => ({
    action: 'execute',
    resourceType: 'shell',
    input: args,
  }),
  execute: async ({ invocation }) => {
    const jobId = String(invocation.input?.job_id ?? '');
    if (!jobId) {
      throw new Error('job_id is required');
    }

    if (!terminateBackgroundJob(invocation.runId, jobId)) {
      throw new Error(`Job ${jobId} not found or already terminated`);
    }

    return {
      status: 'terminated',
      job_id: jobId,
    };
  },
};
