import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  createPaginatedSchema,
  ChannelSchema,
  IdSchema,
  MessageSchema,
  PaginationQuerySchema,
  getDirectMessageThreadId,
} from '@ujima/shared';
import { ApiErrorSchema, MessageCreateSchema, OrganizationQuerySchema } from '@ujima/api-schema';
import type { Repository } from '@ujima/runtime-core';
import type { AuthService, AuthState, ConversationService } from '@ujima/orchestrator';
import { z } from 'zod';
import {
  assertReadyWorkspaceRoot,
} from './workspace-root.js';
import { readSessionToken } from '../session-token.js';
import { apiError, errorMessage, routeError } from './route-errors.js';

const ThreadIdParamsSchema = z.object({ threadId: IdSchema });
const ConversationArchiveBodySchema = z.object({
  organizationId: IdSchema,
  mode: z.enum(['summarize', 'clear']),
});
const ListChannelsQuerySchema = OrganizationQuerySchema.merge(PaginationQuerySchema);
const ListChannelsResponseSchema = createPaginatedSchema(ChannelSchema);
const ListMessagesResponseSchema = createPaginatedSchema(MessageSchema);
const ThreadReadResponseSchema = z.object({ ok: z.literal(true) });
const ThreadArchiveResponseSchema = z.object({
  ok: z.literal(true),
  mode: z.enum(['summarize', 'clear']),
  summaryId: IdSchema.nullish(),
  archivedCount: z.number(),
});

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
      const authState = requireConversationSession(auth, req, reply, req.query.organizationId);
      if ('code' in authState) return authState;
      return conversations.listChannels(
        req.query.organizationId,
        req.query.cursor,
        req.query.limit,
      );
    } catch (err) {
      return apiError(reply, 404, errorMessage(err));
    }
  });

  app.get('/threads/:threadId/verify', {
    schema: {
      description: 'Verify access to a thread',
      tags: ['Conversations'],
      params: ThreadIdParamsSchema,
      querystring: OrganizationQuerySchema,
      response: {
        200: z.object({ ok: z.boolean(), memberIds: z.array(IdSchema), channelIds: z.array(IdSchema) }),
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const authState = requireConversationSession(auth, req, reply, req.query.organizationId);
      if ('code' in authState) return authState;
      conversations.requireThreadAccess(
        req.query.organizationId,
        req.params.threadId,
        authState.member.id,
        'read',
      );
      const thread = repo.getThread(req.query.organizationId, req.params.threadId);
      const channel = thread?.channelId ? repo.getChannel(req.query.organizationId, thread.channelId) : null;
      const channelMemberIds =
        channel && channel.kind !== 'self' && channel.kind !== 'dm' && channel.memberIds.length === 0
          ? repo.listMembers(req.query.organizationId).map((member) => member.id)
          : channel?.memberIds ?? [];
      return {
        ok: true,
        memberIds: [...new Set([...(thread?.memberIds ?? []), ...channelMemberIds])],
        channelIds: channel ? [channel.id] : [],
      };
    } catch (err) {
      const message = errorMessage(err);
      if (message.startsWith('Forbidden')) {
        return apiError(reply, 403, message);
      }
      return apiError(reply, 404, message);
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
      const authState = requireConversationSession(auth, req, reply, req.query.organizationId);
      if ('code' in authState) return authState;
      return conversations.listMessages(
        req.query.organizationId,
        req.params.threadId,
        req.query.cursor,
        req.query.limit,
        authState.member?.id,
      );
    } catch (err) {
      const message = errorMessage(err);
      if (message.startsWith('Forbidden')) {
        return apiError(reply, 403, message);
      }
      return apiError(reply, 404, message);
    }
  });

  app.post('/threads/:threadId/read', {
    schema: {
      description: 'Mark a thread as read for the current member',
      tags: ['Conversations'],
      params: ThreadIdParamsSchema,
      querystring: OrganizationQuerySchema,
      response: {
        200: ThreadReadResponseSchema,
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const authState = requireConversationSession(auth, req, reply, req.query.organizationId);
      if ('code' in authState) return authState;
      conversations.requireThreadAccess(
        req.query.organizationId,
        req.params.threadId,
        authState.member.id,
        'read',
      );
      repo.saveConversationRead(
        req.query.organizationId,
        authState.member.id,
        req.params.threadId,
        new Date().toISOString(),
      );
      return { ok: true as const };
    } catch (err) {
      const message = errorMessage(err);
      if (message.startsWith('Forbidden')) {
        return apiError(reply, 403, message);
      }
      return apiError(reply, 404, message);
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
      assertReadyWorkspaceRoot(repo, req.body.organizationId);
      const authState = requireConversationSession(auth, req, reply, req.body.organizationId);
      if ('code' in authState) return authState;
      const senderId = authState.member.id;
      // L10 — client-supplied idempotency key. If the client sent
      // `clientMessageId` and a message with the same thread-scoped
      // idempotency key already exists, return it instead of
      // re-posting. Retried HTTP POSTs (network glitches) no longer
      // double-wake the channel, while the same key can still be used
      // independently in another thread.
      const clientMessageId =
        typeof req.body.clientMessageId === 'string' && req.body.clientMessageId.length > 0
          ? req.body.clientMessageId
          : undefined;
      const requestedThreadId =
        'recipientId' in req.body
          ? resolveDirectMessageThreadId(
              repo,
              req.body.organizationId,
              senderId,
              req.body.recipientId,
              req.body.parentMessageId,
            )
          : req.body.threadId;
      if (clientMessageId && requestedThreadId) {
        // Access-control regression guard: the dedupe fast-path used
        // to return the cached row BEFORE any thread/channel access
        // check ran. A member who posted with clientMessageId X,
        // then got removed from the channel (or a DM thread they
        // were once a participant of), could re-POST the same key
        // and still receive the cached message — leaking content
        // they no longer have access to.
        //
        // Revalidate access against the CURRENT membership before
        // honoring the cache. Falls through to the regular send
        // path on mismatch — `sendMessage` / `sendDirectMessage`
        // will run the same check again and reject with the same
        // error, so this stays the only gate either way.
        //
        // First-ever DMs (self or peer-to-peer) are exempt because
        // their channel + thread are lazily created inside
        // `sendDirectMessage` / `sendSelfNote` on the first call.
        // Calling `requireThreadAccess` here on a thread that has
        // no row AND no backing channel would throw
        // `Thread not found` and block the initial post — even
        // though no cached message can exist on a thread that
        // doesn't exist yet. We detect the "first-ever" case by
        // checking the persisted state (`getThread` + `getChannel`,
        // matching what `requireThreadAccess` itself walks); when
        // either exists, the preflight runs as normal.
        const threadOrChannelExists =
          repo.getThread(req.body.organizationId, requestedThreadId) !== null ||
          repo.getChannel(req.body.organizationId, requestedThreadId) !== null;
        if (threadOrChannelExists) {
          conversations.requireThreadAccess(
            req.body.organizationId,
            requestedThreadId,
            senderId,
          );
          const existing = repo.findMessageByClientId?.(
            req.body.organizationId,
            senderId,
            requestedThreadId,
            clientMessageId,
          );
          if (existing && existing.threadId === requestedThreadId) {
            return existing;
          }
        }
      }
      const message =
        'recipientId' in req.body
          ? conversations.sendDirectMessage({
              organizationId: req.body.organizationId,
              senderId,
              recipientId: req.body.recipientId,
              content: req.body.content,
              attachmentIds: req.body.attachmentIds,
              parentMessageId: req.body.parentMessageId,
              ignore: req.body.ignore,
              metadata: req.body.metadata,
              clientMessageId,
            })
          : conversations.sendMessage({
              ...req.body,
              senderId,
              metadata: req.body.metadata,
              clientMessageId,
            });
      return message;
    } catch (err) {
      const message = errorMessage(err);
      // requireThreadAccess (and the channel-write guards inside
      // sendMessage / sendDirectMessage) surface access denials as
      // `Forbidden: ...`. The schema declares 403 as a valid
      // response — translate to it instead of falling through to a
      // generic 400.
      if (message.startsWith('Forbidden')) {
        return apiError(reply, 403, message);
      }
      return routeError(reply, err, {
        notFound: ['Organization not found', 'Sender not found', 'Channel not found', 'Recipient not found'],
        workspaceRoot: true,
      });
    }
  });

  app.post('/threads/:threadId/archive', {
    schema: {
      description: 'Archive a thread, either by summarizing it or clearing visible history',
      tags: ['Conversations'],
      params: ThreadIdParamsSchema,
      body: ConversationArchiveBodySchema,
      response: {
        200: ThreadArchiveResponseSchema,
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const authState = requireConversationSession(auth, req, reply, req.body.organizationId);
      if ('code' in authState) return authState;

      conversations.requireThreadAccess(
        req.body.organizationId,
        req.params.threadId,
        authState.member.id,
      );

      const result = await conversations.archiveConversation({
        organizationId: req.body.organizationId,
        threadId: req.params.threadId,
        memberId: authState.member.id,
        mode: req.body.mode,
      });

      return {
        ok: true as const,
        mode: req.body.mode,
        summaryId: result.summaryMessage?.id ?? null,
        archivedCount: result.compactedMessageIds.length,
      };
    } catch (err) {
      const message = errorMessage(err);
      if (message.startsWith('Forbidden')) {
        return apiError(reply, 403, message);
      }
      return apiError(reply, 404, message);
    }
  });
}

/** Exported for unit tests. */
export function resolveDirectMessageThreadId(
  repo: Repository,
  organizationId: string,
  senderId: string,
  recipientId: string,
  parentMessageId?: string,
): string | undefined {
  // Self-DMs always resolve to `self:<senderId>`, regardless of any
  // `parentMessageId` the caller passes. `ConversationService.sendSelfNote`
  // already routes self-notes to that channel, so the route's dedupe
  // lookup and access check MUST target the same thread — otherwise
  // a retried self-message carrying a stale parentMessageId dedupes
  // against the parent's thread (creating duplicate self-notes) or
  // 403s after the sender loses access to that parent thread.
  if (recipientId === 'self') {
    return `self:${senderId}`;
  }
  if (parentMessageId) {
    return repo.getMessage(organizationId, parentMessageId)?.threadId;
  }
  return getDirectMessageThreadId(senderId, recipientId);
}

function requireConversationSession(
  auth: AuthService,
  req: FastifyRequest,
  reply: FastifyReply,
  organizationId: string,
): (AuthState & { member: NonNullable<AuthState['member']> }) | FastifyReply {
  const authState = auth.getAuthState(readSessionToken(req));
  if (!authState.member) return apiError(reply, 401, 'Session required');
  if (authState.user?.organizationId !== organizationId) {
    return apiError(reply, 403, 'Unauthorized for this organization.');
  }
  return authState as AuthState & { member: NonNullable<AuthState['member']> };
}
