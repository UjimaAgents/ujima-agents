import { z } from 'zod';
import type { OrchestratorTool } from './types.js';

export const MessageSchema = z.object({
  destination: z.enum(['thread', 'channel', 'dm']),
  channelId: z.string().min(1).optional(),
  recipientId: z.string().min(1).optional(),
  content: z.string().min(1),
  mentions: z.array(z.string().min(1)).default([]),
});

export const messageTool: OrchestratorTool<typeof MessageSchema> = {
  id: 'message',
  schema: MessageSchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    input: args,
  }),
  execute: ({ invocation, conversations }) => {
    const destination = invocation.input?.destination as string | undefined;
    const content = invocation.input?.content as string | undefined;
    const mentions = Array.isArray(invocation.input?.mentions)
      ? invocation.input.mentions.filter((mention): mention is string => typeof mention === 'string')
      : [];

    if (typeof destination !== 'string') {
      throw new Error("Input 'destination' must be a string");
    }

    if (typeof content !== 'string') {
      throw new Error("Input 'content' must be a string");
    }

    if (destination === 'thread') {
      if (!invocation.threadId) {
        throw new Error('threadId is required for thread messages');
      }
      return conversations.sendMessage({
        organizationId: invocation.organizationId,
        threadId: invocation.threadId,
        senderId: invocation.memberId,
        content,
        mentions,
      });
    }

    if (destination === 'channel') {
      const channelId = invocation.input?.channelId as string | undefined;
      if (typeof channelId !== 'string') {
        throw new Error("Input 'channelId' must be a string");
      }
      if (!invocation.threadId) {
        throw new Error('threadId is required for channel messages');
      }
      return conversations.sendMessage({
        organizationId: invocation.organizationId,
        threadId: invocation.threadId,
        channelId,
        senderId: invocation.memberId,
        content,
        mentions,
      });
    }

    if (destination === 'dm') {
      const recipientId = invocation.input?.recipientId as string | undefined;
      if (typeof recipientId !== 'string') {
        throw new Error("Input 'recipientId' must be a string");
      }
      return conversations.sendDirectMessage({
        organizationId: invocation.organizationId,
        senderId: invocation.memberId,
        recipientId,
        content,
        mentions,
      });
    }

    throw new Error(`Unknown message destination "${destination}"`);
  },
};
