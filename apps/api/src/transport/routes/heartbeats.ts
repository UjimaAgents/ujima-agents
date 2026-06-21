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
  api.post('/heartbeats', {
    schema: {
      description: 'Create a new heartbeat job',
      tags: ['Heartbeats'],
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
  });

  api.get('/heartbeats', {
    schema: {
      description: 'List all heartbeat jobs',
      tags: ['Heartbeats'],
      response: { 200: ListScheduledJobsResponseSchema },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const authState = deps.auth.getAuthState(readSessionToken(req));
    if (!authState.user) {
      return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    }
    const jobs = deps.repo
      .listScheduledJobs(authState.user.organizationId)
      .filter((job) => job.type === HEARTBEAT_TYPE);
    return reply.status(200).send({ jobs });
  });

  api.get('/heartbeats/:id', {
    schema: {
      description: 'Get a single heartbeat job',
      tags: ['Heartbeats'],
      response: { 200: GetScheduledJobResponseSchema },
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const authState = deps.auth.getAuthState(readSessionToken(req));
    if (!authState.user) {
      return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    }
    const job = deps.repo.getScheduledJob(authState.user.organizationId, req.params.id);
    if (!job || job.type !== HEARTBEAT_TYPE) {
      return reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Heartbeat job not found' });
    }
    return reply.status(200).send({ job });
  });

  api.patch('/heartbeats/:id', {
    schema: {
      description: 'Update a heartbeat job',
      tags: ['Heartbeats'],
      body: UpdateScheduledJobRequestSchema,
      response: { 200: UpdateScheduledJobResponseSchema },
    },
  }, async (req: FastifyRequest<{ Params: { id: string }; Body: UpdateScheduledJobRequest }>, reply: FastifyReply) => {
    const authState = deps.auth.getAuthState(readSessionToken(req));
    if (!authState.user) {
      return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    }
    const existing = deps.repo.getScheduledJob(authState.user.organizationId, req.params.id);
    if (!existing || existing.type !== HEARTBEAT_TYPE) {
      return reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Heartbeat job not found' });
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
    return reply.status(200).send({ job: updated });
  });

  api.delete('/heartbeats/:id', {
    schema: {
      description: 'Delete a heartbeat job',
      tags: ['Heartbeats'],
      response: { 204: { type: 'null' } },
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const authState = deps.auth.getAuthState(readSessionToken(req));
    if (!authState.user) {
      return reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    }
    const existing = deps.repo.getScheduledJob(authState.user.organizationId, req.params.id);
    if (!existing || existing.type !== HEARTBEAT_TYPE) {
      return reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Heartbeat job not found' });
    }
    deps.repo.deleteScheduledJob(authState.user.organizationId, req.params.id);
    return reply.status(204).send();
  });
}
