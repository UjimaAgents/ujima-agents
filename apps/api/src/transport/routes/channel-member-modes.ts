import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ChannelMemberModeSchema, ChannelMemberSettingsSchema, IdSchema } from '@ujima/shared';
import { ApiErrorSchema } from '@ujima/api-schema';
import type { Repository } from '@ujima/runtime-core';
import type { AuthService } from '@ujima/orchestrator';
import { z } from 'zod';
import { requireOrgSession } from './org-auth.js';
import { routeError } from './route-errors.js';
import { assertReadyWorkspaceRoot } from './workspace-root.js';

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

  app.get('/orgs/:orgId/channels/:channelId/modes', {
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
  }, async (req, reply) => {
    try {
      const forbidden = requireOrgSession(auth, req, reply, req.params.orgId);
      if (forbidden) return forbidden;
      return repo.listChannelMemberModesForChannel(req.params.channelId);
    } catch (err) {
      return routeError(reply, err, { notFound: 'Channel not found' });
    }
  });

  app.put('/orgs/:orgId/channels/:channelId/modes', {
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
  }, async (req, reply) => {
    try {
      assertReadyWorkspaceRoot(repo, req.params.orgId);
      const forbidden = requireOrgSession(auth, req, reply, req.params.orgId);
      if (forbidden) return forbidden;
      repo.setChannelMemberMode(req.params.channelId, req.body.memberId, req.body.mode);
      return { ok: true as const };
    } catch (err) {
      return routeError(reply, err, { notFound: ['Channel not found', 'Member not found'], workspaceRoot: true });
    }
  });
}
