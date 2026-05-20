import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Repository } from '@ujima/runtime-core';
import {
  createScheduledJobRecord,
  resolveScheduledJobNextRunAt,
  type AuthService,
} from '@ujima/orchestrator';
import { ScheduledJobSchema } from '@ujima/shared';
import { readSessionToken } from '../session-token.js';
import {
  CreateScheduledJobRequestSchema,
  CreateScheduledJobResponseSchema,
  ListScheduledJobsResponseSchema,
  GetScheduledJobResponseSchema,
  UpdateScheduledJobRequestSchema,
  UpdateScheduledJobResponseSchema,
  type CreateScheduledJobRequest,
  type UpdateScheduledJobRequest,
} from '@ujima/api-schema';

interface ScheduleRouteDeps {
  repo: Repository;
  auth: AuthService;
}

export function registerScheduleRoutes(api: FastifyInstance, deps: ScheduleRouteDeps): void {
  api.post('/schedules', {
    schema: {
      description: 'Create a new scheduled job',
      tags: ['Schedules'],
      body: CreateScheduledJobRequestSchema,
      response: { 201: CreateScheduledJobResponseSchema },
    },
  }, async (req: FastifyRequest<{ Body: CreateScheduledJobRequest }>, reply: FastifyReply) => {
    const authState = deps.auth.getAuthState(readSessionToken(req));
    if (!authState.member || !authState.user) {
      return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    }
    let job;
    try {
      job = createScheduledJobRecord({
        organizationId: authState.user.organizationId,
        memberId: authState.member.id,
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
  });

  api.get('/schedules', {
    schema: {
      description: 'List all scheduled jobs',
      tags: ['Schedules'],
      response: { 200: ListScheduledJobsResponseSchema },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const authState = deps.auth.getAuthState(readSessionToken(req));
    if (!authState.user) {
      return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    }
    const jobs = deps.repo.listScheduledJobs(authState.user.organizationId);
    return reply.status(200).send({ jobs });
  });

  api.get('/schedules/:id', {
    schema: {
      description: 'Get a single scheduled job',
      tags: ['Schedules'],
      response: { 200: GetScheduledJobResponseSchema },
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const authState = deps.auth.getAuthState(readSessionToken(req));
    if (!authState.user) {
      return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    }
    const job = deps.repo.getScheduledJob(authState.user.organizationId, req.params.id);
    if (!job) {
      return reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Scheduled job not found' });
    }
    return reply.status(200).send({ job });
  });

  api.patch('/schedules/:id', {
    schema: {
      description: 'Update a scheduled job',
      tags: ['Schedules'],
      body: UpdateScheduledJobRequestSchema,
      response: { 200: UpdateScheduledJobResponseSchema },
    },
  }, async (req: FastifyRequest<{ Params: { id: string }; Body: UpdateScheduledJobRequest }>, reply: FastifyReply) => {
    const authState = deps.auth.getAuthState(readSessionToken(req));
    if (!authState.user) {
      return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    }
    const existing = deps.repo.getScheduledJob(authState.user.organizationId, req.params.id);
    if (!existing) {
      return reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Scheduled job not found' });
    }
    const now = new Date();
    const nextRunAt = resolveScheduledJobNextRunAt(existing, req.body, now);
    const needsValidNextRun =
      req.body.cronExpression !== undefined ||
      (req.body.status === 'active' && existing.status !== 'active');
    if (needsValidNextRun && (req.body.status ?? existing.status) === 'active' && !nextRunAt) {
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
    return reply.status(200).send({ job: updated });
  });

  api.delete('/schedules/:id', {
    schema: {
      description: 'Delete a scheduled job',
      tags: ['Schedules'],
      response: { 204: { type: 'null' } },
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const authState = deps.auth.getAuthState(readSessionToken(req));
    if (!authState.user) {
      return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    }
    deps.repo.deleteScheduledJob(authState.user.organizationId, req.params.id);
    return reply.status(204).send();
  });
}
