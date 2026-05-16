import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AgentTeamConfigSchema, RoleConfigSchema } from '@ujima/framework';
import type { Repository } from '@ujima/runtime-core';
import { ChannelSchema, IdSchema, MemberSchema } from '@ujima/shared';
import {
  ApiErrorSchema,
  ChannelOperationParamsSchema,
  ChannelUpdateSchema,
  ListOrganizationsResponseSchema,
  OrganizationQuerySchema,
  OrganizationSettingsQuerySchema,
  OrganizationSettingsResponseSchema,
  OrganizationSettingsUpdateSchema,
  PoliciesUpdateSchema,
  ProviderSecretsUpsertResponseSchema,
  ProviderSecretsUpsertSchema,
  ProviderStatusSchema,
} from '@ujima/api-schema';
import type { AuthService, SettingsService } from '@ujima/orchestrator';
import { z } from 'zod';
import {
  ERR_NO_WORKSPACE_ROOT,
  assertReadyWorkspaceRoot,
  isWorkspaceRootNotReadyError,
} from './workspace-root.js';
import { requireOrgSession } from './org-auth.js';

const OrgIdParamsSchema = z.object({ orgId: IdSchema });
const ProviderTestParamsSchema = z.object({ providerName: z.string().min(1) });
const TeamSettingsResponseSchema = AgentTeamConfigSchema.omit({ providers: true });
const ProviderStatusesResponseSchema = z.array(ProviderStatusSchema);
const AddMemberRequestSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['human', 'agent']),
  roleName: z.string().min(1),
  channelIds: z.array(IdSchema).default([]),
  llm: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  personalityName: z.string().min(1).optional(),
  role: RoleConfigSchema.optional(),
});
const UpdateMemberRequestSchema = AddMemberRequestSchema.omit({ kind: true }).extend({
  name: z.string().min(1),
  channelIds: z.array(IdSchema).optional(),
  role: RoleConfigSchema,
  personalityName: z.string().min(1),
});
const CreateChannelRequestSchema = z.object({
  name: z.string().min(1),
  topic: z.string().optional(),
});
const ProviderTestResultSchema = z.object({
  provider: z.string(),
  ok: z.boolean(),
  message: z.string(),
});

export interface SettingsRoutesOptions {
  repo: Repository;
  settings: SettingsService;
  auth: AuthService;
}

