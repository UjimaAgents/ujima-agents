import { IdSchema, ReasoningEffortSchema } from '@ujima/shared';
import { z } from 'zod';

export const OrganizationQuerySchema = z.object({
  organizationId: IdSchema,
});
export type OrganizationQuery = z.infer<typeof OrganizationQuerySchema>;

const MessageCreateMetadataSchema = z.object({
  goalMode: z.boolean().optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
}).optional();

const ThreadMessageCreateSchema = z.object({
  organizationId: IdSchema,
  threadId: IdSchema,
  channelId: IdSchema.optional(),
  senderId: IdSchema,
  content: z.string(),
  attachmentIds: z.array(IdSchema).default([]),
  parentMessageId: IdSchema.optional(),
  metadata: MessageCreateMetadataSchema,
  /**
   * Client-supplied dedupe key. The daemon stores it on the persisted
   * message and rejects retries that arrive with the same triple of
   * (org, thread, sender, clientMessageId). Optional for backwards
   * compatibility; new clients should always send it.
   */
  clientMessageId: IdSchema.optional(),
}).strict();

const DirectMessageCreateSchema = z.object({
  organizationId: IdSchema,
  recipientId: IdSchema,
  senderId: IdSchema,
  content: z.string(),
  attachmentIds: z.array(IdSchema).default([]),
  ignore: z.boolean().optional(),
  parentMessageId: IdSchema.optional(),
  metadata: MessageCreateMetadataSchema,
  clientMessageId: IdSchema.optional(),
}).strict();

export const MessageCreateSchema = z.union([ThreadMessageCreateSchema, DirectMessageCreateSchema]);
export type MessageCreate = z.infer<typeof MessageCreateSchema>;

export const SocketSubscribeSchema = z.object({
  organizationId: IdSchema,
  channelIds: z.array(IdSchema).default([]),
  threadIds: z.array(IdSchema).default([]),
  memberIds: z.array(IdSchema).default([]),
  runIds: z.array(IdSchema).default([]),
});
export type SocketSubscribe = z.infer<typeof SocketSubscribeSchema>;
