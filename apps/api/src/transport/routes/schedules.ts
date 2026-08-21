import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Repository } from '@ujima/runtime-core';
import {
  createScheduledJobRecord,
  resolveScheduledJobNextRunAt,
  type AuthService,
} from '@ujima/orchestrator';
import { ScheduledJobSchema } from '@ujima/shared';
import { z } from 'zod';
import {
  CreateScheduledJobRequestSchema,
  CreateScheduledJobResponseSchema,
  ListScheduledJobsResponseSchema,
  GetScheduledJobResponseSchema,
  UpdateScheduledJobRequestSchema,
  UpdateScheduledJobResponseSchema,
} from '@ujima/api-schema';
import { httpError } from './route-errors.js';
import {
  registerRoute,
  type RouteSpec,
} from './route-registry.js';

interface ScheduleRouteDeps {
  repo: Repository;
  auth: AuthService;
}

export function registerScheduleRoutes(api: FastifyInstance, deps: ScheduleRouteDeps): void {
  const app = api.withTypeProvider<ZodTypeProvider>();

  const register = (spec: RouteSpec) => registerRoute(app, spec, deps);

  register({
    method: 'post',
    path: '/schedules',
    auth: { kind: 'member' },
    schema: {
      description: 'Create a new scheduled job',
      tags: ['Schedules'],
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
          channelId: req.body.channelId,
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
    path: '/schedules',
    auth: { kind: 'user' },
    schema: {
      description: 'List all scheduled jobs',
      tags: ['Schedules'],
      response: { 200: ListScheduledJobsResponseSchema },
    },
    handler: async (_req, { organizationId }) => {
      const jobs = deps.repo.listScheduledJobs(organizationId);
      return { jobs };
    },
  });

  register({
    method: 'get',
    path: '/schedules/:id',
    auth: { kind: 'user' },
    schema: {
      description: 'Get a single scheduled job',
      tags: ['Schedules'],
      response: { 200: GetScheduledJobResponseSchema },
    },
    handler: async (req, { organizationId }) => {
      const job = deps.repo.getScheduledJob(organizationId, req.params.id);
      if (!job) {
        throw httpError(404, 'Scheduled job not found');
      }
      return { job };
    },
  });

  register({
    method: 'patch',
    path: '/schedules/:id',
    auth: { kind: 'user' },
    schema: {
      description: 'Update a scheduled job',
      tags: ['Schedules'],
      body: UpdateScheduledJobRequestSchema,
      response: { 200: UpdateScheduledJobResponseSchema },
    },
    handler: async (req, { organizationId, reply }) => {
      const existing = deps.repo.getScheduledJob(organizationId, req.params.id);
      if (!existing) {
        throw httpError(404, 'Scheduled job not found');
      }
      const now = new Date();
      const nextRunAt = resolveScheduledJobNextRunAt(existing, req.body, now);
      const cronChanged = req.body.cronExpression !== undefined;
      const activating = (req.body.status ?? existing.status) === 'active' && existing.status !== 'active';
      if ((cronChanged || activating) && !nextRunAt) {
        return reply.status(400).send({
          code: 'ERR_BAD_REQUEST',
          message: 'Invalid cron expression.',
        });
      }
      const updated = ScheduledJobSchema.parse({
        ...existing,
        ...req.body,
        nextRunAt,
        updatedAt: now.toISOString(),
      });
      deps.repo.saveScheduledJob(updated);
      return { job: updated };
    },
  });

  register({
    method: 'delete',
    path: '/schedules/:id',
    auth: { kind: 'user' },
    schema: {
      description: 'Delete a scheduled job',
      tags: ['Schedules'],
      response: { 204: z.null() },
    },
    successStatus: 204,
    handler: async (req, { organizationId }) => {
      deps.repo.deleteScheduledJob(organizationId, req.params.id);
    },
  });
}