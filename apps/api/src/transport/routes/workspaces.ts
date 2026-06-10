import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { syncWorkspacesFromOrganizations, type RuntimeHost } from '@ujima/runtime-core';
import {
  ApiErrorSchema,
  CreateWorkspaceRequestSchema,
  DuplicateWorkspaceRequestSchema,
  ListWorkspacesResponseSchema,
  WorkspaceListItemSchema,
  WorkspaceSuggestionsResponseSchema,
} from '@ujima/api-schema';
import {
  type ApiRepository,
  type AuthService,
  type WorkspaceService,
  type McpRegistryService,
} from '@ujima/orchestrator';
import { readSessionToken } from '../session-token.js';
import { apiError, errorMessage } from './route-errors.js';

const workspaceAuthResponses = {
  401: ApiErrorSchema,
  403: ApiErrorSchema,
  503: ApiErrorSchema,
};

export interface WorkspaceRoutesOptions {
  host: RuntimeHost;
  auth?: AuthService;
  workspaces?: WorkspaceService;
  mcpRegistry?: McpRegistryService;
  repo?: ApiRepository;
}

export function registerWorkspaceRoutes(
  _app: FastifyInstance,
  options: WorkspaceRoutesOptions,
): void {
  const { host, auth, workspaces, mcpRegistry, repo } = options;
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
        code: 'ERR_SHUTTING_DOWN',
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
        'Create a new workspace or duplicate an existing one',
      tags: ['Workspaces'],
      body: z.union([CreateWorkspaceRequestSchema, DuplicateWorkspaceRequestSchema]),
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
        code: 'ERR_SHUTTING_DOWN',
        message: 'Workspace routes are not configured',
      });
    }

    try {
      const body = req.body;
      const isDuplicate = 'source_workspace_id' in body;

      if (isDuplicate) {
        const duplicateBody = body as z.infer<typeof DuplicateWorkspaceRequestSchema>;
        const { copy_options } = duplicateBody;
        const created = workspaces.duplicateWorkspace(readSessionToken(req), {
          sourceWorkspaceId: duplicateBody.source_workspace_id,
          organizationName: duplicateBody.label,
          workspaceRoot: duplicateBody.root_path,
          copyOptions: {
            providerKeys: copy_options.provider_keys,
            providerConfigs: copy_options.provider_configs,
            agents: copy_options.agents,
            roles: copy_options.roles,
            channels: copy_options.channels,
            tools: copy_options.tools,
            policies: copy_options.policies,
            orgChart: copy_options.org_chart,
          },
        });
        const row = host.workspaces.get(created.id);
        if (!row) {
          return apiError(reply, 500, 'workspace catalog row was not created');
        }
        return { ...row, is_current: false };
      }

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
        copyProviderKeys: body.copy_providers,
      });
      const row = host.workspaces.get(created.id);
      if (!row) {
        return apiError(reply, 500, 'workspace catalog row was not created');
      }

      return { ...row, is_current: false };
    } catch (err) {
      const message = errorMessage(err);
      if (/session required/i.test(message)) {
        return apiError(reply, 401, message);
      }
      return apiError(reply, 400, message);
    }
  });

  app.get('/workspaces/suggestions', {
    schema: {
      description:
        'Aggregate MCP servers, plugins, and skills from all accessible workspaces except the current one',
      tags: ['Workspaces'],
      response: {
        200: WorkspaceSuggestionsResponseSchema,
        ...workspaceAuthResponses,
      },
    },
  }, async (req, reply) => {
    if (!auth || !workspaces || !mcpRegistry || !repo) {
      return reply.status(503).send({
        code: 'ERR_SHUTTING_DOWN',
        message: 'Workspace routes are not configured',
      });
    }

    try {
      const sessionToken = readSessionToken(req);
      const authState = auth.getAuthState(sessionToken);
      if (!authState.authenticated || !authState.user) {
        return apiError(reply, 401, 'session required');
      }

      const currentOrgId = authState.user.organizationId;
      const orgs = auth.listAccessibleOrganizations(sessionToken);

      const workspacesData = orgs
        .filter((org) => org.id !== currentOrgId)
        .map((org) => {
          const mcps = mcpRegistry.list(org.id);
          const pluginInstalls = repo.listPluginInstalls(org.id);
          const skillInstalls = repo.listOrganizationSkillInstalls(org.id);

          const sortedMcps = [...mcps].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );
          const sortedPlugins = [...pluginInstalls].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );
          const sortedSkills = [...skillInstalls].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );

          return {
            id: org.id,
            name: org.name,
            mcps: sortedMcps,
            pluginInstalls: sortedPlugins,
            skillInstalls: sortedSkills,
          };
        });

      return { workspaces: workspacesData };
    } catch (err) {
      const message = errorMessage(err);
      if (/session required/i.test(message)) {
        return apiError(reply, 401, message);
      }
      return apiError(reply, 400, message);
    }
  });

  app.delete('/workspaces/:workspaceId', {
    schema: {
      description: 'Delete an existing workspace',
      tags: ['Workspaces'],
      params: z.object({
        workspaceId: z.string().min(1),
      }),
      response: {
        200: z.object({ success: z.literal(true) }),
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        503: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    if (!auth || !workspaces) {
      return reply.status(503).send({
        code: 'ERR_SHUTTING_DOWN',
        message: 'Workspace routes are not configured',
      });
    }

    try {
      const { workspaceId } = req.params;
      workspaces.deleteWorkspace(readSessionToken(req), workspaceId);
      return { success: true } as const;
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
