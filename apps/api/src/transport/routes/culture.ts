import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiErrorSchema } from '@ujima/api-schema';
import { ProcedureRevisionSchema, ProcedureScopeSchema } from '@ujima/shared';
import type { ApiRepository, AuthService, ProcedureFile, ProcedureScope } from '@ujima/orchestrator';
import { isValidProcedureName, listProceduresByScope, removeProcedure, saveProcedure } from '@ujima/orchestrator';
import { apiError, errorMessage, workspaceRootError } from './route-errors.js';
import { readSessionToken } from '../session-token.js';
import { assertReadyWorkspaceRoot } from './workspace-root.js';

const ChannelIdParamsSchema = z.object({ id: z.string().min(1) });
const ChannelNameParamsSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2).max(64),
});
const OrgNameParamsSchema = z.object({ name: z.string().min(2).max(64) });
const OrgQuerySchema = z.object({ organizationId: z.string().min(1) });

const SaveBodySchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(2).max(64),
  description: z.string().min(1).max(200),
  body: z
    .string()
    .min(1)
    .max(8 * 1024),
  enforced: z.boolean().default(false),
});

const ProcedureSummarySchema = z.object({
  scope: ProcedureScopeSchema,
  scopeId: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.number().int().min(1),
  enforced: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});

const ProcedureDetailSchema = ProcedureSummarySchema.extend({
  body: z.string(),
  createdBy: z.string(),
});

const ListResponseSchema = z.object({
  procedures: z.array(ProcedureSummarySchema),
});
const DetailResponseSchema = z.object({ procedure: ProcedureDetailSchema });
const HistoryResponseSchema = z.object({
  revisions: z.array(ProcedureRevisionSchema),
});

function toSummary(p: ProcedureFile): z.infer<typeof ProcedureSummarySchema> {
  return {
    scope: p.scope,
    scopeId: p.scopeId,
    name: p.name,
    description: p.description,
    version: p.version,
    enforced: p.enforced,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    updatedBy: p.updatedBy,
  };
}

function toDetail(p: ProcedureFile): z.infer<typeof ProcedureDetailSchema> {
  return { ...toSummary(p), body: p.body, createdBy: p.createdBy };
}

export interface CultureRoutesOptions {
  repo: ApiRepository;
  auth: AuthService;
}

interface AuthCheckResult {
  ok: true;
  actor: string;
  workspaceRoot: string;
}
interface AuthCheckFailure {
  ok: false;
  status: number;
  code?: string;
  message: string;
}

type CultureReply = Parameters<typeof apiError>[0];

function checkAuthAndWorkspace(repo: ApiRepository, auth: AuthService, sessionToken: string | undefined, organizationId: string): AuthCheckResult | AuthCheckFailure {
  const authState = auth.getAuthState(sessionToken);
  if (!authState.member) return { ok: false, status: 401, message: 'Session required' };
  if (authState.user?.organizationId !== organizationId) {
    return {
      ok: false,
      status: 403,
      message: 'Unauthorized for this organization.',
    };
  }
  try {
    assertReadyWorkspaceRoot(repo, organizationId);
  } catch (err) {
    const code = (err as { code?: string }).code;
    return {
      ok: false,
      status: code ? 409 : 500,
      code,
      message: errorMessage(err),
    };
  }
  const org = repo.getOrganization(organizationId);
  const workspaceRoot = org?.workspace?.root ?? '';
  return { ok: true, actor: authState.member.id, workspaceRoot };
}

function authFailure(reply: CultureReply, check: AuthCheckFailure) {
  const handled = check.code ? workspaceRootError(reply, { code: check.code, message: check.message }) : null;
  return handled ?? apiError(reply, check.status, check.message);
}

