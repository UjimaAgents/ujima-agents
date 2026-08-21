import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AuthService, AuthState } from '@ujima/orchestrator';
import type { Repository } from '@ujima/runtime-core';
import type { ZodTypeAny } from 'zod';
import { readSessionToken } from '../session-token.js';
import { apiError, HttpError, routeError, type RouteErrorOptions } from './route-errors.js';
import { assertReadyWorkspaceRoot } from './workspace-root.js';

export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

export type SettingsApp = ReturnType<FastifyInstance['withTypeProvider']>;

/**
 * Auth preamble for a route. The registry executes member resolution,
 * org-session checks, and 401/403 replies; handlers never see them.
 *
 * - `none` — no session check (routes behind the server-level bearer gate).
 * - `user` — any authenticated user; 401 `Unauthorized` (message overridable).
 * - `member` — authenticated user with a member record; 401 `Unauthorized`.
 * - `org-session` — authenticated member whose org matches the request's
 *   organizationId; 401 `Session required` / 403 `Unauthorized for this organization.`
 */
export type RouteAuth =
  | { kind: 'none' }
  | { kind: 'user'; unauthorizedMessage?: string }
  | { kind: 'member'; unauthorizedMessage?: string }
  | { kind: 'org-session'; organizationId: (req: FastifyRequest) => string };

export interface RouteSchemaSpec {
  description?: string;
  tags?: string[];
  querystring?: ZodTypeAny;
  params?: ZodTypeAny;
  body?: ZodTypeAny;
  response?: Record<number, ZodTypeAny>;
}

export interface RouteContext {
  reply: FastifyReply;
  /** Resolved organizationId — extracted for org-session routes, the session user's org otherwise. */
  organizationId: string;
  authState: AuthState;
  /**
   * The authenticated member's id. Non-null for `member` and `org-session`
   * auth (the registry's 401/403 guards guarantee it); empty string for
   * `user`/`none` auth, where handlers must not rely on membership.
   */
  memberId: string;
}

export interface RouteSpec {
  method: HttpMethod;
  path: string;
  auth: RouteAuth;
  schema?: RouteSchemaSpec;
  /** Assert workspace-root readiness BEFORE session auth (settings/runs pattern). */
  workspaceRoot?: boolean;
  /** Assert workspace-root readiness AFTER session auth (channel-member-modes pattern). */
  workspaceRootAfterAuth?: boolean;
  /** Reply status for successful handlers; e.g. 201/204. The body is empty. */
  successStatus?: number;
  /** Custom success serializer, e.g. a 200/502 conditional reply. */
  respond?: (reply: FastifyReply, result: unknown) => FastifyReply;
  /** Classify thrown errors via route-errors (fallback/notFound/forbidden/workspaceRoot...). */
  error?: RouteErrorOptions;
  /** Custom error mapper, e.g. a domain-specific classifier. */
  onError?: (reply: FastifyReply, err: unknown) => FastifyReply;
  /**
   * Throws or returns; the registry maps errors and sends successful results.
   *
   * `req` is typed permissively on purpose: schemas are validated by fastify
   * at runtime before the handler runs, and the registry executes them for
   * every route. Type-safety from schema inference (fastify-type-provider-zod)
   * is a larger generic-RouteSpec refactor; handlers cast `req.body`/`params`
   * where they need compile-time shapes.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (req: any, ctx: RouteContext) => unknown;
}

export interface RouteRegisterDeps {
  auth?: AuthService;
  repo?: Repository;
}

export function withTypeProvider(fastify: FastifyInstance): SettingsApp {
  return fastify.withTypeProvider<ZodTypeProvider>();
}

export function registerRoute(
  app: SettingsApp,
  spec: RouteSpec,
  deps: RouteRegisterDeps,
): void {
  const { auth } = deps;
  if (spec.auth.kind !== 'none' && !auth) {
    throw new Error(`route-registry: no auth service provided for ${spec.method.toUpperCase()} ${spec.path}`);
  }
  app[spec.method](spec.path, { schema: routeSchema(spec.schema) } as never, async (req, reply) => {
    try {
      const ctx = await resolveRouteContext(req, reply, spec, deps);
      if (isReply(ctx)) return ctx;
      const result = await spec.handler(req, ctx);
      if (isReply(result)) return result;
      if (reply.sent) return reply;
      if (spec.successStatus !== undefined) {
        return reply.status(spec.successStatus).send();
      }
      if (spec.respond) {
        return spec.respond(reply, result);
      }
      return result;
    } catch (err) {
      if (err instanceof HttpError) {
        return apiError(reply, err.status, err.message, err.code);
      }
      if (spec.onError) {
        return spec.onError(reply, err);
      }
      if (spec.error) {
        const mapped = routeError(reply, err, spec.error);
        if (mapped) return mapped;
      }
      throw err;
    }
  });
}

async function resolveRouteContext(
  req: FastifyRequest,
  reply: FastifyReply,
  spec: RouteSpec,
  deps: RouteRegisterDeps,
): Promise<RouteContext | FastifyReply> {
  const { auth } = deps;
  let organizationId = '';
  if (spec.auth.kind === 'org-session') {
    organizationId = spec.auth.organizationId(req);
  }
  if (spec.workspaceRoot && deps.repo) {
    assertReadyWorkspaceRoot(deps.repo, organizationId);
  }

  let authState: AuthState;
  let memberId = '';
  if (spec.auth.kind === 'none') {
    authState = {
      authenticated: false,
      user: null,
      member: null,
      session: null,
    };
  } else {
    if (!auth) {
      throw new Error(
        `route-registry: no auth service provided for ${spec.method.toUpperCase()} ${spec.path}`,
      );
    }
    authState = auth.getAuthState(readSessionToken(req));
    if (spec.auth.kind === 'org-session') {
      if (!authState.member) {
        return apiError(reply, 401, 'Session required');
      }
      if (authState.user?.organizationId !== organizationId) {
        return apiError(reply, 403, 'Unauthorized for this organization.');
      }
      memberId = authState.member.id;
    } else if (spec.auth.kind === 'member') {
      if (!authState.user || !authState.member) {
        return apiError(reply, 401, spec.auth.unauthorizedMessage ?? 'Unauthorized');
      }
      memberId = authState.member.id;
      organizationId = authState.user.organizationId;
    } else if (!authState.user) {
      return apiError(reply, 401, spec.auth.unauthorizedMessage ?? 'Unauthorized');
    } else {
      organizationId = authState.user.organizationId;
    }
  }

  if (spec.workspaceRootAfterAuth && deps.repo) {
    assertReadyWorkspaceRoot(deps.repo, organizationId);
  }

  return { reply, organizationId, authState, memberId };
}

function routeSchema(spec: RouteSchemaSpec | undefined): object | undefined {
  if (!spec) return undefined;
  const schema: Record<string, unknown> = {};
  if (spec.description !== undefined) schema.description = spec.description;
  if (spec.tags !== undefined) schema.tags = spec.tags;
  if (spec.querystring !== undefined) schema.querystring = spec.querystring;
  if (spec.params !== undefined) schema.params = spec.params;
  if (spec.body !== undefined) schema.body = spec.body;
  if (spec.response !== undefined) schema.response = spec.response;
  return schema;
}

function isReply(value: unknown): value is FastifyReply {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { send?: unknown }).send === 'function'
  );
}