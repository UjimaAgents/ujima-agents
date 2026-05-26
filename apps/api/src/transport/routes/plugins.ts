import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ApiErrorSchema,
  PluginInstallRequestSchema,
  PluginInstallResponseSchema,
  SkillInvocationQuerySchema,
  SkillInvocationResponseSchema,
} from '@ujima/api-schema';
import { IdSchema } from '@ujima/shared';
import type { AuthService, PluginRegistryService } from '@ujima/orchestrator';
import {
  registerOrgSettingsRoute,
  settingsAuthErrors,
  withTypeProvider,
} from './org-settings-route.js';

export interface PluginRoutesOptions {
  auth: AuthService;
  pluginRegistry: PluginRegistryService;
}

const OrgQuerySchema = z.object({ organizationId: IdSchema });
const SkillParamsSchema = z.object({ skillId: IdSchema });

export function registerPluginRoutes(
  fastify: FastifyInstance,
  options: PluginRoutesOptions,
): void {
  const { auth, pluginRegistry } = options;
  const app = withTypeProvider(fastify);

  registerOrgSettingsRoute(app, 'post', '/settings/plugins/install', auth, {
    description: 'Install a skill from a Git repository URL',
    body: PluginInstallRequestSchema,
    response: {
      200: PluginInstallResponseSchema,
      ...settingsAuthErrors,
      503: ApiErrorSchema,
    },
    organizationId: (req) => (req.body as { organizationId: string }).organizationId,
    handler: async (req) => pluginRegistry.installFromUrl(req.body as never),
    errorStatus: 503,
  });

  registerOrgSettingsRoute(app, 'get', '/settings/skills/:skillId', auth, {
    description: 'Load a skill prompt payload on demand',
    params: SkillParamsSchema,
    querystring: SkillInvocationQuerySchema,
    response: { 200: SkillInvocationResponseSchema, ...settingsAuthErrors },
    organizationId: (req) => (req.query as { organizationId: string }).organizationId,
    handler: async (req, organizationId) =>
      pluginRegistry.getSkillInvocation(
        organizationId,
        (req.params as { skillId: string }).skillId,
        (req.query as { organizationId: string; arguments?: string }).arguments ?? '',
      ),
  });

  registerOrgSettingsRoute(app, 'delete', '/settings/skills/:skillId', auth, {
    description: 'Remove an installed skill',
    params: SkillParamsSchema,
    querystring: OrgQuerySchema,
    response: { 204: z.null(), ...settingsAuthErrors },
    organizationId: (req) => (req.query as { organizationId: string }).organizationId,
    handler: async (req, organizationId) => {
      pluginRegistry.deleteSkill(organizationId, (req.params as { skillId: string }).skillId);
    },
    successStatus: 204,
  });
}
