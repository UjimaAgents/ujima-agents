import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeAny } from 'zod';
import { ApiErrorSchema } from '@ujima/api-schema';
import type { AuthService } from '@ujima/orchestrator';
import { apiError, errorMessage } from './route-errors.js';
import {
  registerRoute,
  withTypeProvider,
  type RouteContext,
  type SettingsApp,
} from './route-registry.js';

export { withTypeProvider };
export type { RouteContext, SettingsApp };

export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

interface OrgRouteConfig {
  description: string;
  tags?: string[];
  querystring?: ZodTypeAny;
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  response: Record<number, ZodTypeAny>;
  organizationId: (req: FastifyRequest) => string;
  handler: (req: FastifyRequest, organizationId: string) => Promise<unknown>;
  errorStatus?: 404 | 503;
  successStatus?: number;
  onError?: (reply: FastifyReply, err: unknown) => FastifyReply;
  respond?: (reply: FastifyReply, result: unknown) => FastifyReply;
}

/**
 * Backward-compatible registration helper for settings-style routes. Each
 * call expands to a {@link RouteSpec} and rides the shared route registry,
 * which owns the org-session preamble and error mapping.
 */
export function registerOrgSettingsRoute(
  app: SettingsApp,
  method: HttpMethod,
  path: string,
  auth: AuthService,
  config: OrgRouteConfig,
): void {
  const successStatus = config.successStatus;
  registerRoute(app, {
    method,
    path,
    auth: { kind: 'org-session', organizationId: config.organizationId },
    schema: {
      description: config.description,
      tags: config.tags ?? ['Settings'],
      querystring: config.querystring,
      body: config.body,
      params: config.params,
      response: config.response,
    },
    respond: successStatus !== undefined
      ? (reply) => {
          reply.status(successStatus as number).send();
          return reply;
        }
      : config.respond,
    onError: config.onError ??
      ((reply, err) => apiError(reply, config.errorStatus ?? 404, errorMessage(err))),
    handler: (req, ctx: RouteContext) => config.handler(req, ctx.organizationId),
  }, { auth });
}

export const settingsAuthErrors = {
  401: ApiErrorSchema,
  403: ApiErrorSchema,
  404: ApiErrorSchema,
};

export const settingsServerErrors = {
  ...settingsAuthErrors,
  500: ApiErrorSchema,
};