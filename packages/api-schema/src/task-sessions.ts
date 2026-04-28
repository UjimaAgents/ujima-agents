import { z } from 'zod';
import {
  IdSchema,
  TaskExecutionModeSchema,
  TaskSessionSchema,
  TaskSessionStatusSchema,
} from '@ujima/shared';

// HTTP shapes for the unified task shell (Phase 1).
// `/api/tasks` namespace, distinct from the legacy `/tasks` host.

export const CreateTaskSessionRequestSchema = z.object({
  organizationId: IdSchema,
  requestedBy: IdSchema,
  prompt: z.string().min(1),
  team: z.array(IdSchema).default([]),
  executionMode: TaskExecutionModeSchema.optional(),
  origin: z
    .object({
      channelId: IdSchema.optional(),
      messageId: IdSchema.optional(),
    })
    .optional(),
  promotionMetadata: z.record(z.string(), z.unknown()).optional(),
  slug: z.string().min(1).optional(),
});
export type CreateTaskSessionRequest = z.infer<typeof CreateTaskSessionRequestSchema>;

export const TaskSessionDetailQuerySchema = z.object({
  organizationId: IdSchema,
});

export const TaskSessionListQuerySchema = z.object({
  organizationId: IdSchema,
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: TaskSessionStatusSchema.optional(),
});

export const TaskSessionListResponseSchema = z.object({
  data: z.array(TaskSessionSchema),
  hasMore: z.boolean(),
  nextCursor: z.string().optional(),
});
export type TaskSessionListResponse = z.infer<typeof TaskSessionListResponseSchema>;

export const CreateTaskSessionResponseSchema = z.object({
  session: TaskSessionSchema,
});
export type CreateTaskSessionResponse = z.infer<typeof CreateTaskSessionResponseSchema>;
