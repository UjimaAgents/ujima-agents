import type { FastifyInstance } from 'fastify';
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
} from '@ujima/api-schema';
import { z } from 'zod';
import {
  isWorkspaceRootNotReadyError,
} from './workspace-root.js';
import { apiError, errorMessage } from './route-errors.js';

export interface TaskRoutesOptions {
  host: RuntimeHost;
  repo: Repository;
}

const TaskIdParamsSchema = z.object({ id: z.string().min(1) });
const TaskAgentKillParamsSchema = z.object({
  taskId: z.string().min(1),
  agentId: z.string().min(1),
});

export function registerTaskRoutes(_app: FastifyInstance, options: TaskRoutesOptions): void {
  const { host } = options;
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
    if (!task) return apiError(reply, 404, `task "${req.params.id}" not found`);
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
      const taskFile = req.body.task_file;
      const res = await host.startTask({
        workspaceId: req.body.workspace_id,
        sessionId: req.body.session_id,
        teamId: req.body.team_id,
        agentIds: taskFile?.team,
        prompt: taskFile?.prompt ?? req.body.prompt ?? '',
        taskId: taskFile?.task_id ?? req.body.task_id,
        orchestratorMode: req.body.orchestrator_mode,
        executionMode: taskFile?.execution_mode ?? req.body.execution_mode,
        sequence: taskFile?.sequence,
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
      if (
        err instanceof NoWorkspaceRootError ||
        isWorkspaceRootNotReadyError(err) ||
        (err instanceof Error && err.message.includes(ERR_NO_WORKSPACE_ROOT))
      ) {
        return apiError(reply, 409, errorMessage(err), ERR_NO_WORKSPACE_ROOT);
      }
      return apiError(reply, 500, errorMessage(err));
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
