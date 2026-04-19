import type { FastifyInstance } from "fastify";
import { OrganizationQuerySchema, OrganizationSettingsQuerySchema, OrganizationSettingsUpdateSchema, ProviderSecretsUpsertSchema } from "../schemas.ts";

export default async function settingsRoutes(fastify: FastifyInstance) {
  fastify.get("/api/settings/team", async (_, reply) => {
    try {
      return fastify.services.settings.getTeamSettings();
    } catch (error) {
      return reply.code(503).send({ error: (error as Error).message });
    }
  });

  fastify.get("/api/settings/providers", async (request, reply) => {
    const query = OrganizationQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: "organizationId is required" });
    }

    try {
      return fastify.services.settings.listProviders(query.data.organizationId);
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(message.startsWith("Organization not found") ? 404 : 503).send({ error: message });
    }
  });

  fastify.post("/api/settings/providers", async (request, reply) => {
    const body = ProviderSecretsUpsertSchema.parse(request.body);
    try {
      return {
        providers: fastify.services.settings.upsertProviders(body.organizationId, body.providerKeys),
      };
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(message.startsWith("Organization not found") ? 404 : message.startsWith("Unknown provider keys") ? 400 : 503).send({ error: message });
    }
  });

  fastify.get("/api/settings/organization", async (request, reply) => {
    const query = OrganizationSettingsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: "organizationId is required" });
    }

    try {
      return fastify.services.settings.getOrganizationSettings(query.data.organizationId);
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(message.startsWith("Organization not found") ? 404 : 503).send({ error: message });
    }
  });

  fastify.patch("/api/settings/organization", async (request, reply) => {
    const body = OrganizationSettingsUpdateSchema.parse(request.body);

    try {
      return fastify.services.settings.updateOrganizationSettings({
        organizationId: body.organizationId,
        organizationName: body.organizationName,
        organizationChart: body.organizationChart,
      });
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(message.startsWith("Organization not found") ? 404 : 400).send({ error: message });
    }
  });
}
