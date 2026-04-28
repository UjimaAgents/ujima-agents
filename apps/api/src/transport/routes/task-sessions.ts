import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiErrorSchema,
  CreateTaskSessionRequestSchema,
  CreateTaskSessionResponseSchema,
  TaskSessionDetailQuerySchema,
  TaskSessionListQuerySchema,
  TaskSessionListResponseSchema,
} from '@ujima/api-schema';
import { TaskSessionSchema } from '@ujima/shared';
import type { TaskSessionService } from '@ujima/orchestrator';

// Routes for the unified task shell (Phase 1). Mounted under `/api`
// in server.ts, so the public paths are `/api/task-sessions/*`.
//
// The path namespace is intentionally NOT `/api/tasks` — that's still
// owned by the legacy host (`apps/api/src/transport/routes/tasks.ts`,
// which proxies `host.startTask`). When Phase 4 retires the legacy
// host these routes can move to `/api/tasks` cleanly.

export interface TaskSessionRoutesOptions {
  taskSessions: TaskSessionService;
}

const TaskSessionIdParamsSchema = z.object({ id: z.string().min(1) });

export function registerTaskSessionRoutes(
  fastify: FastifyInstance,
  options: TaskSessionRoutesOptions,
): void {
  const { taskSessions } = options;
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post('/task-sessions', {
    schema: {
      description: 'Create a new task session and the matching task-run channel',
      tags: ['Task Sessions'],
      body: CreateTaskSessionRequestSchema,
      response: {
        200: CreateTaskSessionResponseSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
        409: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const detail = taskSessions.create(req.body);
      return { session: detail.session };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Human-only origination invariant — surfaces a 403-flavoured
      // ERR_FORBIDDEN since the agent role is structurally disallowed.
      if (message.startsWith('Only human members can originate tasks')) {
        return replyError(reply, 403, 'ERR_FORBIDDEN', message);
      }
      if (
        message.startsWith('Organization not found') ||
        message.startsWith('Requester not found') ||
        message.startsWith('Team member not found')
      ) {
        return replyError(reply, 404, 'ERR_NOT_FOUND', message);
      }
      if (message.startsWith('Cannot include retired member')) {
        return replyError(reply, 409, 'ERR_CONFLICT', message);
      }
      return replyError(reply, 400, 'ERR_BAD_REQUEST', message);
    }
  });

  app.get('/task-sessions', {
    schema: {
      description: 'List task sessions for an organization, newest first',
      tags: ['Task Sessions'],
      querystring: TaskSessionListQuerySchema,
      response: {
        200: TaskSessionListResponseSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      return taskSessions.list(req.query.organizationId, {
        cursor: req.query.cursor,
        limit: req.query.limit,
        status: req.query.status,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('Organization not found')) {
        return replyError(reply, 404, 'ERR_NOT_FOUND', message);
      }
      return replyError(reply, 400, 'ERR_BAD_REQUEST', message);
    }
  });

  app.get('/task-sessions/:id', {
    schema: {
      description: 'Get a task session by id',
      tags: ['Task Sessions'],
      params: TaskSessionIdParamsSchema,
      querystring: TaskSessionDetailQuerySchema,
      response: {
        200: TaskSessionSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const session = taskSessions.get(req.query.organizationId, req.params.id);
      if (!session) {
        return replyError(reply, 404, 'ERR_NOT_FOUND', `task session "${req.params.id}" not found`);
      }
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('Organization not found')) {
        return replyError(reply, 404, 'ERR_NOT_FOUND', message);
      }
      return replyError(reply, 400, 'ERR_BAD_REQUEST', message);
    }
  });
}

function replyError(reply: FastifyReply, status: number, code: string, message: string): FastifyReply {
  return reply.status(status).send({ code, message });
}
