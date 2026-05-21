import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { syncWorkspacesFromOrganizations, type RuntimeHost } from '@ujima/runtime-core';
import {
  ApiErrorSchema,
  CreateWorkspaceRequestSchema,
  ListWorkspacesResponseSchema,
  WorkspaceListItemSchema,
} from '@ujima/api-schema';
import {
  organizationIdFromWorkspaceId,
  type AuthService,
  type WorkspaceService,
} from '@ujima/orchestrator';
import type { Repository } from '@ujima/runtime-core';
import { readSessionToken } from '../session-token.js';
import { apiError, errorMessage } from './route-errors.js';

const workspaceAuthResponses = {
  401: ApiErrorSchema,
  403: ApiErrorSchema,
  503: ApiErrorSchema,
};

export interface WorkspaceRoutesOptions {
  host: RuntimeHost;
  repo?: Repository;
  auth?: AuthService;
  workspaces?: WorkspaceService;
}

export function registerWorkspaceRoutes(
  _app: FastifyInstance,
  options: WorkspaceRoutesOptions,
): void {
  const { host, repo, auth, workspaces } = options;
  const app = _app.withTypeProvider<ZodTypeProvider>();

  app.get('/workspaces', {
    schema: {
      description:
        'List workspaces accessible to the session (one workspace per organization)',
      tags: ['Workspaces'],
      response: {
        200: ListWorkspacesResponseSchema,
        ...workspaceAuthResponses,
      },
    },
  }, async (req, reply) => {
    if (!auth || !workspaces) {
      return reply.status(503).send({
        code: 'ERR_UNAVAILABLE',
        message: 'Workspace routes are not configured',
      });
    }

    try {
      const organizations = auth.listAccessibleOrganizations(readSessionToken(req));
      syncWorkspacesFromOrganizations(host.workspaces, organizations);
      return workspaces.listAccessible(readSessionToken(req));
    } catch (err) {
      const message = errorMessage(err);
      if (/session required/i.test(message)) {
        return apiError(reply, 401, message);
      }
      return apiError(reply, 400, message);
    }
  });

  app.post('/workspaces', {
    schema: {
      description:
        'Create a new workspace (new organization with its own project folder)',
      tags: ['Workspaces'],
      body: CreateWorkspaceRequestSchema,
      response: {
        200: WorkspaceListItemSchema,
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        503: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    if (!auth || !workspaces) {
      return reply.status(503).send({
        code: 'ERR_UNAVAILABLE',
        message: 'Workspace routes are not configured',
      });
    }

    try {
      const body = req.body;
      const organizationName =
        body.label?.trim() ||
        (body.root_path ? basenameFromPath(body.root_path) : '') ||
        'Workspace';
      const workspaceRoot = body.root_path?.trim();
      if (!workspaceRoot) {
        return apiError(reply, 400, 'project folder (root_path) is required');
      }

      const created = workspaces.createWorkspace(readSessionToken(req), {
        organizationName,
        workspaceRoot,
      });

      const organizationId = organizationIdFromWorkspaceId(created.id);
      const organization =
        organizationId && repo ? repo.getOrganization(organizationId) : null;
      if (!organization) {
        return apiError(reply, 500, 'workspace was created but organization record is missing');
      }

      syncWorkspacesFromOrganizations(host.workspaces, [organization]);
      const row = host.workspaces.get(created.id);
      if (!row) {
        return apiError(reply, 500, 'workspace catalog row was not created');
      }

      return { ...row, label: organization.name, is_current: false };
    } catch (err) {
      const message = errorMessage(err);
      if (/session required/i.test(message)) {
        return apiError(reply, 401, message);
      }
      return apiError(reply, 400, message);
    }
  });
}

function basenameFromPath(rootPath: string): string {
  const parts = rootPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? rootPath;
}
