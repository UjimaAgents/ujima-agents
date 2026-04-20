import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { OrganizationSchema } from "@ujima/shared";
import { OrganizationQuerySchema, OrganizationSettingsQuerySchema, OrganizationSettingsUpdateSchema, ProviderSecretsUpsertSchema } from "../schemas.ts";
import { z } from "zod";

export default async function settingsRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/api/settings/team", {
    schema: {
      summary: "Get team settings",
      description: "Retrieve the global team configuration and presets.",
      tags: ["Settings"],
      response: {
        200: z.any(), // TeamConfig is complex, letting it be dynamic for now
        503: z.object({ error: z.string() }),
      },
    },
  }, async (_, reply) => {
    try {
      return fastify.services.settings.getTeamSettings();
    } catch (error) {
      return reply.code(503).send({ error: (error as Error).message });
    }
  });

  app.get("/api/settings/providers", {
    schema: {
      summary: "List providers",
      description: "Retrieve valid model providers and their current secret status.",
      tags: ["Settings"],
      querystring: OrganizationQuerySchema,
      response: {
        200: z.array(z.object({ name: z.string(), hasKey: z.boolean() })),
        400: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
        503: z.object({ error: z.string() }),
      },
    },
  }, async (request, reply) => {
    try {
      return fastify.services.settings.listProviders(request.query.organizationId);
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(message.startsWith("Organization not found") ? 404 : 503).send({ error: message });
    }
  });

  app.post("/api/settings/providers", {
    schema: {
      summary: "Update provider secrets",
      description: "Update the API secrets for model providers.",
      tags: ["Settings"],
      body: ProviderSecretsUpsertSchema,
      response: {
        200: z.object({ providers: z.array(z.any()) }),
        400: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
        503: z.object({ error: z.string() }),
      },
    },
  }, async (request, reply) => {
    try {
      return {
        providers: fastify.services.settings.upsertProviders(request.body.organizationId, request.body.providerKeys),
      };
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(message.startsWith("Organization not found") ? 404 : message.startsWith("Unknown provider keys") ? 400 : 503).send({ error: message });
    }
  });

  app.get("/api/settings/organization", {
    schema: {
      summary: "Get organization settings",
      description: "Retrieve settings and chart for a specific organization.",
      tags: ["Settings"],
      querystring: OrganizationSettingsQuerySchema,
      response: {
        200: OrganizationSchema,
        400: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
        503: z.object({ error: z.string() }),
      },
    },
  }, async (request, reply) => {
    try {
      return fastify.services.settings.getOrganizationSettings(request.query.organizationId);
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(message.startsWith("Organization not found") ? 404 : 503).send({ error: message });
    }
  });

  app.patch("/api/settings/organization", {
    schema: {
      summary: "Update organization settings",
      description: "Update metadata or the organization chart.",
      tags: ["Settings"],
      body: OrganizationSettingsUpdateSchema,
      response: {
        200: OrganizationSchema,
        400: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
      },
    },
  }, async (request, reply) => {
    try {
      return fastify.services.settings.updateOrganizationSettings(request.body);
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(message.startsWith("Organization not found") ? 404 : 400).send({ error: message });
    }
  });
}
