import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { RuntimeHost } from '@ujima/runtime-core';
import {
  CreateWorkspaceRequestSchema,
  ListWorkspacesResponseSchema,
  WorkspaceSchema,
  ApiErrorSchema,
} from '@ujima/api-schema';
import { z } from 'zod';

export function registerWorkspaceRoutes(_app: FastifyInstance, host: RuntimeHost): void {
  const app = _app.withTypeProvider<ZodTypeProvider>();

  app.get('/workspaces', {
    schema: {
      description: 'List all available workspaces',
      tags: ['Workspaces'],
      response: {
        200: ListWorkspacesResponseSchema,
      },
    },
  }, async () => {
    return {
      workspaces: host.workspaces.list().map(toWorkspaceDto),
    };
  });

  app.post('/workspaces', {
    schema: {
      description: 'Create a new workspace',
      tags: ['Workspaces'],
      body: CreateWorkspaceRequestSchema,
      response: {
        200: WorkspaceSchema,
        400: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    const ws = host.workspaces.create(req.body);
    return toWorkspaceDto(ws);
  });

  app.get('/workspaces/:id', {
    schema: {
      description: 'Get workspace details by ID',
      tags: ['Workspaces'],
      params: z.object({ id: z.string() }),
      response: {
        200: WorkspaceSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    const { id } = req.params;
    const ws = host.workspaces.get(id);
    if (!ws) return replyError(reply, 404, 'ERR_NOT_FOUND', `workspace "${id}" not found`);
    return toWorkspaceDto(ws);
  });
}

function toWorkspaceDto(ws: { id: string; root_path: string | null; label: string | null; created_at: number; updated_at: number }) {
  return { ...ws };
}

function replyError(reply: FastifyReply, status: number, code: string, message: string): FastifyReply {
  return reply.status(status).send({ code, message });
}
