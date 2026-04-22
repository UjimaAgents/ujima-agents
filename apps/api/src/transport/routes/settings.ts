import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  AddMemberRequestSchema,
  OrganizationQuerySchema,
  OrganizationSettingsQuerySchema,
  OrganizationSettingsUpdateSchema,
  ProviderSecretsUpsertSchema,
} from '@ujima/api-schema';
import { IdSchema } from '@ujima/shared';
import type { SettingsService } from '@ujima/orchestrator';
import { z } from 'zod';

const OrgIdParamsSchema = z.object({ orgId: IdSchema });
const ProviderTestParamsSchema = z.object({ providerName: z.string().min(1) });

export interface SettingsRoutesOptions {
  settings: SettingsService;
}

export function registerSettingsRoutes(
  app: FastifyInstance,
  options: SettingsRoutesOptions,
): void {
  const { settings } = options;

  app.get('/api/settings/team', async (_req, reply) => {
    try {
      return settings.getTeamSettings();
    } catch (err) {
      return reply.code(503).send({ error: errMessage(err) });
    }
  });

  app.get('/api/settings/providers', async (req, reply) => {
    const query = OrganizationQuerySchema.safeParse(req.query);
    if (!query.success) return badRequest(reply, query.error.message);
    try {
      return settings.listProviders(query.data.organizationId);
    } catch (err) {
      const message = errMessage(err);
      return reply
        .code(message.startsWith('Organization not found') ? 404 : 503)
        .send({ error: message });
    }
  });

  app.post('/api/settings/providers', async (req, reply) => {
    const body = ProviderSecretsUpsertSchema.safeParse(req.body);
    if (!body.success) return badRequest(reply, body.error.message);
    try {
      return {
        providers: settings.upsertProviders(body.data.organizationId, body.data.providerKeys),
      };
    } catch (err) {
      const message = errMessage(err);
      const code = message.startsWith('Organization not found')
        ? 404
        : message.startsWith('Unknown provider keys')
          ? 400
          : 503;
      return reply.code(code).send({ error: message });
    }
  });

  app.delete<{ Params: { providerName: string }; Querystring: { organizationId: string } }>(
    '/api/settings/providers/:providerName',
    async (req, reply) => {
      const query = OrganizationQuerySchema.safeParse(req.query);
      if (!query.success) return badRequest(reply, query.error.message);
      const providerName = req.params.providerName;
      if (!providerName) return badRequest(reply, 'providerName required');
      try {
        return {
          providers: settings.deleteProvider(query.data.organizationId, providerName),
        };
      } catch (err) {
        const message = errMessage(err);
        return reply
          .code(message.startsWith('Organization not found') ? 404 : 503)
          .send({ error: message });
      }
    },
  );

  app.get('/api/settings/organization', async (req, reply) => {
    const query = OrganizationSettingsQuerySchema.safeParse(req.query);
    if (!query.success) return badRequest(reply, query.error.message);
    try {
      return settings.getOrganizationSettings(query.data.organizationId);
    } catch (err) {
      const message = errMessage(err);
      return reply
        .code(message.startsWith('Organization not found') ? 404 : 503)
        .send({ error: message });
    }
  });

  app.patch('/api/settings/organization', async (req, reply) => {
    const body = OrganizationSettingsUpdateSchema.safeParse(req.body);
    if (!body.success) return badRequest(reply, body.error.message);
    try {
      return settings.updateOrganizationSettings(body.data);
    } catch (err) {
      const message = errMessage(err);
      return reply
        .code(message.startsWith('Organization not found') ? 404 : 400)
        .send({ error: message });
    }
  });

  app.post('/api/settings/providers/:providerName/test', async (req, reply) => {
    const params = ProviderTestParamsSchema.safeParse(req.params);
    if (!params.success) return badRequest(reply, params.error.message);
    const query = OrganizationQuerySchema.safeParse(req.query);
    if (!query.success) return badRequest(reply, query.error.message);
    try {
      return settings.testProvider(query.data.organizationId, params.data.providerName);
    } catch (err) {
      const message = errMessage(err);
      return reply
        .code(message.startsWith('Organization not found') ? 404 : 503)
        .send({ error: message });
    }
  });

  app.get('/api/orgs', async (_req, reply) => {
    try {
      return { organizations: settings.listOrganizations() };
    } catch (err) {
      return reply.code(503).send({ error: errMessage(err) });
    }
  });

  app.post('/api/orgs/:orgId/members', async (req, reply) => {
    const params = OrgIdParamsSchema.safeParse(req.params);
    if (!params.success) return badRequest(reply, params.error.message);
    const body = AddMemberRequestSchema.safeParse(req.body);
    if (!body.success) return badRequest(reply, body.error.message);
    try {
      return settings.addMember({
        organizationId: params.data.orgId,
        name: body.data.name,
        kind: body.data.kind,
        roleName: body.data.roleName,
      });
    } catch (err) {
      const message = errMessage(err);
      return reply
        .code(message.startsWith('Organization not found') ? 404 : 400)
        .send({ error: message });
    }
  });
}

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: message });
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