export function registerCultureRoutes(fastify: FastifyInstance, options: CultureRoutesOptions): void {
  const { repo, auth } = options;
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  async function handleList(scope: ProcedureScope, scopeId: string, organizationId: string, sessionToken: string | undefined, reply: CultureReply) {
    const check = checkAuthAndWorkspace(repo, auth, sessionToken, organizationId);
    if (!check.ok) return authFailure(reply, check);
    const procedures = await listProceduresByScope(check.workspaceRoot, scope, scopeId);
    return { procedures: procedures.map(toSummary) };
  }

  async function handleRead(scope: ProcedureScope, scopeId: string, organizationId: string, name: string, sessionToken: string | undefined, reply: CultureReply) {
    const check = checkAuthAndWorkspace(repo, auth, sessionToken, organizationId);
    if (!check.ok) return authFailure(reply, check);
    const list = await listProceduresByScope(check.workspaceRoot, scope, scopeId);
    const hit = list.find((p) => p.name === name);
    if (!hit) return apiError(reply, 404, `procedure "${name}" not found`);
    return { procedure: toDetail(hit) };
  }

  async function handleRemove(scope: ProcedureScope, scopeId: string, organizationId: string, name: string, sessionToken: string | undefined, reply: CultureReply) {
    const check = checkAuthAndWorkspace(repo, auth, sessionToken, organizationId);
    if (!check.ok) return authFailure(reply, check);
    const removed = await removeProcedure(check.workspaceRoot, scope, scopeId, name);
    if (!removed) return apiError(reply, 404, `procedure "${name}" not found`);
    return { removed: true };
  }

  function handleHistory(scope: ProcedureScope, scopeId: string, organizationId: string, name: string, sessionToken: string | undefined, reply: CultureReply) {
    const check = checkAuthAndWorkspace(repo, auth, sessionToken, organizationId);
    if (!check.ok) return authFailure(reply, check);
    const revisions = repo.listProcedureRevisions?.({ organizationId, scope, scopeId, name }) ?? [];
    return { revisions };
  }

  app.get(
    '/org/culture',
    {
      schema: {
        description: 'List Workspace Culture procedures for the org.',
        tags: ['Culture'],
        querystring: OrgQuerySchema,
        response: {
          200: ListResponseSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
        },
      },
    },
    async (req, reply) => {
      return handleList('org', '', req.query.organizationId, readSessionToken(req), reply);
    },
  );

  app.get(
    '/channels/:id/culture',
    {
      schema: {
        description: 'List Channel Culture procedures for one channel.',
        tags: ['Culture'],
        params: ChannelIdParamsSchema,
        querystring: OrgQuerySchema,
        response: {
          200: ListResponseSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
        },
      },
    },
    async (req, reply) => {
      return handleList('channel', req.params.id, req.query.organizationId, readSessionToken(req), reply);
    },
  );

  app.get(
    '/org/culture/:name',
    {
      schema: {
        description: 'Read one Workspace Culture procedure (full body).',
        tags: ['Culture'],
        params: OrgNameParamsSchema,
        querystring: OrgQuerySchema,
        response: {
          200: DetailResponseSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema,
        },
      },
    },
    async (req, reply) => {
      return handleRead('org', '', req.query.organizationId, req.params.name, readSessionToken(req), reply);
    },
  );

  app.get(
    '/channels/:id/culture/:name',
    {
      schema: {
        description: 'Read one Channel Culture procedure (full body).',
        tags: ['Culture'],
        params: ChannelNameParamsSchema,
        querystring: OrgQuerySchema,
        response: {
          200: DetailResponseSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema,
        },
      },
    },
    async (req, reply) => {
      return handleRead('channel', req.params.id, req.query.organizationId, req.params.name, readSessionToken(req), reply);
    },
  );

  async function handleSave(scope: ProcedureScope, scopeId: string, organizationId: string, body: z.infer<typeof SaveBodySchema>, sessionToken: string | undefined, reply: Parameters<typeof apiError>[0]) {
    const check = checkAuthAndWorkspace(repo, auth, sessionToken, organizationId);
    if (!check.ok) return apiError(reply, check.status, check.message);
    if (!isValidProcedureName(body.name)) {
      return apiError(reply, 400, 'name must be lowercase letters/digits/hyphens (2-64 chars).');
    }
    if (body.enforced && scope !== 'org') {
      return apiError(reply, 400, 'enforced=true is only valid for org-scope procedures.');
    }
    try {
      const file = await saveProcedure({
        workspaceRoot: check.workspaceRoot,
        scope,
        scopeId,
        name: body.name,
        description: body.description,
        body: body.body,
        enforced: body.enforced,
        actor: check.actor,
      });
      repo.appendProcedureRevision?.({
        id: randomUUID(),
        organizationId,
        scope: file.scope,
        scopeId: file.scopeId,
        name: file.name,
        version: file.version,
        bodySnapshot: file.body,
        description: file.description,
        enforced: file.enforced,
        updatedBy: file.updatedBy,
        updatedAt: file.updatedAt,
      });
      return { procedure: toDetail(file) };
    } catch (err) {
      return apiError(reply, 400, errorMessage(err));
    }
  }

  app.post(
    '/org/culture',
    {
      schema: {
        description: 'Create or update a Workspace Culture procedure. Bumps version + appends a revision row.',
        tags: ['Culture'],
        body: SaveBodySchema,
        response: {
          200: DetailResponseSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
        },
      },
    },
    async (req, reply) => {
      return handleSave('org', '', req.body.organizationId, req.body, readSessionToken(req), reply);
    },
  );

  app.post(
    '/channels/:id/culture',
    {
      schema: {
        description: 'Create or update a Channel Culture procedure for one channel.',
        tags: ['Culture'],
        params: ChannelIdParamsSchema,
        body: SaveBodySchema,
        response: {
          200: DetailResponseSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
        },
      },
    },
    async (req, reply) => {
      return handleSave('channel', req.params.id, req.body.organizationId, req.body, readSessionToken(req), reply);
    },
  );

  const DeletedResponseSchema = z.object({ removed: z.boolean() });

  app.delete(
    '/org/culture/:name',
    {
      schema: {
        description: 'Remove a Workspace Culture procedure (revisions remain in history).',
        tags: ['Culture'],
        params: OrgNameParamsSchema,
        querystring: OrgQuerySchema,
        response: {
          200: DeletedResponseSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema,
        },
      },
    },
    async (req, reply) => {
      return handleRemove('org', '', req.query.organizationId, req.params.name, readSessionToken(req), reply);
    },
  );

  app.delete(
    '/channels/:id/culture/:name',
    {
      schema: {
        description: 'Remove a Channel Culture procedure (revisions remain in history).',
        tags: ['Culture'],
        params: ChannelNameParamsSchema,
        querystring: OrgQuerySchema,
        response: {
          200: DeletedResponseSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema,
        },
      },
    },
    async (req, reply) => {
      return handleRemove('channel', req.params.id, req.query.organizationId, req.params.name, readSessionToken(req), reply);
    },
  );

  app.get(
    '/org/culture/:name/history',
    {
      schema: {
        description: 'Newest-first version history for a Workspace Culture procedure.',
        tags: ['Culture'],
        params: OrgNameParamsSchema,
        querystring: OrgQuerySchema,
        response: { 200: HistoryResponseSchema, 401: ApiErrorSchema },
      },
    },
    async (req, reply) => {
      return handleHistory('org', '', req.query.organizationId, req.params.name, readSessionToken(req), reply);
    },
  );

  app.get(
    '/channels/:id/culture/:name/history',
    {
      schema: {
        description: 'Newest-first version history for a Channel Culture procedure.',
        tags: ['Culture'],
        params: ChannelNameParamsSchema,
        querystring: OrgQuerySchema,
        response: { 200: HistoryResponseSchema, 401: ApiErrorSchema },
      },
    },
    async (req, reply) => {
      return handleHistory('channel', req.params.id, req.query.organizationId, req.params.name, readSessionToken(req), reply);
    },
  );
}
