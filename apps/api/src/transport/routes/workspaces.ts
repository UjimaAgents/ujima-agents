import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { syncWorkspacesFromOrganizations, type Repository, type RuntimeHost } from '@ujima/runtime-core';
import type { Organization } from '@ujima/shared';
import {
  ActivateWorkspaceResponseSchema,
  CreateWorkspaceRequestSchema,
  ApiErrorSchema,
  ListWorkspacesResponseSchema,
  UpdateWorkspaceRequestSchema,
  WorkspaceSchema,
} from '@ujima/api-schema';
import type { AuthService, SettingsService } from '@ujima/orchestrator';
import { ACTIVE_WORKSPACE_SETTING_KEY } from '@ujima/orchestrator';
import { z } from 'zod';
import { requireOrgSession } from './org-auth.js';
import { readSessionToken } from '../session-token.js';
import { apiError, errorMessage } from './route-errors.js';

const ORGANIZATION_WORKSPACE_IDS_KEY = 'organization_workspace_ids';

const WorkspaceIdParamsSchema = z.object({ id: z.string().min(1) });
const WorkspaceRemovedResponseSchema = z.object({ removed: z.boolean() });
const workspaceAuthResponses = {
  401: ApiErrorSchema,
  403: ApiErrorSchema,
  503: ApiErrorSchema,
};

export interface WorkspaceRoutesOptions {
  host: RuntimeHost;
  repo?: Repository;
  auth?: AuthService;
  settings?: SettingsService;
}

interface WorkspaceOrgSession {
  organizationId: string;
  organization: Organization;
  repo: Repository;
}

export function registerWorkspaceRoutes(
  _app: FastifyInstance,
  options: WorkspaceRoutesOptions,
): void {
  const { host, repo, auth, settings } = options;
  const app = _app.withTypeProvider<ZodTypeProvider>();

  app.get('/workspaces', {
    schema: {
      description: 'List workspaces for the authenticated organization',
      tags: ['Workspaces'],
      response: {
        200: ListWorkspacesResponseSchema,
        ...workspaceAuthResponses,
      },
    },
  }, async (req, reply) => {
    const session = requireWorkspaceOrgSession({ auth, repo }, req, reply);
    if (!isWorkspaceOrgSession(session)) return session;

    syncWorkspacesFromOrganizations(host.workspaces, [session.organization]);
    const defaultWorkspaceId = `ws_${session.organization.id}`;
    if (host.workspaces.get(defaultWorkspaceId)) {
      linkWorkspaceToOrganization(session.repo, session.organization.id, defaultWorkspaceId);
    }
    const current = resolveCurrentWorkspace(session.organization, host, session.repo);

    return {
      current_root_path: current.root,
      current_workspace_id: current.id,
      workspaces: listWorkspacesForOrganization(host, session.repo, session.organization, current.id).map((ws) => ({
        ...toWorkspaceDto(ws),
        is_current: current.id !== null && ws.id === current.id,
      })),
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
        ...workspaceAuthResponses,
      },
    },
  }, async (req, reply) => {
    const session = requireWorkspaceOrgSession({ auth, repo }, req, reply);
    if (!isWorkspaceOrgSession(session)) return session;

    const workspace = host.workspaces.create(req.body);
    linkWorkspaceToOrganization(session.repo, session.organizationId, workspace.id);
    return toWorkspaceDto(workspace);
  });

  app.post('/workspaces/:id/activate', {
    schema: {
      description: 'Switch the active workspace for the current organization',
      tags: ['Workspaces'],
      params: WorkspaceIdParamsSchema,
      response: {
        200: ActivateWorkspaceResponseSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
        ...workspaceAuthResponses,
      },
    },
  }, async (req, reply) => {
    if (!settings) {
      return replyError(reply, 503, 'ERR_UNAVAILABLE', 'Workspace activation is not configured');
    }

    const session = requireWorkspaceOrgSession({ auth, repo }, req, reply);
    if (!isWorkspaceOrgSession(session)) return session;

    const { organizationId } = session;
    if (!workspaceAccessibleToOrganization(host, session.repo, session.organization, req.params.id)) {
      return replyError(reply, 404, 'ERR_NOT_FOUND', `workspace "${req.params.id}" not found`);
    }

    try {
      const teamSettings = settings.activateWorkspace(
        { organizationId, workspaceId: req.params.id },
        host.workspaces,
      );
      const workspace = host.workspaces.get(req.params.id);
      if (!workspace) {
        return replyError(reply, 404, 'ERR_NOT_FOUND', `workspace "${req.params.id}" not found`);
      }
      return {
        workspace: toWorkspaceDto(workspace),
        workspaceRoot: teamSettings.workspace.root,
      };
    } catch (err) {
      const message = errorMessage(err);
      const status = message.includes('not found') ? 404 : 400;
      return replyError(reply, status, status === 404 ? 'ERR_NOT_FOUND' : 'ERR_BAD_REQUEST', message);
    }
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
        ...workspaceAuthResponses,
      },
    },
  }, async (req, reply) => {
    const session = requireWorkspaceOrgSession({ auth, repo }, req, reply);
    if (!isWorkspaceOrgSession(session)) return session;

    const { id } = req.params;
    if (!workspaceAccessibleToOrganization(host, session.repo, session.organization, id)) {
      return replyError(reply, 404, 'ERR_NOT_FOUND', `workspace "${id}" not found`);
    }
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
        ...workspaceAuthResponses,
      },
    },
  }, async (req, reply) => {
    const session = requireWorkspaceOrgSession({ auth, repo }, req, reply);
    if (!isWorkspaceOrgSession(session)) return session;

    const { id } = req.params;
    if (!workspaceAccessibleToOrganization(host, session.repo, session.organization, id)) {
      return replyError(reply, 404, 'ERR_NOT_FOUND', `workspace "${id}" not found`);
    }
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
        404: ApiErrorSchema,
        ...workspaceAuthResponses,
      },
    },
  }, async (req, reply) => {
    const session = requireWorkspaceOrgSession({ auth, repo }, req, reply);
    if (!isWorkspaceOrgSession(session)) return session;

    const { id } = req.params;
    if (!workspaceAccessibleToOrganization(host, session.repo, session.organization, id)) {
      return replyError(reply, 404, 'ERR_NOT_FOUND', `workspace "${id}" not found`);
    }

    const linkedIds = readLinkedWorkspaceIds(session.repo, session.organization.id);
    if (linkedIds.delete(id)) {
      if (linkedIds.size > 0) {
        session.repo.saveWorkspaceSetting(
          session.organization.id,
          ORGANIZATION_WORKSPACE_IDS_KEY,
          JSON.stringify([...linkedIds]),
        );
      } else {
        session.repo.deleteWorkspaceSetting(session.organization.id, ORGANIZATION_WORKSPACE_IDS_KEY);
      }
    }

    const activeId = session.repo.getWorkspaceSetting(session.organization.id, ACTIVE_WORKSPACE_SETTING_KEY);
    if (activeId === id) {
      session.repo.deleteWorkspaceSetting(session.organization.id, ACTIVE_WORKSPACE_SETTING_KEY);
    }

    return { removed: host.workspaces.remove(id) };
  });
}

