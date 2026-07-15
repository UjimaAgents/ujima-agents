import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
  listProceduresByScope,
} from '@ujima/orchestrator';
import {
  isSensitiveWorkspacePath,
  shouldSkipWorkspaceTreeDirectory,
} from '@ujima/shared';
import { readSessionToken } from '../session-token.js';
import { apiError, errorMessage } from './route-errors.js';

const workspaceAuthResponses = {
  401: ApiErrorSchema,
  403: ApiErrorSchema,
  503: ApiErrorSchema,
};
const assetSuggestionSchema = z.object({
  kind: z.enum(['task', 'culture', 'mcp', 'skill', 'workflow']),
  name: z.string(),
  id: z.string(),
  detail: z.string(),
});
const newestFirst = <T extends { createdAt: string }>(items: readonly T[]) =>
  [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

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

  function getOrganizationIdOrThrow(sessionToken: string | null | undefined): string {
    if (!auth) throw new Error('Auth service not configured');
    const authState = auth.getAuthState(sessionToken);
    if (!authState.authenticated || !authState.user) throw new Error('session required');
    return authState.user.organizationId;
  }

  function getWorkspaceRootOrThrow(sessionToken: string | null | undefined): string {
    const org = repo?.getOrganization(getOrganizationIdOrThrow(sessionToken));
    if (!org?.workspace?.root?.trim()) throw new Error('ERR_NO_WORKSPACE_ROOT');
    return org.workspace.root.trim();
  }

  function readWorkspaceDir(absPath: string): string[] {
    try {
      return readdirSync(absPath).sort();
    } catch {
      return [];
    }
  }

  function searchWorkspaceAssets(
    rootAbs: string,
    query: string,
    limit = 50,
  ): { kind: 'file' | 'folder'; name: string; path: string }[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];

    const results: { kind: 'file' | 'folder'; name: string; path: string }[] = [];

    function walk(dirRel: string, depth: number): void {
      if (depth > 10 || results.length >= limit) return;
      const absPath = dirRel ? join(rootAbs, dirRel) : rootAbs;
      const entries = readWorkspaceDir(absPath);

      for (const name of entries) {
        if (results.length >= limit) return;
        const childRel = dirRel ? `${dirRel}/${name}` : name;
        if (isSensitiveWorkspacePath(childRel)) continue;

        const childAbs = join(absPath, name);
        let stat: ReturnType<typeof statSync>;
        try {
          stat = statSync(childAbs);
        } catch {
          continue;
        }

        const matches =
          childRel.toLowerCase().includes(normalized) ||
          name.toLowerCase().includes(normalized);

        if (stat.isDirectory()) {
          if (shouldSkipWorkspaceTreeDirectory(name)) continue;
          if (matches) {
            results.push({ kind: 'folder', name, path: childRel });
          }
          walk(childRel, depth + 1);
        } else if (stat.isFile() && matches) {
          results.push({ kind: 'file', name, path: childRel });
        }
      }
    }

    walk('', 0);
    return results;
  }

  function listWorkspaceRootFolders(
    rootAbs: string,
    limit = 30,
  ): { kind: 'folder'; name: string; path: string }[] {
    const results: { kind: 'folder'; name: string; path: string }[] = [];

    for (const name of readWorkspaceDir(rootAbs)) {
      if (results.length >= limit) break;
      if (name.startsWith('.')) continue;
      if (isSensitiveWorkspacePath(name)) continue;

      const childAbs = join(rootAbs, name);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(childAbs);
      } catch {
        continue;
      }
      if (!stat.isDirectory() || shouldSkipWorkspaceTreeDirectory(name)) continue;
      results.push({ kind: 'folder', name, path: name });
    }

    return results;
  }

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
      body: z.union([DuplicateWorkspaceRequestSchema, CreateWorkspaceRequestSchema]),
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

  app.get('/workspaces/search', {
    schema: {
      description: 'Search workspace files by name/path fragment for asset tagging autocomplete',
      tags: ['Workspaces'],
      querystring: z.object({
        q: z.string().optional(),
      }),
      response: {
        200: z.array(z.object({
          kind: z.enum(['file', 'folder']),
          name: z.string(),
          path: z.string(),
        })),
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
      const root = getWorkspaceRootOrThrow(readSessionToken(req));
      const query = (req.query.q ?? '').trim().replace(/^(file|folder|mcp|skill|task|culture):/i, '').trim();
      if (!query) {
        return listWorkspaceRootFolders(root);
      }
      return searchWorkspaceAssets(root, query);
    } catch (err) {
      const message = errorMessage(err);
      if (/session required/i.test(message)) {
        return apiError(reply, 401, message);
      }
      if (/ERR_NO_WORKSPACE_ROOT/.test(message)) {
        return apiError(reply, 400, message);
      }
      return apiError(reply, 400, message);
    }
  });

  app.get('/workspaces/assets', {
    schema: {
      description: 'List named assets for autocomplete',
      tags: ['Workspaces'],
      response: { 200: z.array(assetSuggestionSchema), ...workspaceAuthResponses },
    },
  }, async (req, reply) => {
    if (!auth || !repo) {
      return reply.status(503).send({
        code: 'ERR_SHUTTING_DOWN',
        message: 'Workspace routes are not configured',
      });
    }
    try {
      const token = readSessionToken(req);
      const orgId = getOrganizationIdOrThrow(token);
      const goals = new Map(repo.listGoals(orgId).map((goal) => [goal.id, goal.title]));
      const procedures = await listProceduresByScope(getWorkspaceRootOrThrow(token), 'org', '');
      return [
        ...repo.listGoalTasksByOrganization(orgId).map((task) => ({
          kind: 'task' as const, name: task.title, id: task.id, detail: goals.get(task.goalId) ?? '',
        })),
        ...procedures.map((procedure) => ({
          kind: 'culture' as const, name: procedure.name, id: procedure.name, detail: procedure.description,
        })),
        ...newestFirst(mcpRegistry?.list(orgId) ?? []).map((mcp) => ({
          kind: 'mcp' as const, name: mcp.name, id: mcp.id, detail: mcp.name,
        })),
        ...newestFirst(repo.listOrganizationSkillInstalls(orgId)).map((skill) => ({
          kind: 'skill' as const, name: skill.skillName, id: skill.id, detail: skill.pluginName,
        })),
        ...repo.listWorkflowDefinitions(orgId).map((wf) => ({
          kind: 'workflow' as const, name: wf.name, id: wf.id, detail: wf.description ?? '',
        })),
      ];
    } catch (err) {
      const message = errorMessage(err);
      return apiError(reply, /session required/i.test(message) ? 401 : 400, message);
    }
  });
}

function basenameFromPath(rootPath: string): string {
  const parts = rootPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? rootPath;
}
