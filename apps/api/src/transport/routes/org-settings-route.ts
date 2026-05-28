import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ZodTypeAny } from 'zod';
import { ApiErrorSchema } from '@ujima/api-schema';
import type { AuthService } from '@ujima/orchestrator';
import { requireOrgSession } from './org-auth.js';
import { apiError } from './route-errors.js';

type SettingsApp = ReturnType<FastifyInstance['withTypeProvider']>;
type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

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

function settingsError(reply: FastifyReply, err: unknown, status: 404 | 503): FastifyReply {
  return apiError(reply, status, err instanceof Error ? err.message : String(err));
}

export function registerOrgSettingsRoute(
  app: SettingsApp,
  method: HttpMethod,
  path: string,
  auth: AuthService,
  config: OrgRouteConfig,
): void {
  app[method](path, {
    schema: {
      description: config.description,
      tags: config.tags ?? ['Settings'],
      ...(config.querystring ? { querystring: config.querystring } : {}),
      ...(config.body ? { body: config.body } : {}),
      ...(config.params ? { params: config.params } : {}),
      response: config.response,
    },
  }, async (req, reply) => {
    try {
      const organizationId = config.organizationId(req);
      const forbidden = requireOrgSession(auth, req, reply, organizationId);
      if (forbidden) return forbidden;
      const result = await config.handler(req, organizationId);
      if (config.successStatus) {
        return reply.status(config.successStatus).send();
      }
      if (config.respond) {
        return config.respond(reply, result);
      }
      return result;
    } catch (err) {
      if (config.onError) {
        return config.onError(reply, err);
      }
      return settingsError(reply, err, config.errorStatus ?? 404);
    }
  });
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

export function withTypeProvider(fastify: FastifyInstance): SettingsApp {
  return fastify.withTypeProvider<ZodTypeProvider>();
}
