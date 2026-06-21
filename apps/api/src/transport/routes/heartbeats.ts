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
  UpdateScheduledJobRequestSchema,
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
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const authState = deps.auth.getAuthState(readSessionToken(req));
    if (!authState.user) {
      await reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
      return;
    }
    const jobs = deps.repo
      .listScheduledJobs(authState.user.organizationId)
      .filter((job) => job.type === HEARTBEAT_TYPE);
    await reply.status(200).send({ jobs });
  });

  api.get('/heartbeats/:id', {
    schema: {
      description: 'Get a single heartbeat job',
      tags: ['Heartbeats'],
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const authState = deps.auth.getAuthState(readSessionToken(req));
    if (!authState.user) {
      await reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
      return;
    }
    const job = deps.repo.getScheduledJob(authState.user.organizationId, req.params.id);
    if (!job || job.type !== HEARTBEAT_TYPE) {
      await reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Heartbeat job not found' });
      return;
    }
    await reply.status(200).send({ job });
  });

  api.patch('/heartbeats/:id', {
    schema: {
      description: 'Update a heartbeat job',
      tags: ['Heartbeats'],
      body: UpdateScheduledJobRequestSchema,
    },
  }, async (req: FastifyRequest<{ Params: { id: string }; Body: UpdateScheduledJobRequest }>, reply: FastifyReply) => {
    const authState = deps.auth.getAuthState(readSessionToken(req));
    if (!authState.user) {
      await reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
      return;
    }
    const existing = deps.repo.getScheduledJob(authState.user.organizationId, req.params.id);
    if (!existing || existing.type !== HEARTBEAT_TYPE) {
      await reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Heartbeat job not found' });
      return;
    }
    const now = new Date();
    const nextRunAt = resolveScheduledJobNextRunAt(existing, req.body, now);
    const cronChanged = req.body.cronExpression !== undefined;
    const activating = (req.body.status ?? existing.status) === 'active' && existing.status !== 'active';
    let channelId: string;
    try {
      channelId = requireChannelId(req.body.channelId ?? existing.channelId);
    } catch (error) {
      await reply.status(400).send({
        code: 'ERR_BAD_REQUEST',
        message: error instanceof Error ? error.message : 'channelId is required',
      });
      return;
    }
    if ((cronChanged || activating) && !nextRunAt) {
      await reply.status(400).send({
        code: 'ERR_BAD_REQUEST',
        message: 'Invalid cron expression.',
      });
      return;
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
    await reply.status(200).send({ job: updated });
  });

  api.delete('/heartbeats/:id', {
    schema: {
      description: 'Delete a heartbeat job',
      tags: ['Heartbeats'],
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const authState = deps.auth.getAuthState(readSessionToken(req));
    if (!authState.user) {
      await reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
      return;
    }
    const existing = deps.repo.getScheduledJob(authState.user.organizationId, req.params.id);
    if (!existing || existing.type !== HEARTBEAT_TYPE) {
      await reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Heartbeat job not found' });
      return;
    }
    deps.repo.deleteScheduledJob(authState.user.organizationId, req.params.id);
    await reply.status(204).send();
  });
}
