import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { RolePresetSchema, listRoleIndustries } from '@ujima/framework';
import { ApiErrorSchema } from '@ujima/api-schema';
import { z } from 'zod';

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

  app.get('/roles/presets', {
    schema: {
      description: 'List every preset role across all industries',
      tags: ['Roles'],
      response: {
        200: RolePresetsResponseSchema,
      },
    },
  }, async () => {
    const industries = listRoleIndustries();
    return {
      presets: industries.flatMap((group) => group.presets),
    };
  });

  app.get('/roles/industries', {
    schema: {
      description: 'List the available role industries and their presets',
      tags: ['Roles'],
      response: {
        200: RoleIndustriesResponseSchema,
      },
    },
  }, async () => {
    return { industries: listRoleIndustries() };
  });

  app.get('/roles/industries/:industry', {
    schema: {
      description: 'Get the presets for a single role industry',
      tags: ['Roles'],
      params: IndustryParamsSchema,
      response: {
        200: RoleIndustryCatalogSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    const industry = listRoleIndustries().find((entry) => entry.industry === req.params.industry);
    if (!industry) {
      return reply.code(404).send({
        code: 'ERR_NOT_FOUND',
        message: `Unknown role industry "${req.params.industry}"`,
      });
    }
    return industry;
  });
}
