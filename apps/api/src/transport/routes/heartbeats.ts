import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Repository } from '@ujima/runtime-core';
import {
  createScheduledJobRecord,
  resolveScheduledJobNextRunAt,
  type AuthService,
} from '@ujima/orchestrator';
import { ScheduledJobSchema } from '@ujima/shared';
import {
  CreateScheduledJobRequestSchema,
  CreateScheduledJobResponseSchema,
  UpdateScheduledJobRequestSchema,
} from '@ujima/api-schema';
import { httpError } from './route-errors.js';
import {
  registerRoute,
  type RouteSpec,
} from './route-registry.js';

interface HeartbeatRouteDeps {
  repo: Repository;
  auth: AuthService;
}

const HEARTBEAT_TYPE = 'heartbeat' as const;

function requireChannelId(channelId?: string): string {
  if (!channelId) {
    throw new Error('channelId is required');
  }
  return channelId;
}

export function registerHeartbeatRoutes(api: FastifyInstance, deps: HeartbeatRouteDeps): void {
  const app = api.withTypeProvider<ZodTypeProvider>();

  const register = (spec: RouteSpec) => registerRoute(app, spec, deps);

  register({
    method: 'post',
    path: '/heartbeats',
    auth: { kind: 'member' },
    schema: {
      description: 'Create a new heartbeat job',
      tags: ['Heartbeats'],
      body: CreateScheduledJobRequestSchema,
      response: { 201: CreateScheduledJobResponseSchema },
    },
    handler: async (req, { organizationId, memberId, reply }) => {
      let job;
      try {
        job = createScheduledJobRecord({
          organizationId,
          memberId,
          name: req.body.name,
          cronExpression: req.body.cronExpression,
          prompt: req.body.prompt,
          channelId: requireChannelId(req.body.channelId),
          type: HEARTBEAT_TYPE,
        });
      } catch (error) {
        return reply.status(400).send({
          code: 'ERR_BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Invalid cron expression.',
        });
      }
      deps.repo.saveScheduledJob(job);
      return reply.status(201).send({ job });
    },
  });

  register({
    method: 'get',
    path: '/heartbeats',
    auth: { kind: 'user' },
    schema: {
      description: 'List all heartbeat jobs',
      tags: ['Heartbeats'],
    },
    handler: async (_req, { organizationId }) => {
      const jobs = deps.repo
        .listScheduledJobs(organizationId)
        .filter((job) => job.type === HEARTBEAT_TYPE);
      return { jobs };
    },
  });

  register({
    method: 'get',
    path: '/heartbeats/:id',
    auth: { kind: 'user' },
    schema: {
      description: 'Get a single heartbeat job',
      tags: ['Heartbeats'],
    },
    handler: async (req, { organizationId }) => {
      const job = deps.repo.getScheduledJob(organizationId, req.params.id);
      if (!job || job.type !== HEARTBEAT_TYPE) {
        throw httpError(404, 'Heartbeat job not found');
      }
      return { job };
    },
  });

  register({
    method: 'patch',
    path: '/heartbeats/:id',
    auth: { kind: 'user' },
    schema: {
      description: 'Update a heartbeat job',
      tags: ['Heartbeats'],
      body: UpdateScheduledJobRequestSchema,
    },
    handler: async (req, { organizationId, reply }) => {
      const existing = deps.repo.getScheduledJob(organizationId, req.params.id);
      if (!existing || existing.type !== HEARTBEAT_TYPE) {
        throw httpError(404, 'Heartbeat job not found');
      }
      const now = new Date();
      const nextRunAt = resolveScheduledJobNextRunAt(existing, req.body, now);
      const cronChanged = req.body.cronExpression !== undefined;
      const activating = (req.body.status ?? existing.status) === 'active' && existing.status !== 'active';
      let channelId: string;
      try {
        channelId = requireChannelId(req.body.channelId ?? existing.channelId);
      } catch (error) {
        return reply.status(400).send({
          code: 'ERR_BAD_REQUEST',
          message: error instanceof Error ? error.message : 'channelId is required',
        });
      }
      if ((cronChanged || activating) && !nextRunAt) {
        return reply.status(400).send({
          code: 'ERR_BAD_REQUEST',
          message: 'Invalid cron expression.',
        });
      }
      const updated = ScheduledJobSchema.parse({
        ...existing,
        ...req.body,
        channelId,
        type: HEARTBEAT_TYPE,
        nextRunAt,
        updatedAt: now.toISOString(),
      });
      deps.repo.saveScheduledJob(updated);
      return { job: updated };
    },
  });

  register({
    method: 'delete',
    path: '/heartbeats/:id',
    auth: { kind: 'user' },
    schema: {
      description: 'Delete a heartbeat job',
      tags: ['Heartbeats'],
    },
    successStatus: 204,
    handler: async (req, { organizationId }) => {
      const existing = deps.repo.getScheduledJob(organizationId, req.params.id);
      if (!existing || existing.type !== HEARTBEAT_TYPE) {
        throw httpError(404, 'Heartbeat job not found');
      }
      deps.repo.deleteScheduledJob(organizationId, req.params.id);
    },
  });
}