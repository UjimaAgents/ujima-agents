import { z } from 'zod';
import { ApprovalMode, ExecutionMode } from '@ujima/shared';

export const TaskFileSchema = z.object({
  task_id: z.string().min(1),
  prompt: z.string().min(1),
  team: z.array(z.string().min(1)).default([]),
  execution_mode: ExecutionMode.default('concurrent'),
  approvals: z
    .object({
      mode: ApprovalMode.optional(),
    })
    .default({}),
  graph: z.array(z.string().min(1)).optional(),
  sequence: z.array(z.string().min(1)).optional(),
});

export type TaskFile = z.infer<typeof TaskFileSchema>;
