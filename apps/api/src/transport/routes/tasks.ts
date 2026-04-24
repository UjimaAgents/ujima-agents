import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Repository } from '@ujima/runtime-core';
import { ERR_NO_WORKSPACE_ROOT, NoWorkspaceRootError, type RuntimeHost } from '@ujima/runtime-core';
import {
  ApiErrorSchema,
  KillResponseSchema,
  ListTasksResponseSchema,
  RunningTaskSchema,
  StartTaskRequestSchema,
  StartTaskResponseSchema,
  TaskPromotionRequestSchema,
  TaskPromotionResponseSchema,
} from '@ujima/api-schema';
import { z } from 'zod';
import {
  type TaskPromoterService,
} from '@ujima/orchestrator';
import {
  assertReadyWorkspaceRoot,
  isWorkspaceRootNotReadyError,
} from './workspace-root.js';

export interface TaskRoutesOptions {
  host: RuntimeHost;
  repo: Repository;
  taskPromoter: TaskPromoterService;
}

const TaskIdParamsSchema = z.object({ id: z.string().min(1) });
const TaskAgentKillParamsSchema = z.object({
  taskId: z.string().min(1),
  agentId: z.string().min(1),
});

export function registerTaskRoutes(_app: FastifyInstance, options: TaskRoutesOptions): void {
  const { host, repo, taskPromoter } = options;
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

  app.get('/tasks/:id', {
    schema: {
      description: 'Get a running task by ID',
      tags: ['Tasks'],
      params: TaskIdParamsSchema,
      response: {
        200: RunningTaskSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    const task = host.listTasks().find((t) => t.taskId === req.params.id);
    if (!task) return replyError(reply, 404, 'ERR_NOT_FOUND', `task "${req.params.id}" not found`);
    return toTaskDto(task);
  });

  app.post('/tasks', {
    schema: {
      description: 'Start a new task execution',
      tags: ['Tasks'],
      body: StartTaskRequestSchema,
      response: {
        200: StartTaskResponseSchema,
        400: ApiErrorSchema,
        409: ApiErrorSchema,
        500: ApiErrorSchema,
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
      if (err instanceof NoWorkspaceRootError || (err instanceof Error && err.message.includes(ERR_NO_WORKSPACE_ROOT))) {
        return replyError(reply, 409, ERR_NO_WORKSPACE_ROOT, err instanceof Error ? err.message : String(err));
      }
      return replyError(reply, 500, 'ERR_INTERNAL', err instanceof Error ? err.message : String(err));
    }
  });

  app.delete('/tasks/:id', {
    schema: {
      description: 'Kill a running task',
      tags: ['Tasks'],
      params: TaskIdParamsSchema,
      response: {
        200: KillResponseSchema,
      },
    },
  }, async (req) => {
    return { killed: host.killTask(req.params.id) };
  });

  app.post('/tasks/:taskId/agents/:agentId/kill', {
    schema: {
      description: 'Kill a running agent',
      tags: ['Tasks'],
      params: TaskAgentKillParamsSchema,
      response: {
        200: KillResponseSchema,
      },
    },
  }, async (req) => {
    return { killed: host.killAgent(req.params.taskId, req.params.agentId) };
  });

  app.post('/tasks/promote', {
    schema: {
      description: 'Promote a task to a different stage or team',
      tags: ['Tasks'],
      body: TaskPromotionRequestSchema,
      response: {
        200: TaskPromotionResponseSchema,
        400: ApiErrorSchema,
        409: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      assertReadyWorkspaceRoot(repo, req.body.organizationId);
      return await taskPromoter.promote(req.body);
    } catch (err) {
      if (isWorkspaceRootNotReadyError(err)) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(409).send({ code: ERR_NO_WORKSPACE_ROOT, message });
      }
      const message = err instanceof Error ? err.message : String(err);
      const code = message.startsWith('Organization not found') ? 404 : 400;
      return reply.code(code).send({ code: code === 404 ? 'ERR_NOT_FOUND' : 'ERR_BAD_REQUEST', message });
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
