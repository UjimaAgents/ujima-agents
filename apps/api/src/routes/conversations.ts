import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { MessageSchema, SocketEventNames } from "@ujima/shared";
import { MessageCreateSchema, OrganizationQuerySchema } from "../schemas.ts";

export default async function conversationRoutes(fastify: FastifyInstance) {
  fastify.get("/api/channels", async (request, reply) => {
    const query = OrganizationQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: "organizationId is required" });
    }

    try {
      return fastify.services.conversations.listChannels(query.data.organizationId);
    } catch (error) {
      return reply.code(404).send({ error: (error as Error).message });
    }
  });

  fastify.get("/api/threads/:threadId/messages", async (request, reply) => {
    const query = OrganizationQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: "organizationId is required" });
    }

    const { threadId } = request.params as { threadId: string };
    try {
      return fastify.services.conversations.listMessages(query.data.organizationId, threadId);
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(message.startsWith("Thread not found") ? 404 : 404).send({ error: message });
    }
  });

  fastify.post("/api/messages", async (request, reply) => {
    const body = MessageCreateSchema.parse(request.body);
    try {
      return fastify.services.conversations.sendMessage(body);
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