export function registerSettingsRoutes(
  _app: FastifyInstance,
  options: SettingsRoutesOptions,
): void {
  const { repo, settings, auth } = options;
  const app = _app.withTypeProvider<ZodTypeProvider>();

  app.get('/settings/team', {
    schema: {
      description: 'Get the current team configuration',
      tags: ['Settings'],
      querystring: OrganizationQuerySchema,
      response: {
        200: TeamSettingsResponseSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        503: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const forbidden = requireOrgSession(auth, req, reply, req.query.organizationId);
      if (forbidden) return forbidden;
      return settings.getTeamSettings() as z.infer<typeof TeamSettingsResponseSchema>;
    } catch (err) {
      const message = errMessage(err);
      return replyError(reply, message.startsWith('Organization not found') ? 404 : 503, message);
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
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        503: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const forbidden = requireOrgSession(auth, req, reply, req.query.organizationId);
      if (forbidden) return forbidden;
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
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        409: ApiErrorSchema,
        404: ApiErrorSchema,
        503: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      assertReadyWorkspaceRoot(repo, req.body.organizationId);
      const forbidden = requireOrgSession(auth, req, reply, req.body.organizationId);
      if (forbidden) return forbidden;
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
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        409: ApiErrorSchema,
        404: ApiErrorSchema,
        503: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      assertReadyWorkspaceRoot(repo, req.query.organizationId);
      const forbidden = requireOrgSession(auth, req, reply, req.query.organizationId);
      if (forbidden) return forbidden;
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
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        503: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const forbidden = requireOrgSession(auth, req, reply, req.query.organizationId);
      if (forbidden) return forbidden;
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
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        409: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      assertReadyWorkspaceRoot(repo, req.body.organizationId);
      const forbidden = requireOrgSession(auth, req, reply, req.body.organizationId);
      if (forbidden) return forbidden;
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
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        503: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const forbidden = requireOrgSession(auth, req, reply, req.query.organizationId);
      if (forbidden) return forbidden;
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
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        409: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      assertReadyWorkspaceRoot(repo, req.params.orgId);
      const forbidden = requireOrgSession(auth, req, reply, req.params.orgId);
      if (forbidden) return forbidden;
      const member = settings.addMember({
        organizationId: req.params.orgId,
        name: req.body.name,
        kind: req.body.kind,
        roleName: req.body.roleName,
        channelIds: req.body.channelIds,
        llm: req.body.llm,
        model: req.body.model,
        personalityName: req.body.personalityName,
        role: req.body.role,
      });
      return member;
    } catch (err) {
      const message = errMessage(err);
      if (isWorkspaceRootNotReadyError(err)) {
        return reply.code(409).send({ code: ERR_NO_WORKSPACE_ROOT, message });
      }
      return replyError(reply, message.startsWith('Organization not found') ? 404 : 400, message);
    }
  });

  app.patch('/orgs/:orgId/members/:memberId', {
    schema: {
      description: 'Update an agent member',
      tags: ['Settings'],
      params: z.object({ orgId: IdSchema, memberId: IdSchema }),
      body: UpdateMemberRequestSchema,
      response: {
        200: MemberSchema,
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        409: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      assertReadyWorkspaceRoot(repo, req.params.orgId);
      const forbidden = requireOrgSession(auth, req, reply, req.params.orgId);
      if (forbidden) return forbidden;
      return settings.updateMember({
        organizationId: req.params.orgId,
        memberId: req.params.memberId,
        name: req.body.name,
        roleName: req.body.roleName,
        channelIds: req.body.channelIds,
        llm: req.body.llm,
        model: req.body.model,
        personalityName: req.body.personalityName,
        role: req.body.role,
      });
    } catch (err) {
      const message = errMessage(err);
      if (isWorkspaceRootNotReadyError(err)) {
        return reply.code(409).send({ code: ERR_NO_WORKSPACE_ROOT, message });
      }
      return replyError(reply, message.startsWith('Member not found') ? 404 : 400, message);
    }
  });

  app.post('/orgs/:orgId/channels', {
    schema: {
      description: 'Add a channel to an organization',
      tags: ['Settings'],
      params: OrgIdParamsSchema,
      body: CreateChannelRequestSchema,
      response: {
        200: ChannelSchema,
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        409: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      assertReadyWorkspaceRoot(repo, req.params.orgId);
      const forbidden = requireOrgSession(auth, req, reply, req.params.orgId);
      if (forbidden) return forbidden;
      return repo.saveChannel(
        ChannelSchema.parse({
          id: randomUUID(),
          organizationId: req.params.orgId,
          name: req.body.name.trim(),
          kind: 'group',
          topic: req.body.topic ?? '',
          memberIds: [],
        }),
      );
    } catch (err) {
      const message = errMessage(err);
      if (isWorkspaceRootNotReadyError(err)) {
        return reply.code(409).send({ code: ERR_NO_WORKSPACE_ROOT, message });
      }
      return replyError(reply, message.startsWith('Organization not found') ? 404 : 400, message);
    }
  });

  app.patch('/orgs/:orgId/policies', {
    schema: {
      description: 'Update organization policies',
      tags: ['Settings'],
      params: OrgIdParamsSchema,
      body: PoliciesUpdateSchema,
      response: {
        200: OrganizationSettingsResponseSchema,
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        409: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      assertReadyWorkspaceRoot(repo, req.params.orgId);
      const forbidden = requireOrgSession(auth, req, reply, req.params.orgId);
      if (forbidden) return forbidden;
      return settings.updatePolicies({
        organizationId: req.params.orgId,
        requireApprovalForWrites: req.body.requireApprovalForWrites,
        requireApprovalForShell: req.body.requireApprovalForShell,
      });
    } catch (err) {
      const message = errMessage(err);
      if (isWorkspaceRootNotReadyError(err)) {
        return reply.code(409).send({ code: ERR_NO_WORKSPACE_ROOT, message });
      }
      return replyError(reply, message.startsWith('Organization not found') ? 404 : 400, message);
    }
  });

  app.patch('/orgs/:orgId/channels/:channelId', {
    schema: {
      description: 'Update a channel',
      tags: ['Settings'],
      params: ChannelOperationParamsSchema,
      body: ChannelUpdateSchema,
      response: {
        200: ChannelSchema,
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        409: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      assertReadyWorkspaceRoot(repo, req.params.orgId);
      const forbidden = requireOrgSession(auth, req, reply, req.params.orgId);
      if (forbidden) return forbidden;
      return settings.updateChannel({
        organizationId: req.params.orgId,
        channelId: req.params.channelId,
        name: req.body.name,
        topic: req.body.topic,
        memberIds: req.body.memberIds,
      });
    } catch (err) {
      const message = errMessage(err);
      if (isWorkspaceRootNotReadyError(err)) {
        return reply.code(409).send({ code: ERR_NO_WORKSPACE_ROOT, message });
      }
      return replyError(reply, message.startsWith('Channel not found') ? 404 : 400, message);
    }
  });

  app.delete('/orgs/:orgId/channels/:channelId', {
    schema: {
      description: 'Delete a channel',
      tags: ['Settings'],
      params: ChannelOperationParamsSchema,
      response: {
        200: z.object({ success: z.literal(true) }),
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        409: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      assertReadyWorkspaceRoot(repo, req.params.orgId);
      const forbidden = requireOrgSession(auth, req, reply, req.params.orgId);
      if (forbidden) return forbidden;
      settings.deleteChannel(req.params.orgId, req.params.channelId);
      return { success: true as const };
    } catch (err) {
      const message = errMessage(err);
      if (isWorkspaceRootNotReadyError(err)) {
        return reply.code(409).send({ code: ERR_NO_WORKSPACE_ROOT, message });
      }
      return replyError(reply, message.startsWith('Channel not found') ? 404 : 400, message);
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
