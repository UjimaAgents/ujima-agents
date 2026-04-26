import { z } from 'zod';
import type { OrchestratorTool } from './types.js';

const ChannelPostSchema = z.object({
  channel_id: z.string().min(1),
  body: z.string().min(1),
  reply_to: z.string().min(1).optional(),
  mentions: z.array(z.string().min(1)).default([]),
});

const ChannelReplySchema = z.object({
  message_id: z.string().min(1),
  body: z.string().min(1),
  mentions: z.array(z.string().min(1)).default([]),
});

const ChannelDmSchema = z.object({
  member_id: z.string().min(1),
  body: z.string().min(1),
  mentions: z.array(z.string().min(1)).default([]),
});

const ChannelListSchema = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
});

const ChannelReadSchema = z.object({
  channel_id: z.string().min(1),
  since: z.string().optional(),
  query: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

const SelfNoteSchema = z.object({
  body: z.string().min(1),
});

export const channelPostTool: OrchestratorTool<typeof ChannelPostSchema> = {
  id: 'channel.post',
  schema: ChannelPostSchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    resourcePath: args.channel_id,
    permissionMcpId: 'channels',
    permissionToolName: 'post',
    input: args,
  }),
  execute: ({ invocation, conversations }) =>
    conversations.postToChannel({
      organizationId: invocation.organizationId,
      senderId: invocation.memberId,
      channelId: String(invocation.input.channel_id),
      body: String(invocation.input.body),
      replyTo:
        typeof invocation.input.reply_to === 'string' ? invocation.input.reply_to : undefined,
      mentions: Array.isArray(invocation.input.mentions)
        ? invocation.input.mentions.filter((value): value is string => typeof value === 'string')
        : [],
    }),
};

export const channelReplyTool: OrchestratorTool<typeof ChannelReplySchema> = {
  id: 'channel.reply',
  schema: ChannelReplySchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    resourcePath: args.message_id,
    permissionMcpId: 'channels',
    permissionToolName: 'reply',
    input: args,
  }),
  execute: ({ invocation, conversations }) =>
    conversations.replyToMessage({
      organizationId: invocation.organizationId,
      senderId: invocation.memberId,
      messageId: String(invocation.input.message_id),
      body: String(invocation.input.body),
      mentions: Array.isArray(invocation.input.mentions)
        ? invocation.input.mentions.filter((value): value is string => typeof value === 'string')
        : [],
    }),
};

export const channelDmTool: OrchestratorTool<typeof ChannelDmSchema> = {
  id: 'channel.dm',
  schema: ChannelDmSchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    permissionMcpId: 'channels',
    permissionToolName: 'dm',
    input: args,
  }),
  execute: ({ invocation, conversations }) =>
    conversations.sendDirectMessage({
      organizationId: invocation.organizationId,
      senderId: invocation.memberId,
      recipientId: String(invocation.input.member_id),
      content: String(invocation.input.body),
      mentions: Array.isArray(invocation.input.mentions)
        ? invocation.input.mentions.filter((value): value is string => typeof value === 'string')
        : [],
    }),
};

export const channelListTool: OrchestratorTool<typeof ChannelListSchema> = {
  id: 'channel.list',
  schema: ChannelListSchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    permissionMcpId: 'channels',
    permissionToolName: 'list',
    input: args,
  }),
  execute: ({ invocation, conversations }) =>
    conversations.listVisibleChannels({
      organizationId: invocation.organizationId,
      memberId: invocation.memberId,
      scope: invocation.input.scope === 'all' ? 'all' : 'mine',
    }),
};

export const channelReadTool: OrchestratorTool<typeof ChannelReadSchema> = {
  id: 'channel.read',
  schema: ChannelReadSchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    resourcePath: args.channel_id,
    permissionMcpId: 'channels',
    permissionToolName: 'read',
    input: args,
  }),
  execute: ({ invocation, conversations }) =>
    conversations.readChannel({
      organizationId: invocation.organizationId,
      memberId: invocation.memberId,
      channelId: String(invocation.input.channel_id),
      since: typeof invocation.input.since === 'string' ? invocation.input.since : undefined,
      query: typeof invocation.input.query === 'string' ? invocation.input.query : undefined,
      cursor: typeof invocation.input.cursor === 'string' ? invocation.input.cursor : undefined,
      limit:
        typeof invocation.input.limit === 'number' ? invocation.input.limit : undefined,
    }),
};

export const selfNoteTool: OrchestratorTool<typeof SelfNoteSchema> = {
  id: 'self.note',
  schema: SelfNoteSchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: ({ invocation, conversations }) =>
    conversations.sendSelfNote({
      organizationId: invocation.organizationId,
      memberId: invocation.memberId,
      body: String(invocation.input.body),
    }),
};
