import { IdSchema, MessageSchema, RunStateSchema, RunStepSchema, createPaginatedSchema } from '@ujima/shared';
import { z } from 'zod';

export const RunCreateSchema = z.object({
  organizationId: IdSchema,
  agentId: IdSchema,
  threadId: IdSchema,
  summary: z.string().optional(),
});
export type RunCreate = z.infer<typeof RunCreateSchema>;

export const RunListQuerySchema = z.object({
  organizationId: IdSchema,
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export type RunListQuery = z.infer<typeof RunListQuerySchema>;

export const RunTraceEntrySchema = z.object({
  run: RunStateSchema,
  steps: z.array(RunStepSchema),
  message: MessageSchema.optional(),
});
export type RunTraceEntry = z.infer<typeof RunTraceEntrySchema>;

export const RunTraceListQuerySchema = z.object({
  organizationId: IdSchema,
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(20).optional(),
});
export type RunTraceListQuery = z.infer<typeof RunTraceListQuerySchema>;

export const RunTraceListResponseSchema = createPaginatedSchema(RunTraceEntrySchema);
export type RunTraceListResponse = z.infer<typeof RunTraceListResponseSchema>;

export const RunCancelSchema = z.object({
  organizationId: IdSchema,
});
export type RunCancel = z.infer<typeof RunCancelSchema>;

export const ApprovalResolveSchema = z.object({
  organizationId: IdSchema,
  resolution: z.enum(['allow_once', 'allow_always', 'allow_family', 'reject']),
  reason: z.string().optional(),
});
export type ApprovalResolve = z.infer<typeof ApprovalResolveSchema>;

export const ApprovalListQuerySchema = z.object({
  organizationId: IdSchema,
});
export type ApprovalListQuery = z.infer<typeof ApprovalListQuerySchema>;

export const ShellJobSchema = z.object({
  id: z.string(),
  status: z.enum(['running', 'exited', 'error']),
});
export type ShellJob = z.infer<typeof ShellJobSchema>;

export const ShellJobDetailSchema = z.object({
  id: z.string(),
  status: z.enum(['running', 'exited', 'error']),
  cwd: z.string(),
  commandLine: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().optional(),
  error: z.string().optional(),
});
export type ShellJobDetail = z.infer<typeof ShellJobDetailSchema>;

export const ShellJobDetailQuerySchema = z.object({
  organizationId: IdSchema,
});
export type ShellJobDetailQuery = z.infer<typeof ShellJobDetailQuerySchema>;

export const RunJobTerminateSchema = z.object({
  organizationId: IdSchema,
});
export type RunJobTerminate = z.infer<typeof RunJobTerminateSchema>;
