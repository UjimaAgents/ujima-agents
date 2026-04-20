import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { MessageSchema, ChannelSchema, PaginationQuerySchema, IdSchema, createPaginatedSchema } from "@ujima/shared";
import { MessageCreateSchema, OrganizationQuerySchema } from "../schemas.ts";
import { z } from "zod";

export default async function conversationRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/api/channels", {
    schema: {
      summary: "List channels",
      description: "Retrieve a paginated list of all communication channels for the organization.",
      tags: ["Conversations"],
      querystring: OrganizationQuerySchema.merge(PaginationQuerySchema),
      response: {
        200: createPaginatedSchema(ChannelSchema),
        400: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
      },
    },
  }, async (request, reply) => {
    try {
      const { organizationId, cursor, limit } = request.query;
      return fastify.services.conversations.listChannels(organizationId, cursor, limit);
    } catch (error) {
      return reply.code(404).send({ error: (error as Error).message });
    }
  });

  app.get("/api/threads/:threadId/messages", {
    schema: {
      summary: "List thread messages",
      description: "Retrieve a paginated list of messages within a specific conversation thread.",
      tags: ["Conversations"],
      params: z.object({
        threadId: IdSchema,
      }),
      querystring: OrganizationQuerySchema.merge(PaginationQuerySchema),
      response: {
        200: createPaginatedSchema(MessageSchema),
        400: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
      },
    },
  }, async (request, reply) => {
    try {
      const { threadId } = request.params;
      const { organizationId, cursor, limit } = request.query;
      return fastify.services.conversations.listMessages(organizationId, threadId, cursor, limit);
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(404).send({ error: message });
    }
  });

  app.post("/api/messages", {
    schema: {
      summary: "Send message",
      description: "Post a new message to a channel or thread.",
      tags: ["Conversations"],
      body: MessageCreateSchema,
      response: {
        200: MessageSchema,
        400: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
      },
    },
  }, async (request, reply) => {
    try {
      return fastify.services.conversations.sendMessage(request.body);
    } catch (error) {
      const message = (error as Error).message;
      const status =
        message.startsWith("Organization not found") || message.startsWith("Sender not found") || message.startsWith("Channel not found")
          ? 404
          : 400;
      return reply.code(status).send({ error: message });
    }
  });
}
