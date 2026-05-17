import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { RuntimeHost } from '@ujima/runtime-core';
import {
  CreateWorkspaceRequestSchema,
  ApiErrorSchema,
  ListWorkspacesResponseSchema,
  UpdateWorkspaceRequestSchema,
  WorkspaceSchema,
} from '@ujima/api-schema';
import { z } from 'zod';
import { apiError, errorMessage } from './route-errors.js';

const WorkspaceIdParamsSchema = z.object({ id: z.string().min(1) });
const WorkspaceRemovedResponseSchema = z.object({ removed: z.boolean() });

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
  }, async (req) => {
    const ws = host.workspaces.create(req.body);
    return toWorkspaceDto(ws);
  });

  app.put('/workspaces/:id', {
    schema: {
      description: 'Update a workspace',
      tags: ['Workspaces'],
      params: WorkspaceIdParamsSchema,
      body: UpdateWorkspaceRequestSchema,
      response: {
        200: WorkspaceSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    const { id } = req.params;
    try {
      return toWorkspaceDto(host.workspaces.update(id, req.body));
    } catch (err) {
      return apiError(reply, 404, errorMessage(err));
    }
  });

  app.get('/workspaces/:id', {
    schema: {
      description: 'Get workspace details by ID',
      tags: ['Workspaces'],
      params: WorkspaceIdParamsSchema,
      response: {
        200: WorkspaceSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    const { id } = req.params;
    const ws = host.workspaces.get(id);
    if (!ws) return apiError(reply, 404, `workspace "${id}" not found`);
    return toWorkspaceDto(ws);
  });

  app.delete('/workspaces/:id', {
    schema: {
      description: 'Delete a workspace',
      tags: ['Workspaces'],
      params: WorkspaceIdParamsSchema,
      response: {
        200: WorkspaceRemovedResponseSchema,
      },
    },
  }, async (req) => {
    const { id } = req.params;
    return { removed: host.workspaces.remove(id) };
  });
}

function toWorkspaceDto(ws: { id: string; root_path: string | null; label: string | null; created_at: number; updated_at: number }) {
  return { ...ws };
}
