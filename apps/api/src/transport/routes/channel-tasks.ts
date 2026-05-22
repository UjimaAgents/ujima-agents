import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiErrorSchema } from '@ujima/api-schema';
import {
  SocketEventNames,
  TodoSchema,
  TodoStatusSchema,
  channelRoom,
  memberRoom,
  orgRoom,
  threadRoom,
} from '@ujima/shared';
import type { ApiRepository, AuthService } from '@ujima/orchestrator';
import type { RealtimeService } from '@ujima/orchestrator';
import { apiError, errorMessage } from './route-errors.js';
import { readSessionToken } from '../session-token.js';

/**
 * Per-channel Tasks tab API.
 *
 * Powers the workspace UI's channel Tasks tab. Two endpoints:
 *
 *  - `GET  /channels/:id/tasks` — full list across every status,
 *    grouped by the UI. Distinct from `/open-goals` (which is the
 *    curated rail showing in_progress + recently-completed only) —
 *    this endpoint surfaces expired, cancelled, blocked, etc. so the
 *    human can investigate stalls and post-mortem completed work.
 *
 *  - `PATCH /channels/:id/tasks/:todoId/status` — human override.
 *    The agent-driven extractors handle most resolutions (path-bearing
 *    completion, in-channel delivery, idle escalation), but humans
 *    sometimes need to mark a task complete/cancelled directly when
 *    the agent's wording didn't trip the extractor or when the work
 *    moved to another channel.
 */

export interface ChannelTasksRoutesOptions {
  repo: ApiRepository;
  auth: AuthService;
  realtime: RealtimeService;
}

const ChannelIdParamsSchema = z.object({ id: z.string().min(1) });
const TodoIdParamsSchema = z.object({ id: z.string().min(1), todoId: z.string().min(1) });
const ChannelTasksQuerySchema = z.object({
  organizationId: z.string().min(1),
});

const ChannelTasksResponseSchema = z.object({
  todos: z.array(TodoSchema),
});
export type ChannelTasksResponse = z.infer<typeof ChannelTasksResponseSchema>;

const PatchTodoStatusBodySchema = z.object({
  organizationId: z.string().min(1),
  status: TodoStatusSchema,
  notes: z.string().max(2000).optional(),
});

const PatchTodoStatusResponseSchema = z.object({
  todo: TodoSchema,
});

export function registerChannelTasksRoutes(
  fastify: FastifyInstance,
  options: ChannelTasksRoutesOptions,
): void {
  const { repo, auth, realtime } = options;
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/channels/:id/tasks', {
    schema: {
      description:
        'List every todo in a channel across all statuses. Powers the channel Tasks tab in the workspace UI.',
      tags: ['Channels'],
      params: ChannelIdParamsSchema,
      querystring: ChannelTasksQuerySchema,
      response: {
        200: ChannelTasksResponseSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const authState = auth.getAuthState(readSessionToken(req));
      if (!authState.member) return apiError(reply, 401, 'Session required');
      if (authState.user?.organizationId !== req.query.organizationId) {
        return apiError(reply, 403, 'Unauthorized for this organization.');
      }
      if (!repo.listTodosForChannel) {
        return { todos: [] };
      }
      const todos = repo.listTodosForChannel(req.query.organizationId, req.params.id);
      // Sort newest-updated first so the tab opens on the most
      // recent activity. The repo returns created-at ascending; for
      // an investigation view we want the inverse.
      todos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { todos };
    } catch (err) {
      return apiError(reply, 500, errorMessage(err));
    }
  });

  app.patch('/channels/:id/tasks/:todoId/status', {
    schema: {
      description:
        'Human override: change the status of a todo. Emits commitment:updated so all subscribed clients pick up the change. The acting user must belong to the same organization as the todo.',
      tags: ['Channels'],
      params: TodoIdParamsSchema,
      body: PatchTodoStatusBodySchema,
      response: {
        200: PatchTodoStatusResponseSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const authState = auth.getAuthState(readSessionToken(req));
      if (!authState.member) return apiError(reply, 401, 'Session required');
      if (authState.user?.organizationId !== req.body.organizationId) {
        return apiError(reply, 403, 'Unauthorized for this organization.');
      }
      const existing = repo.getTodo(req.body.organizationId, req.params.todoId);
      if (!existing) {
        return apiError(reply, 404, 'Todo not found.');
      }
      // Defence-in-depth: the path id and the todo's channel must
      // agree, so a client can't smuggle a todo from one channel via
      // another channel's PATCH route.
      if (existing.channelId !== req.params.id) {
        return apiError(reply, 404, 'Todo not in this channel.');
      }
      const now = new Date().toISOString();
      const updated = TodoSchema.parse({
        ...existing,
        status: req.body.status,
        notes: req.body.notes ?? existing.notes,
        // Status flips driven by humans count as progress — reset
        // the empty-wake counter so the sweeper doesn't keep
        // escalating a row the human just resolved.
        emptyWakeCount: 0,
        lastProgressAt: now,
        updatedAt: now,
      });
      repo.saveTodo(updated);

      const rooms = [
        orgRoom(updated.organizationId),
        memberRoom(updated.memberId),
        ...(updated.channelId ? [channelRoom(updated.channelId), threadRoom(updated.channelId)] : []),
      ];
      realtime.emit(
        SocketEventNames.commitmentUpdated,
        {
          organizationId: updated.organizationId,
          channelId: updated.channelId,
          threadId: updated.channelId,
          todoId: updated.id,
          taskSessionId: updated.taskSessionId,
          ownerMemberId: updated.memberId,
          deliverable: updated.deliverableSummary ?? updated.title,
          status: updated.status,
          dueAt: updated.dueAt,
          occurredAt: now,
        },
        rooms,
      );
      return { todo: updated };
    } catch (err) {
      return apiError(reply, 500, errorMessage(err));
    }
  });
}
