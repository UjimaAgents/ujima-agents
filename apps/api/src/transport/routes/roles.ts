import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { RolePresetSchema, listRoleIndustries } from '@ujima/framework';
import { ApiErrorSchema } from '@ujima/api-schema';
import { z } from 'zod';
import { httpError } from './route-errors.js';
import {
  registerRoute,
  type RouteSpec,
} from './route-registry.js';

const IndustryParamsSchema = z.object({
  industry: z.string().min(1),
});
const RoleIndustryPresetSchema = RolePresetSchema.extend({
  industry: z.string().min(1),
  key: z.string().min(1),
});
const RoleIndustryCatalogSchema = z.object({
  industry: z.string().min(1),
  presets: z.array(RoleIndustryPresetSchema),
});
const RolePresetsResponseSchema = z.object({
  presets: z.array(RoleIndustryPresetSchema),
});
const RoleIndustriesResponseSchema = z.object({
  industries: z.array(RoleIndustryCatalogSchema),
});

export function registerRoleRoutes(_app: FastifyInstance): void {
  const app = _app.withTypeProvider<ZodTypeProvider>();

  const register = (spec: RouteSpec) => registerRoute(app, spec, {});

  register({
    method: 'get',
    path: '/roles/presets',
    auth: { kind: 'none' },
    schema: {
      description: 'List every preset role across all industries',
      tags: ['Roles'],
      response: {
        200: RolePresetsResponseSchema,
      },
    },
    handler: async () => {
      const industries = listRoleIndustries();
      return {
        presets: industries.flatMap((group) => group.presets),
      };
    },
  });

  register({
    method: 'get',
    path: '/roles/industries',
    auth: { kind: 'none' },
    schema: {
      description: 'List the available role industries and their presets',
      tags: ['Roles'],
      response: {
        200: RoleIndustriesResponseSchema,
      },
    },
    handler: async () => {
      return { industries: listRoleIndustries() };
    },
  });

  register({
    method: 'get',
    path: '/roles/industries/:industry',
    auth: { kind: 'none' },
    schema: {
      description: 'Get the presets for a single role industry',
      tags: ['Roles'],
      params: IndustryParamsSchema,
      response: {
        200: RoleIndustryCatalogSchema,
        404: ApiErrorSchema,
      },
    },
    handler: async (req) => {
      const industry = listRoleIndustries().find((entry) => entry.industry === req.params.industry);
      if (!industry) {
        throw httpError(404, `Unknown role industry "${req.params.industry}"`);
      }
      return industry;
    },
  });
}