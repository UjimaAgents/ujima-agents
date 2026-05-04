import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createPaginatedSchema, ChannelSchema, IdSchema, MessageSchema, PaginationQuerySchema } from '@ujima/shared';
import { ApiErrorSchema, MessageCreateSchema, OrganizationQuerySchema } from '@ujima/api-schema';
import type { Repository } from '@ujima/runtime-core';
import type { AuthService, ConversationService } from '@ujima/orchestrator';
import { z } from 'zod';
import {
  ERR_NO_WORKSPACE_ROOT,
  assertReadyWorkspaceRoot,
  isWorkspaceRootNotReadyError,
} from './workspace-root.js';
import { readSessionToken } from '../session-token.js';

const ThreadIdParamsSchema = z.object({ threadId: IdSchema });
const ListChannelsQuerySchema = OrganizationQuerySchema.merge(PaginationQuerySchema);
const ListChannelsResponseSchema = createPaginatedSchema(ChannelSchema);
const ListMessagesResponseSchema = createPaginatedSchema(MessageSchema);

export interface ConversationRoutesOptions {
  repo: Repository;
  conversations: ConversationService;
  auth: AuthService;
}

export function registerConversationRoutes(
  _app: FastifyInstance,
  options: ConversationRoutesOptions,
): void {
  const { repo, conversations, auth } = options;
  const app = _app.withTypeProvider<ZodTypeProvider>();

  app.get('/channels', {
    schema: {
      description: 'List channels for an organization',
      tags: ['Conversations'],
      querystring: ListChannelsQuerySchema,
      response: {
        200: ListChannelsResponseSchema,
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const authState = auth.getAuthState(readSessionToken(req));
      if (!authState.member) {
        return reply.code(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Session required' });
      }
      if (authState.user?.organizationId !== req.query.organizationId) {
        return reply.code(403).send({ code: 'ERR_FORBIDDEN', message: 'Unauthorized for this organization.' });
      }
      return conversations.listChannels(
        req.query.organizationId,
        req.query.cursor,
        req.query.limit,
      );
    } catch (err) {
      return notFound(reply, errMessage(err));
    }
  });

  app.get('/threads/:threadId/verify', {
    schema: {
      description: 'Verify access to a thread',
      tags: ['Conversations'],
      params: ThreadIdParamsSchema,
      querystring: OrganizationQuerySchema,
      response: {
        200: z.object({ ok: z.boolean() }),
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const authState = auth.getAuthState(readSessionToken(req));
      if (!authState.member) {
        return reply.code(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Session required' });
      }
      if (authState.user?.organizationId !== req.query.organizationId) {
        return reply.code(403).send({ code: 'ERR_FORBIDDEN', message: 'Unauthorized for this organization.' });
      }
      conversations.requireThreadAccess(
        req.query.organizationId,
        req.params.threadId,
        authState.member.id,
      );
      return { ok: true };
    } catch (err) {
      const message = errMessage(err);
      if (message.startsWith('Forbidden')) {
        return reply.code(403).send({ code: 'ERR_FORBIDDEN', message });
      }
      return notFound(reply, message);
    }
  });

  app.get('/threads/:threadId/messages', {
    schema: {
      description: 'List messages in a thread',
      tags: ['Conversations'],
      params: ThreadIdParamsSchema,
      querystring: ListChannelsQuerySchema,
      response: {
        200: ListMessagesResponseSchema,
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const authState = auth.getAuthState(readSessionToken(req));
      if (!authState.member) {
        return reply.code(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Session required' });
      }
      if (authState.user?.organizationId !== req.query.organizationId) {
        return reply.code(403).send({ code: 'ERR_FORBIDDEN', message: 'Unauthorized for this organization.' });
      }
      return conversations.listMessages(
        req.query.organizationId,
        req.params.threadId,
        req.query.cursor,
        req.query.limit,
        authState.member?.id,
      );
    } catch (err) {
      const message = errMessage(err);
      if (message.startsWith('Forbidden')) {
        return reply.code(403).send({ code: 'ERR_FORBIDDEN', message });
      }
      return notFound(reply, message);
    }
  });

  app.post('/messages', {
    schema: {
      description: 'Send a thread, channel, or direct message',
      tags: ['Conversations'],
      body: MessageCreateSchema,
      response: {
        200: MessageSchema,
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        409: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const authState = auth.getAuthState(readSessionToken(req));
      if (!authState.member) {
        return reply.code(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Session required' });
      }
      if (authState.user?.organizationId !== req.body.organizationId) {
        return reply.code(403).send({ code: 'ERR_FORBIDDEN', message: 'Unauthorized for this organization.' });
      }
      assertReadyWorkspaceRoot(repo, req.body.organizationId);
      const senderId = authState.member.id;
      if ('recipientId' in req.body) {
        return conversations.sendDirectMessage({
          organizationId: req.body.organizationId,
          senderId,
          recipientId: req.body.recipientId,
          content: req.body.content,
        });
      }
      return conversations.sendMessage({
        ...req.body,
        senderId,
      });
    } catch (err) {
      const message = errMessage(err);
      if (isWorkspaceRootNotReadyError(err)) {
        return reply.code(409).send({ code: ERR_NO_WORKSPACE_ROOT, message });
      }
      const status =
        message.startsWith('Organization not found') ||
        message.startsWith('Sender not found') ||
        message.startsWith('Channel not found') ||
        message.startsWith('Recipient not found')
          ? 404
          : 400;
      return replyError(reply, status, message);
    }
  });
}

function notFound(reply: FastifyReply, message: string): FastifyReply {
  return replyError(reply, 404, message);
}

function replyError(reply: FastifyReply, status: number, message: string): FastifyReply {
  return reply.code(status).send({ code: status === 404 ? 'ERR_NOT_FOUND' : 'ERR_BAD_REQUEST', message });
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