function isWorkspaceOrgSession(
  value: WorkspaceOrgSession | FastifyReply,
): value is WorkspaceOrgSession {
  return 'organization' in value;
}

function requireWorkspaceOrgSession(
  deps: { auth?: AuthService; repo?: Repository },
  req: FastifyRequest,
  reply: FastifyReply,
): WorkspaceOrgSession | FastifyReply {
  const { auth, repo } = deps;
  if (!auth || !repo) {
    return replyError(reply, 503, 'ERR_UNAVAILABLE', 'Workspace routes are not configured');
  }

  const authState = auth.getAuthState(readSessionToken(req));
  const organizationId = authState.user?.organizationId;
  if (!organizationId) {
    return replyError(reply, 401, 'ERR_UNAUTHORIZED', 'Session required');
  }

  const forbidden = requireOrgSession(auth, req, reply, organizationId);
  if (forbidden) return forbidden;

  const organization = repo.getOrganization(organizationId);
  if (!organization) {
    return replyError(reply, 404, 'ERR_NOT_FOUND', 'Organization not found');
  }

  return { organizationId, organization, repo };
}

function readLinkedWorkspaceIds(repo: Repository, organizationId: string): Set<string> {
  const raw = repo.getWorkspaceSetting(organizationId, ORGANIZATION_WORKSPACE_IDS_KEY);
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
  } catch {
    return new Set();
  }
}

function linkWorkspaceToOrganization(
  repo: Repository,
  organizationId: string,
  workspaceId: string,
): void {
  const ids = readLinkedWorkspaceIds(repo, organizationId);
  if (ids.has(workspaceId)) return;
  ids.add(workspaceId);
  repo.saveWorkspaceSetting(organizationId, ORGANIZATION_WORKSPACE_IDS_KEY, JSON.stringify([...ids]));
}

function listWorkspacesForOrganization(
  host: RuntimeHost,
  repo: Repository,
  organization: Organization,
  activeWorkspaceId: string | null,
) {
  const linkedIds = readLinkedWorkspaceIds(repo, organization.id);
  const activeId =
    repo.getWorkspaceSetting(organization.id, ACTIVE_WORKSPACE_SETTING_KEY) ?? activeWorkspaceId;

  return host.workspaces.list().filter((workspace) => {
    if (linkedIds.has(workspace.id)) return true;
    if (activeId && workspace.id === activeId) return true;
    if (workspace.id === `ws_${organization.id}`) return true;
    return false;
  });
}

function workspaceAccessibleToOrganization(
  host: RuntimeHost,
  repo: Repository,
  organization: Organization,
  workspaceId: string,
): boolean {
  const activeId = repo.getWorkspaceSetting(organization.id, ACTIVE_WORKSPACE_SETTING_KEY);
  return listWorkspacesForOrganization(host, repo, organization, activeId).some((ws) => ws.id === workspaceId);
}

function resolveCurrentWorkspace(
  organization: Organization,
  host: RuntimeHost,
  repo?: Repository,
): { root: string | null; id: string | null } {
  const activeId = repo?.getWorkspaceSetting(organization.id, ACTIVE_WORKSPACE_SETTING_KEY) ?? null;
  if (activeId) {
    const active = host.workspaces.get(activeId);
    if (active?.root_path) {
      return { root: active.root_path, id: active.id };
    }
  }

  const current = host.workspaces.get(`ws_${organization.id}`);
  if (current?.root_path) {
    return { root: current.root_path, id: current.id };
  }

  return {
    root: organization.workspace.root ?? null,
    id: activeId,
  };
}

function toWorkspaceDto(ws: { id: string; root_path: string | null; label: string | null; created_at: number; updated_at: number }) {
  return { ...ws };
}

function replyError(reply: FastifyReply, status: number, code: string, message: string): FastifyReply {
  return reply.status(status).send({ code, message });
}
