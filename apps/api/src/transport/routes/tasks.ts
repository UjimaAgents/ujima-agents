import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { RuntimeHost } from '@ujima/runtime-core';
import {
  ListTasksResponseSchema,
  StartTaskRequestSchema,
  StartTaskResponseSchema,
  TaskPromotionRequestSchema,
  ApiErrorSchema,
} from '@ujima/api-schema';
import { z } from 'zod';
import type { TaskPromoterService } from '@ujima/orchestrator';

export interface TaskRoutesOptions {
  host: RuntimeHost;
  taskPromoter: TaskPromoterService;
}

export function registerTaskRoutes(_app: FastifyInstance, options: TaskRoutesOptions): void {
  const { host, taskPromoter } = options;
  const app = _app.withTypeProvider<ZodTypeProvider>();

  app.get('/tasks', {
    schema: {
      description: 'List all running tasks',
      tags: ['Tasks'],
      response: {
        200: ListTasksResponseSchema,
      },
    },
  }, async () => {
    return { tasks: host.listTasks().map(toTaskDto) };
  });

  app.post('/tasks', {
    schema: {
      description: 'Start a new task execution',
      tags: ['Tasks'],
      body: StartTaskRequestSchema,
      response: {
        200: StartTaskResponseSchema,
        400: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const res = await host.startTask({
        workspaceId: req.body.workspace_id,
        sessionId: req.body.session_id,
        teamId: req.body.team_id,
        prompt: req.body.prompt,
        taskId: req.body.task_id,
        orchestratorMode: req.body.orchestrator_mode,
        executionMode: req.body.execution_mode,
      });
      return {
        task: toTaskDto({
          taskId: res.task.task_id,
          sessionId: req.body.session_id,
          workspaceId: req.body.workspace_id,
          teamId: res.team.team_id,
          startedAt: Date.now(),
          agentIds: res.handle.agentIds(),
        }),
      };
    } catch (err) {
      return replyError(reply, 500, 'ERR_INTERNAL', err instanceof Error ? err.message : String(err));
    }
  });

  app.post('/tasks/promote', {
    schema: {
      description: 'Promote a task to a different stage or team',
      tags: ['Tasks'],
      body: TaskPromotionRequestSchema,
      response: {
        200: z.object({}).passthrough(),
        400: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      return await taskPromoter.promote(req.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = message.startsWith('Organization not found') ? 404 : 400;
      return reply.code(code).send({ code: 'ERR_PROMOTION_FAILED', message });
    }
  });
}

function toTaskDto(t: {
  taskId: string;
  sessionId: string;
  workspaceId: string;
  teamId: string;
  startedAt: number;
  agentIds: string[];
}) {
  return {
    task_id: t.taskId,
    session_id: t.sessionId,
    workspace_id: t.workspaceId,
    team_id: t.teamId,
    started_at: t.startedAt,
    agent_ids: t.agentIds,
  };
}

function replyError(reply: FastifyReply, status: number, code: string, message: string): FastifyReply {
  return reply.status(status).send({ code, message });
}
