import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AgentTeamConfigSchema, RoleConfigSchema } from '@ujima/framework';
import type { Repository } from '@ujima/runtime-core';
import { AGENT_KIND, ChannelSchema, IdSchema, MemberSchema, MemberShellApprovalModeSchema } from '@ujima/shared';
import { ensureDirectMessageConversation } from '@ujima/orchestrator';
import {
  ApiErrorSchema,
  ChannelOperationParamsSchema,
  ChannelUpdateSchema,
  ListOrganizationsResponseSchema,
  OrganizationQuerySchema,
  OrganizationSettingsQuerySchema,
  OrganizationSettingsResponseSchema,
  OrganizationSettingsUpdateSchema,
  MemberShellApprovalUpdateSchema,
  PoliciesUpdateSchema,
  PolicyRulesResponseSchema,
  ProviderSecretsUpsertResponseSchema,
  ProviderSecretsUpsertSchema,
  ProviderStatusSchema,
  RevokePolicyRuleSchema,
} from '@ujima/api-schema';
import type { AuthService, SettingsService } from '@ujima/orchestrator';
import { z } from 'zod';
import {
  assertReadyWorkspaceRoot,
} from './workspace-root.js';
import { readSessionToken } from '../session-token.js';
import { requireOrgSession } from './org-auth.js';
import { apiError, errorMessage, routeError, workspaceRootError } from './route-errors.js';

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
  shellApprovalMode: MemberShellApprovalModeSchema.optional(),
  personalityName: z.string().min(1).optional(),
  role: RoleConfigSchema.optional(),
});
const UpdateMemberRequestSchema = AddMemberRequestSchema.omit({ kind: true }).extend({
  name: z.string().min(1),
  channelIds: z.array(IdSchema).optional(),
  role: RoleConfigSchema,
  personalityName: z.string().min(1),
  shellApprovalMode: MemberShellApprovalModeSchema.optional(),
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
      return settings.getTeamSettings(req.query.organizationId) as z.infer<typeof TeamSettingsResponseSchema>;
    } catch (err) {
      return routeError(reply, err, { notFound: 'Organization not found', fallback: 503 });
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
      return routeError(reply, err, { notFound: 'Organization not found', fallback: 503 });
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
        providers: settings.upsertProviders(
          req.body.organizationId,
          req.body.providerKeys,
          req.body.providerAuthModes,
          req.body.providerBaseUrls,
        ),
      };
    } catch (err) {
      const rootError = workspaceRootError(reply, err);
      if (rootError) return rootError;
      const message = errorMessage(err);
      const code = message.startsWith('Organization not found')
        ? 404
        : message.startsWith('Unknown provider keys')
          ? 400
          : 503;
      return apiError(reply, code, message);
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
      return routeError(reply, err, { notFound: 'Organization not found', fallback: 503, workspaceRoot: true });
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
      return routeError(reply, err, { notFound: 'Organization not found', fallback: 503 });
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
      return routeError(reply, err, { notFound: 'Organization not found', workspaceRoot: true });
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
      return routeError(reply, err, { notFound: 'Organization not found', fallback: 503 });
    }
  });

  app.get('/orgs', {
    schema: {
      description: 'List organizations',
      tags: ['Settings'],
      response: {
        200: ListOrganizationsResponseSchema,
        401: ApiErrorSchema,
        503: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const sessionToken = readSessionToken(req);
      const authState = auth.getAuthState(sessionToken);
      if (!authState.authenticated) {
        return apiError(reply, 401, 'session required');
      }
      return { organizations: auth.listAccessibleOrganizations(sessionToken) };
    } catch (err) {
      return routeError(reply, err, { fallback: 503 });
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
      const authState = auth.getAuthState(readSessionToken(req));
      const member = settings.addMember({
        organizationId: req.params.orgId,
        name: req.body.name,
        kind: req.body.kind,
        roleName: req.body.roleName,
        channelIds: req.body.channelIds,
        llm: req.body.llm,
        model: req.body.model,
        shellApprovalMode: req.body.shellApprovalMode,
        personalityName: req.body.personalityName,
        role: req.body.role,
      });
      if (member.kind === AGENT_KIND && authState.member) {
        ensureDirectMessageConversation(
          repo,
          req.params.orgId,
          authState.member,
          member,
        );
      }
      return member;
    } catch (err) {
      return routeError(reply, err, { notFound: 'Organization not found', workspaceRoot: true });
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
        shellApprovalMode: req.body.shellApprovalMode,
        personalityName: req.body.personalityName,
        role: req.body.role,
      });
    } catch (err) {
      return routeError(reply, err, { notFound: 'Member not found', workspaceRoot: true });
    }
  });

  app.delete('/orgs/:orgId/members/:memberId', {
    schema: {
      description: 'Delete/retire an agent member',
      tags: ['Settings'],
      params: z.object({ orgId: IdSchema, memberId: IdSchema }),
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
      settings.deleteMember(req.params.orgId, req.params.memberId);
      return { success: true as const };
    } catch (err) {
      const message = errorMessage(err);
      if (message === 'Only agents can be deleted') {
        return apiError(reply, 403, message);
      }
      return routeError(reply, err, { notFound: 'Member not found', workspaceRoot: true });
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
      return settings.addChannel({
        organizationId: req.params.orgId,
        name: req.body.name.trim(),
        topic: req.body.topic,
      });
    } catch (err) {
      return routeError(reply, err, { notFound: 'Organization not found', workspaceRoot: true });
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
        shellApprovalMode: req.body.shellApprovalMode,
      });
    } catch (err) {
      return routeError(reply, err, { notFound: 'Organization not found', workspaceRoot: true });
    }
  });

  app.get('/orgs/:orgId/policies/rules', {
    schema: {
      description: 'List all permanent allow rules from the governance policy',
      tags: ['Settings'],
      params: OrgIdParamsSchema,
      response: {
        200: PolicyRulesResponseSchema,
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const forbidden = requireOrgSession(auth, req, reply, req.params.orgId);
      if (forbidden) return forbidden;
      return { rules: settings.listAllowRules(req.params.orgId) };
    } catch (err) {
      return routeError(reply, err, { notFound: 'Organization not found' });
    }
  });

  app.delete('/orgs/:orgId/policies/rules', {
    schema: {
      description: 'Revoke a permanent allow rule from the governance policy',
      tags: ['Settings'],
      params: OrgIdParamsSchema,
      body: RevokePolicyRuleSchema,
      response: {
        200: z.object({ success: z.literal(true) }),
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      assertReadyWorkspaceRoot(repo, req.params.orgId);
      const forbidden = requireOrgSession(auth, req, reply, req.params.orgId);
      if (forbidden) return forbidden;
      settings.revokeAllowRule(
        req.params.orgId,
        req.body.agentId,
        req.body.mcpId,
        req.body.toolName,
      );
      return { success: true as const };
    } catch (err) {
      return routeError(reply, err, { notFound: 'Organization not found', workspaceRoot: true });
    }
  });

  app.patch('/orgs/:orgId/members/:memberId/preferences', {
    schema: {
      description: 'Update agent shell approval mode and model preferences',
      tags: ['Settings'],
      params: z.object({ orgId: IdSchema, memberId: IdSchema }),
      body: MemberShellApprovalUpdateSchema,
      response: {
        200: MemberSchema,
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      assertReadyWorkspaceRoot(repo, req.params.orgId);
      const forbidden = requireOrgSession(auth, req, reply, req.params.orgId);
      if (forbidden) return forbidden;
      return settings.patchMemberPreferences({
        organizationId: req.params.orgId,
        memberId: req.params.memberId,
        shellApprovalMode: req.body.shellApprovalMode,
        llm: req.body.llm,
        model: req.body.model,
      });
    } catch (err) {
      return routeError(reply, err, { notFound: 'Member not found', workspaceRoot: true });
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
      return routeError(reply, err, { notFound: 'Channel not found', workspaceRoot: true });
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
      return routeError(reply, err, { notFound: 'Channel not found', workspaceRoot: true });
    }
  });
}
