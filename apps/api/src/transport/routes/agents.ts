import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { RuntimeHost } from '@ujima/runtime-core';
import {
  ListAgentsResponseSchema,
} from '@ujima/api-schema';

export function registerAgentRoutes(_app: FastifyInstance, host: RuntimeHost): void {
  const app = _app.withTypeProvider<ZodTypeProvider>();

  app.get('/agents', {
    schema: {
      description: 'List all currently running agents',
      tags: ['Agents'],
      response: {
        200: ListAgentsResponseSchema,
      },
    },
  }, async () => {
    return { agents: host.listAgents().map(toAgentDto) };
  });
}

function toAgentDto(a: {
  agentId: string;
  taskId: string;
  sessionId: string;
  workspaceId: string;
  startedAt: number;
}) {
  return {
    agent_id: a.agentId,
    task_id: a.taskId,
    session_id: a.sessionId,
    workspace_id: a.workspaceId,
    started_at: a.startedAt,
  };
}
