import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiErrorSchema } from '@ujima/api-schema';
import { TodoSchema } from '@ujima/shared';
import type { ApiRepository, AuthService } from '@ujima/orchestrator';
import { apiError, errorMessage } from './route-errors.js';
import { readSessionToken } from '../session-token.js';

/**
 * Bet 2 — channel goals rail.
 *
 * Single read endpoint that projects `task_sessions` + `todos` joined
 * by `channel_id` so the workspace UI can render "open work in this
 * channel" without first looking up a session id. No new LLM call, no
 * new agent — pure data shape over what Bet 4 already persists.
 */

export interface ChannelGoalsRoutesOptions {
  repo: ApiRepository;
  auth: AuthService;
}

const ChannelIdParamsSchema = z.object({ id: z.string().min(1) });
const ChannelGoalsQuerySchema = z.object({
  organizationId: z.string().min(1),
});

const ChannelGoalsResponseSchema = z.object({
  todos: z.array(TodoSchema),
  taskSessionIds: z.array(z.string()),
});
export type ChannelGoalsResponse = z.infer<typeof ChannelGoalsResponseSchema>;

export function registerChannelGoalsRoutes(
  fastify: FastifyInstance,
  options: ChannelGoalsRoutesOptions,
): void {
  const { repo, auth } = options;
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/channels/:id/open-goals', {
    schema: {
      description:
        'List the open commitments/todos for a channel. Powers the channel goals rail in the workspace UI.',
      tags: ['Channels'],
      params: ChannelIdParamsSchema,
      querystring: ChannelGoalsQuerySchema,
      response: {
        200: ChannelGoalsResponseSchema,
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
        return { todos: [], taskSessionIds: [] };
      }
      // Active commitments only — the rail surface should show
      // things still in motion, not historical artifacts. The UI can
      // request `?status=expired` later if we surface a "missed
      // deadlines" tab; that's outside this endpoint's scope today.
      const open = repo.listTodosForChannel(req.query.organizationId, req.params.id, {
        status: 'in_progress',
      });
      const pending = repo.listTodosForChannel(req.query.organizationId, req.params.id, {
        status: 'pending',
      });
      const blocked = repo.listTodosForChannel(req.query.organizationId, req.params.id, {
        status: 'blocked',
      });
      const todos = [...open, ...pending, ...blocked];
      const taskSessionIds = Array.from(
        new Set(todos.map((todo) => todo.taskSessionId).filter(Boolean) as string[]),
      );
      return { todos, taskSessionIds };
    } catch (err) {
      return apiError(reply, 500, errorMessage(err));
    }
  });
}
