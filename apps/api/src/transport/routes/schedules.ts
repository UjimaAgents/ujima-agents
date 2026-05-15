import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Repository } from '@ujima/runtime-core';
import type { AuthService, SchedulerService } from '@ujima/orchestrator';
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
import { ScheduledJobSchema } from '@ujima/shared';

interface ScheduleRouteDeps {
  repo: Repository;
  auth: AuthService;
  scheduler: SchedulerService;
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
    const authState = deps.auth.getAuthState(req.headers['x-ujima-session'] as string | undefined);
    if (!authState.authenticated) {
      return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    }
    const now = new Date().toISOString();
    const job = ScheduledJobSchema.parse({
      id: randomUUID(),
      organizationId: authState.user.organizationId,
      name: req.body.name,
      cronExpression: req.body.cronExpression,
      prompt: req.body.prompt,
      channelId: req.body.channelId,
      memberId: authState.member.id,
      status: 'active',
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    });
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
    const authState = deps.auth.getAuthState(req.headers['x-ujima-session'] as string | undefined);
    if (!authState.authenticated) {
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
    const authState = deps.auth.getAuthState(req.headers['x-ujima-session'] as string | undefined);
    if (!authState.authenticated) {
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
    const authState = deps.auth.getAuthState(req.headers['x-ujima-session'] as string | undefined);
    if (!authState.authenticated) {
      return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    }
    const existing = deps.repo.getScheduledJob(authState.user.organizationId, req.params.id);
    if (!existing) {
      return reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Scheduled job not found' });
    }
    const updated = ScheduledJobSchema.parse({
      ...existing,
      ...req.body,
      updatedAt: new Date().toISOString(),
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
    const authState = deps.auth.getAuthState(req.headers['x-ujima-session'] as string | undefined);
    if (!authState.authenticated) {
      return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    }
    deps.repo.deleteScheduledJob(authState.user.organizationId, req.params.id);
    return reply.status(204).send();
  });
}
