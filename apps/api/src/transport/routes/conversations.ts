import type { FastifyInstance, FastifyReply } from 'fastify';
import { IdSchema, PaginationQuerySchema } from '@ujima/shared';
import { MessageCreateSchema, OrganizationQuerySchema } from '@ujima/api-schema';
import type { ConversationService } from '@ujima/orchestrator';
import { z } from 'zod';

const ThreadIdParamsSchema = z.object({ threadId: IdSchema });
const ListChannelsQuerySchema = OrganizationQuerySchema.merge(PaginationQuerySchema);

export interface ConversationRoutesOptions {
  conversations: ConversationService;
}

export function registerConversationRoutes(
  app: FastifyInstance,
  options: ConversationRoutesOptions,
): void {
  const { conversations } = options;

  app.get('/api/channels', async (req, reply) => {
    const query = ListChannelsQuerySchema.safeParse(req.query);
    if (!query.success) return badRequest(reply, query.error.message);
    try {
      return conversations.listChannels(
        query.data.organizationId,
        query.data.cursor,
        query.data.limit,
      );
    } catch (err) {
      return notFound(reply, errMessage(err));
    }
  });

  app.get('/api/threads/:threadId/messages', async (req, reply) => {
    const params = ThreadIdParamsSchema.safeParse(req.params);
    if (!params.success) return badRequest(reply, params.error.message);
    const query = ListChannelsQuerySchema.safeParse(req.query);
    if (!query.success) return badRequest(reply, query.error.message);
    try {
      return conversations.listMessages(
        query.data.organizationId,
        params.data.threadId,
        query.data.cursor,
        query.data.limit,
      );
    } catch (err) {
      return notFound(reply, errMessage(err));
    }
  });

  app.post('/api/messages', async (req, reply) => {
    const body = MessageCreateSchema.safeParse(req.body);
    if (!body.success) return badRequest(reply, body.error.message);
    try {
      return conversations.sendMessage(body.data);
    } catch (err) {
      const message = errMessage(err);
      const status =
        message.startsWith('Organization not found') ||
        message.startsWith('Sender not found') ||
        message.startsWith('Channel not found')
          ? 404
          : 400;
      return reply.code(status).send({ error: message });
    }
  });
}

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: message });
}

function notFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(404).send({ error: message });
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
