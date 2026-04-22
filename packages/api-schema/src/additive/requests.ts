import { IdSchema, OrganizationSchema } from '@ujima/shared';
import { z } from 'zod';

export const ListOrganizationsResponseSchema = z.object({
  organizations: z.array(OrganizationSchema),
});
export type ListOrganizationsResponse = z.infer<typeof ListOrganizationsResponseSchema>;

export const AddMemberRequestSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['human', 'agent']),
  roleName: z.string().min(1),
});
export type AddMemberRequest = z.infer<typeof AddMemberRequestSchema>;

export const ProviderTestResultSchema = z.object({
  provider: z.string(),
  ok: z.boolean(),
  message: z.string(),
});
export type ProviderTestResult = z.infer<typeof ProviderTestResultSchema>;

export const TaskPromotionRequestSchema = z.object({
  organizationId: IdSchema,
  channelId: IdSchema,
  threadId: IdSchema.optional(),
  messageId: IdSchema.optional(),
  requestedBy: IdSchema,
  prompt: z.string().min(1),
  assignedAgentId: IdSchema.optional(),
  reason: z.string().default(''),
});
export type TaskPromotionRequest = z.infer<typeof TaskPromotionRequestSchema>;

export const TaskPromotionResponseSchema = z.object({
  runId: IdSchema,
  organizationId: IdSchema,
  assignedAgentId: IdSchema,
  status: z.string(),
  auditEventId: IdSchema,
});
export type TaskPromotionResponse = z.infer<typeof TaskPromotionResponseSchema>;
