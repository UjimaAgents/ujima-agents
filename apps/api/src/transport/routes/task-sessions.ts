import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiErrorSchema,
  CreateTaskSessionRequestSchema,
  CreateTaskSessionResponseSchema,
  StartTaskSessionRequestSchema,
  StartTaskSessionResponseSchema,
  TaskSessionDetailQuerySchema,
  TaskSessionListQuerySchema,
  TaskSessionListResponseSchema,
  TaskSessionSpiritsResponseSchema,
  TaskSessionTodosResponseSchema,
} from '@ujima/api-schema';
import { TaskSessionSchema, TodoStatusSchema } from '@ujima/shared';
import type { ApiRepository, TaskSessionService } from '@ujima/orchestrator';

// Routes for the unified task shell (Phase 1). Mounted under `/api`
// in server.ts, so the public paths are `/api/task-sessions/*`.
//
// The path namespace is intentionally NOT `/api/tasks` — that's still
// owned by the legacy host (`apps/api/src/transport/routes/tasks.ts`,
// which proxies `host.startTask`). When Phase 4 retires the legacy
// host these routes can move to `/api/tasks` cleanly.

export interface TaskSessionRoutesOptions {
  taskSessions: TaskSessionService;
  /**
   * Phase 2 — repo handle for the workers/todos read endpoints. The
   * routes file shouldn't grow into a service shim, so reads go
   * straight to the repo (the same pattern bootstrap.ts uses).
   */
  repo: ApiRepository;
}

const TaskSessionIdParamsSchema = z.object({ id: z.string().min(1) });

const TaskSessionScopedQuerySchema = z.object({
  organizationId: z.string().min(1),
});

const TaskSessionTodosQuerySchema = TaskSessionScopedQuerySchema.extend({
  status: TodoStatusSchema.optional(),
});

export function registerTaskSessionRoutes(
  fastify: FastifyInstance,
  options: TaskSessionRoutesOptions,
): void {
  const { taskSessions, repo } = options;
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

  app.post('/task-sessions/:id/start', {
    schema: {
      description:
        'Provision spirit worker instances for the task session, optionally driving one initial turn',
      tags: ['Task Sessions'],
      params: TaskSessionIdParamsSchema,
      body: StartTaskSessionRequestSchema,
      response: {
        200: StartTaskSessionResponseSchema,
        404: ApiErrorSchema,
        409: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const result = await taskSessions.start(req.body.organizationId, req.params.id, {
        runFirstTurn: req.body.runFirstTurn,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.startsWith('Organization not found') ||
        message.startsWith('Task session not found') ||
        message.startsWith('Member not found')
      ) {
        return replyError(reply, 404, 'ERR_NOT_FOUND', message);
      }
      if (message.includes('not wired') || message.includes('not an agent') || message.includes('retired')) {
        return replyError(reply, 409, 'ERR_CONFLICT', message);
      }
      return replyError(reply, 400, 'ERR_BAD_REQUEST', message);
    }
  });

  app.get('/task-sessions/:id/spirits', {
    schema: {
      description: 'List spirits attached to a task session',
      tags: ['Task Sessions'],
      params: TaskSessionIdParamsSchema,
      querystring: TaskSessionScopedQuerySchema,
      response: {
        200: TaskSessionSpiritsResponseSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    const session = repo.getTaskSession(req.query.organizationId, req.params.id);
    if (!session) {
      return replyError(reply, 404, 'ERR_NOT_FOUND', `task session "${req.params.id}" not found`);
    }
    const spirits = repo.listSpiritsForSession(req.query.organizationId, req.params.id);
    return { spirits };
  });

  app.get('/task-sessions/:id/todos', {
    schema: {
      description: 'List supervisor todos scoped to a task session',
      tags: ['Task Sessions'],
      params: TaskSessionIdParamsSchema,
      querystring: TaskSessionTodosQuerySchema,
      response: {
        200: TaskSessionTodosResponseSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    const session = repo.getTaskSession(req.query.organizationId, req.params.id);
    if (!session) {
      return replyError(reply, 404, 'ERR_NOT_FOUND', `task session "${req.params.id}" not found`);
    }
    const todos = repo.listTodosForSession(req.query.organizationId, req.params.id, {
      status: req.query.status,
    });
    return { todos };
  });
}

function replyError(reply: FastifyReply, status: number, code: string, message: string): FastifyReply {
  return reply.status(status).send({ code, message });
}
