import { IdSchema } from '@ujima/shared';
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

export const ApprovalResolveSchema = z.object({
  organizationId: IdSchema,
  status: z.enum(['approved', 'rejected']),
  resolution: z.enum(['allow_once', 'allow_always', 'reject']).optional(),
  reason: z.string().optional(),
});
export type ApprovalResolve = z.infer<typeof ApprovalResolveSchema>;

export const ApprovalListQuerySchema = z.object({
  organizationId: IdSchema,
});
export type ApprovalListQuery = z.infer<typeof ApprovalListQuerySchema>;
