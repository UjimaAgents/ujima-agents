import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ChannelMemberModeSchema, ChannelMemberSettingsSchema, IdSchema } from '@ujima/shared';
import { ApiErrorSchema } from '@ujima/api-schema';
import type { Repository } from '@ujima/runtime-core';
import type { AuthService } from '@ujima/orchestrator';
import { z } from 'zod';
import {
  registerRoute,
  type RouteSpec,
} from './route-registry.js';

const ChannelIdParamsSchema = z.object({
  orgId: IdSchema,
  channelId: IdSchema,
});

const SetMemberModeBodySchema = z.object({
  memberId: IdSchema,
  mode: ChannelMemberModeSchema,
});

export interface ChannelMemberModeRoutesOptions {
  repo: Repository;
  auth: AuthService;
}

export function registerChannelMemberModeRoutes(
  _app: FastifyInstance,
  options: ChannelMemberModeRoutesOptions,
): void {
  const { repo, auth } = options;
  const app = _app.withTypeProvider<ZodTypeProvider>();

  const register = (spec: RouteSpec) => registerRoute(app, spec, { auth, repo });

  register({
    method: 'get',
    path: '/orgs/:orgId/channels/:channelId/modes',
    auth: { kind: 'org-session', organizationId: (req) => (req.params as { orgId: string }).orgId },
    schema: {
      description: 'List member modes for a channel',
      tags: ['Settings'],
      params: ChannelIdParamsSchema,
      response: {
        200: z.array(ChannelMemberSettingsSchema),
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    error: { notFound: 'Channel not found' },
    handler: async (req, { organizationId }) =>
      repo.listChannelMemberModesForChannel(
        organizationId,
        (req.params as { channelId: string }).channelId,
      ),
  });

  register({
    method: 'put',
    path: '/orgs/:orgId/channels/:channelId/modes',
    auth: { kind: 'org-session', organizationId: (req) => (req.params as { orgId: string }).orgId },
    workspaceRootAfterAuth: true,
    schema: {
      description: 'Set a member mode on a channel',
      tags: ['Settings'],
      params: ChannelIdParamsSchema,
      body: SetMemberModeBodySchema,
      response: {
        200: z.object({ ok: z.literal(true) }),
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    error: { notFound: ['Channel not found', 'Member not found'], workspaceRoot: true },
    handler: async (req, { organizationId }) => {
      repo.setChannelMemberMode(
        organizationId,
        (req.params as { channelId: string }).channelId,
        (req.body as { memberId: string }).memberId,
        (req.body as { mode: 'active' | 'passive' | 'muted' | 'temp_disable' }).mode,
      );
      return { ok: true as const };
    },
  });
}