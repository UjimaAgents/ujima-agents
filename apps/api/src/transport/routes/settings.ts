import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AgentTeamConfigSchema, RoleConfigSchema } from '@ujima/framework';
import type { Repository } from '@ujima/runtime-core';
import { AGENT_KIND, ChannelSchema, IdSchema, MemberSchema, MemberShellApprovalModeSchema } from '@ujima/shared';
import { ensureDirectMessageConversation } from '@ujima/orchestrator';
import {
  ApiErrorSchema,
  ChannelOperationParamsSchema,
  ChannelUpdateSchema,
  DiscoverModelsResponseSchema,
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
import { readSessionToken } from '../session-token.js';
import {
  registerRoute,
  type RouteSpec,
} from './route-registry.js';

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

  const register = (spec: RouteSpec) => registerRoute(app, spec, { auth, repo });

  const orgQuery = (req: FastifyRequest) => (req.query as { organizationId: string }).organizationId;
  const orgBody = (req: FastifyRequest) => (req.body as { organizationId: string }).organizationId;
  const orgParams = (req: FastifyRequest) => (req.params as { orgId: string }).orgId;

  register({
    method: 'get',
    path: '/settings/team',
    auth: { kind: 'org-session', organizationId: orgQuery },
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
    error: { notFound: 'Organization not found', fallback: 503 },
    handler: async (_req, { organizationId }) =>
      settings.getTeamSettings(organizationId) as z.infer<typeof TeamSettingsResponseSchema>,
  });

  register({
    method: 'get',
    path: '/settings/providers',
    auth: { kind: 'org-session', organizationId: orgQuery },
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
    error: { notFound: 'Organization not found', fallback: 503 },
    handler: async (_req, { organizationId }) => settings.listProviders(organizationId),
  });

  register({
    method: 'post',
    path: '/settings/providers',
    auth: { kind: 'org-session', organizationId: orgBody },
    workspaceRoot: true,
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
    error: {
      workspaceRoot: true,
      byPrefix: { 'Unknown provider keys': 400 },
      notFound: 'Organization not found',
      fallback: 503,
    },
    handler: async (req, { organizationId }) => ({
      providers: settings.upsertProviders(
        organizationId,
        req.body.providerKeys,
        req.body.providerAuthModes,
        req.body.providerBaseUrls,
      ),
    }),
  });

  register({
    method: 'delete',
    path: '/settings/providers/:providerName',
    auth: { kind: 'org-session', organizationId: orgQuery },
    workspaceRoot: true,
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
    error: { notFound: 'Organization not found', fallback: 503, workspaceRoot: true },
    handler: async (req, { organizationId }) => ({
      providers: settings.deleteProvider(organizationId, req.params.providerName),
    }),
  });

  register({
    method: 'get',
    path: '/settings/organization',
    auth: { kind: 'org-session', organizationId: orgQuery },
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
    error: { notFound: 'Organization not found', fallback: 503 },
    handler: async (_req, { organizationId }) => settings.getOrganizationSettings(organizationId),
  });

  register({
    method: 'patch',
    path: '/settings/organization',
    auth: { kind: 'org-session', organizationId: orgBody },
    workspaceRoot: true,
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
    error: { notFound: 'Organization not found', workspaceRoot: true },
    handler: async (req) => settings.updateOrganizationSettings(req.body),
  });

  register({
    method: 'post',
    path: '/settings/providers/:providerName/test',
    auth: { kind: 'org-session', organizationId: orgQuery },
    schema: {
      description: 'Verify provider credentials with a live connectivity check',
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
    error: { notFound: 'Organization not found', fallback: 503 },
    handler: async (req, { organizationId }) =>
      await settings.testProvider(organizationId, req.params.providerName),
  });

  register({
    method: 'get',
    path: '/settings/providers/:providerName/models',
    auth: { kind: 'org-session', organizationId: orgQuery },
    schema: {
      description: 'Discover models from a provider\'s /v1/models endpoint',
      tags: ['Settings'],
      params: ProviderTestParamsSchema,
      querystring: OrganizationQuerySchema,
      response: {
        200: DiscoverModelsResponseSchema,
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        502: ApiErrorSchema,
        503: ApiErrorSchema,
      },
    },
    error: {
      byPrefix: {
        'Unknown provider': 404,
        'No API key configured': 404,
        'Discovery failed': 502,
      },
      notFound: 'Organization not found',
      fallback: 503,
    },
    handler: async (req, { organizationId }) => ({
      models: await settings.discoverModels(organizationId, req.params.providerName),
    }),
  });

  register({
    method: 'get',
    path: '/orgs',
    auth: { kind: 'user', unauthorizedMessage: 'session required' },
    schema: {
      description: 'List organizations',
      tags: ['Settings'],
      response: {
        200: ListOrganizationsResponseSchema,
        401: ApiErrorSchema,
        503: ApiErrorSchema,
      },
    },
    error: { fallback: 503 },
    handler: async (req) => {
      const sessionToken = readSessionToken(req);
      return { organizations: auth.listAccessibleOrganizations(sessionToken) };
    },
  });

  register({
    method: 'post',
    path: '/orgs/:orgId/members',
    auth: { kind: 'org-session', organizationId: orgParams },
    workspaceRoot: true,
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
    error: { notFound: 'Organization not found', workspaceRoot: true },
    handler: async (req, { organizationId, authState }) => {
      const member = settings.addMember({
        organizationId,
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
          organizationId,
          authState.member,
          member,
        );
      }
      return member;
    },
  });

  register({
    method: 'patch',
    path: '/orgs/:orgId/members/:memberId',
    auth: { kind: 'org-session', organizationId: orgParams },
    workspaceRoot: true,
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
    error: { notFound: 'Member not found', workspaceRoot: true },
    handler: async (req, { organizationId }) =>
      settings.updateMember({
        organizationId,
        memberId: req.params.memberId,
        name: req.body.name,
        roleName: req.body.roleName,
        channelIds: req.body.channelIds,
        llm: req.body.llm,
        model: req.body.model,
        shellApprovalMode: req.body.shellApprovalMode,
        personalityName: req.body.personalityName,
        role: req.body.role,
      }),
  });

  register({
    method: 'delete',
    path: '/orgs/:orgId/members/:memberId',
    auth: { kind: 'org-session', organizationId: orgParams },
    workspaceRoot: true,
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
    error: {
      byPrefix: { 'Only agents can be deleted': 403 },
      notFound: 'Member not found',
      workspaceRoot: true,
    },
    handler: async (req, { organizationId }) => {
      settings.deleteMember(organizationId, req.params.memberId);
      return { success: true as const };
    },
  });

  register({
    method: 'post',
    path: '/orgs/:orgId/channels',
    auth: { kind: 'org-session', organizationId: orgParams },
    workspaceRoot: true,
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
    error: { notFound: 'Organization not found', workspaceRoot: true },
    handler: async (req, { organizationId }) =>
      settings.addChannel({
        organizationId,
        name: req.body.name.trim(),
        topic: req.body.topic,
      }),
  });

  register({
    method: 'patch',
    path: '/orgs/:orgId/policies',
    auth: { kind: 'org-session', organizationId: orgParams },
    workspaceRoot: true,
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
    error: { notFound: 'Organization not found', workspaceRoot: true },
    handler: async (req, { organizationId }) =>
      settings.updatePolicies({
        organizationId,
        requireApprovalForWrites: req.body.requireApprovalForWrites,
        requireApprovalForShell: req.body.requireApprovalForShell,
        shellApprovalMode: req.body.shellApprovalMode,
      }),
  });

  register({
    method: 'get',
    path: '/orgs/:orgId/policies/rules',
    auth: { kind: 'org-session', organizationId: orgParams },
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
    error: { notFound: 'Organization not found' },
    handler: async (_req, { organizationId }) => ({
      rules: settings.listAllowRules(organizationId),
    }),
  });

  register({
    method: 'delete',
    path: '/orgs/:orgId/policies/rules',
    auth: { kind: 'org-session', organizationId: orgParams },
    workspaceRoot: true,
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
    error: { notFound: 'Organization not found', workspaceRoot: true },
    handler: async (req, { organizationId }) => {
      settings.revokeAllowRule(
        organizationId,
        req.body.agentId,
        req.body.mcpId,
        req.body.toolName,
      );
      return { success: true as const };
    },
  });

  register({
    method: 'patch',
    path: '/orgs/:orgId/members/:memberId/preferences',
    auth: { kind: 'org-session', organizationId: orgParams },
    workspaceRoot: true,
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
    error: { notFound: 'Member not found', workspaceRoot: true },
    handler: async (req, { organizationId }) =>
      settings.patchMemberPreferences({
        organizationId,
        memberId: req.params.memberId,
        shellApprovalMode: req.body.shellApprovalMode,
        llm: req.body.llm,
        model: req.body.model,
      }),
  });

  register({
    method: 'patch',
    path: '/orgs/:orgId/channels/:channelId',
    auth: { kind: 'org-session', organizationId: orgParams },
    workspaceRoot: true,
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
    error: { notFound: 'Channel not found', workspaceRoot: true },
    handler: async (req, { organizationId }) =>
      settings.updateChannel({
        organizationId,
        channelId: req.params.channelId,
        name: req.body.name,
        topic: req.body.topic,
        memberIds: req.body.memberIds,
      }),
  });

  register({
    method: 'delete',
    path: '/orgs/:orgId/channels/:channelId',
    auth: { kind: 'org-session', organizationId: orgParams },
    workspaceRoot: true,
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
    error: { notFound: 'Channel not found', workspaceRoot: true },
    handler: async (req, { organizationId }) => {
      settings.deleteChannel(organizationId, req.params.channelId);
      return { success: true as const };
    },
  });
}