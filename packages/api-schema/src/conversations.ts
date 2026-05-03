import { IdSchema } from '@ujima/shared';
import { z } from 'zod';

export const OrganizationQuerySchema = z.object({
  organizationId: IdSchema,
});
export type OrganizationQuery = z.infer<typeof OrganizationQuerySchema>;

const ThreadMessageCreateSchema = z.object({
  organizationId: IdSchema,
  threadId: IdSchema,
  channelId: IdSchema.optional(),
  senderId: IdSchema,
  content: z.string().min(1),
}).strict();

const DirectMessageCreateSchema = z.object({
  organizationId: IdSchema,
  recipientId: IdSchema,
  senderId: IdSchema,
  content: z.string().min(1),
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
