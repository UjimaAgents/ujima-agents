import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AgentTeamConfigSchema } from '@ujima/framework';
import type { Repository } from '@ujima/runtime-core';
import { IdSchema, MemberSchema } from '@ujima/shared';
import {
  AddMemberRequestSchema,
  ApiErrorSchema,
  ListOrganizationsResponseSchema,
  OrganizationQuerySchema,
  OrganizationSettingsQuerySchema,
  OrganizationSettingsResponseSchema,
  OrganizationSettingsUpdateSchema,
  ProviderSecretsUpsertResponseSchema,
  ProviderSecretsUpsertSchema,
  ProviderStatusSchema,
} from '@ujima/api-schema';
import type { SettingsService } from '@ujima/orchestrator';
import { z } from 'zod';
import {
  ERR_NO_WORKSPACE_ROOT,
  assertReadyWorkspaceRoot,
  isWorkspaceRootNotReadyError,
} from './workspace-root.js';

const OrgIdParamsSchema = z.object({ orgId: IdSchema });
const ProviderTestParamsSchema = z.object({ providerName: z.string().min(1) });
const TeamSettingsResponseSchema = AgentTeamConfigSchema.omit({ providers: true });
const ProviderStatusesResponseSchema = z.array(ProviderStatusSchema);
const ProviderTestResultSchema = z.object({
  provider: z.string(),
  ok: z.boolean(),
  message: z.string(),
});

export interface SettingsRoutesOptions {
  repo: Repository;
  settings: SettingsService;
}

export function registerSettingsRoutes(
  _app: FastifyInstance,
  options: SettingsRoutesOptions,
): void {
  const { repo, settings } = options;
  const app = _app.withTypeProvider<ZodTypeProvider>();

  app.get('/settings/team', {
    schema: {
      description: 'Get the current team configuration',
      tags: ['Settings'],
      response: {
        200: TeamSettingsResponseSchema,
        503: ApiErrorSchema,
      },
    },
  }, async (_req, reply) => {
    try {
      return settings.getTeamSettings() as z.infer<typeof TeamSettingsResponseSchema>;
    } catch (err) {
      return replyError(reply, 503, errMessage(err));
    }
  });

  app.get('/settings/providers', {
    schema: {
      description: 'List configured providers for an organization',
      tags: ['Settings'],
      querystring: OrganizationQuerySchema,
      response: {
        200: ProviderStatusesResponseSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
        503: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      return settings.listProviders(req.query.organizationId);
    } catch (err) {
      const message = errMessage(err);
      return replyError(reply, message.startsWith('Organization not found') ? 404 : 503, message);
    }
  });

  app.post('/settings/providers', {
    schema: {
      description: 'Upsert provider keys for an organization',
      tags: ['Settings'],
      body: ProviderSecretsUpsertSchema,
      response: {
        200: ProviderSecretsUpsertResponseSchema,
        400: ApiErrorSchema,
        409: ApiErrorSchema,
        404: ApiErrorSchema,
        503: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      assertReadyWorkspaceRoot(repo, req.body.organizationId);
      return {
        providers: settings.upsertProviders(req.body.organizationId, req.body.providerKeys),
      };
    } catch (err) {
      const message = errMessage(err);
      if (isWorkspaceRootNotReadyError(err)) {
        return reply.code(409).send({ code: ERR_NO_WORKSPACE_ROOT, message });
      }
      const code = message.startsWith('Organization not found')
        ? 404
        : message.startsWith('Unknown provider keys')
          ? 400
          : 503;
      return replyError(reply, code, message);
    }
  });

  app.delete('/settings/providers/:providerName', {
    schema: {
      description: 'Delete a provider key for an organization',
      tags: ['Settings'],
      params: ProviderTestParamsSchema,
      querystring: OrganizationQuerySchema,
      response: {
        200: ProviderSecretsUpsertResponseSchema,
        400: ApiErrorSchema,
        409: ApiErrorSchema,
        404: ApiErrorSchema,
        503: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      assertReadyWorkspaceRoot(repo, req.query.organizationId);
      return {
        providers: settings.deleteProvider(req.query.organizationId, req.params.providerName),
      };
    } catch (err) {
      const message = errMessage(err);
      if (isWorkspaceRootNotReadyError(err)) {
        return reply.code(409).send({ code: ERR_NO_WORKSPACE_ROOT, message });
      }
      return replyError(reply, message.startsWith('Organization not found') ? 404 : 503, message);
    }
  });

  app.get('/settings/organization', {
    schema: {
      description: 'Get organization settings',
      tags: ['Settings'],
      querystring: OrganizationSettingsQuerySchema,
      response: {
        200: OrganizationSettingsResponseSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
        503: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      return settings.getOrganizationSettings(req.query.organizationId);
    } catch (err) {
      const message = errMessage(err);
      return replyError(reply, message.startsWith('Organization not found') ? 404 : 503, message);
    }
  });

  app.patch('/settings/organization', {
    schema: {
      description: 'Update organization settings',
      tags: ['Settings'],
      body: OrganizationSettingsUpdateSchema,
      response: {
        200: OrganizationSettingsResponseSchema,
        400: ApiErrorSchema,
        409: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      assertReadyWorkspaceRoot(repo, req.body.organizationId);
      return settings.updateOrganizationSettings(req.body);
    } catch (err) {
      const message = errMessage(err);
      if (isWorkspaceRootNotReadyError(err)) {
        return reply.code(409).send({ code: ERR_NO_WORKSPACE_ROOT, message });
      }
      return replyError(reply, message.startsWith('Organization not found') ? 404 : 400, message);
    }
  });

  app.post('/settings/providers/:providerName/test', {
    schema: {
      description: 'Test whether a provider key is configured',
      tags: ['Settings'],
      params: ProviderTestParamsSchema,
      querystring: OrganizationQuerySchema,
      response: {
        200: ProviderTestResultSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
        503: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      return settings.testProvider(req.query.organizationId, req.params.providerName);
    } catch (err) {
      const message = errMessage(err);
      return replyError(reply, message.startsWith('Organization not found') ? 404 : 503, message);
    }
  });

  app.get('/orgs', {
    schema: {
      description: 'List organizations',
      tags: ['Settings'],
      response: {
        200: ListOrganizationsResponseSchema,
        503: ApiErrorSchema,
      },
    },
  }, async (_req, reply) => {
    try {
      return { organizations: settings.listOrganizations() };
    } catch (err) {
      return replyError(reply, 503, errMessage(err));
    }
  });

  app.post('/orgs/:orgId/members', {
    schema: {
      description: 'Add a member to an organization',
      tags: ['Settings'],
      params: OrgIdParamsSchema,
      body: AddMemberRequestSchema,
      response: {
        200: MemberSchema,
        400: ApiErrorSchema,
        409: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      assertReadyWorkspaceRoot(repo, req.params.orgId);
      return settings.addMember({
        organizationId: req.params.orgId,
        name: req.body.name,
        kind: req.body.kind,
        roleName: req.body.roleName,
      });
    } catch (err) {
      const message = errMessage(err);
      if (isWorkspaceRootNotReadyError(err)) {
        return reply.code(409).send({ code: ERR_NO_WORKSPACE_ROOT, message });
      }
      return replyError(reply, message.startsWith('Organization not found') ? 404 : 400, message);
    }
  });
}

function replyError(reply: FastifyReply, status: number, message: string): FastifyReply {
  const code = status === 404 ? 'ERR_NOT_FOUND' : status === 503 ? 'ERR_INTERNAL' : 'ERR_BAD_REQUEST';
  return reply.code(status).send({ code, message });
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
