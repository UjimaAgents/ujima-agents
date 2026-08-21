import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Repository } from '@ujima/runtime-core';
import { ApprovalRequestSchema, MessageSchema, RunStateSchema, RunStepSchema, createPaginatedSchema, IdSchema } from '@ujima/shared';
import {
  ApprovalListQuerySchema,
  ApprovalResolveSchema,
  ApiErrorSchema,
  RunCancelSchema,
  RunCreateSchema,
  RunListQuerySchema,
  ShellJobDetailSchema,
  ShellJobDetailQuerySchema,
  ShellJobSchema,
  RunJobTerminateSchema,
} from '@ujima/api-schema';
import type { ApprovalService, AuthService, SpiritService } from '@ujima/orchestrator';
import { listBackgroundJobs, peekBackgroundJob, terminateBackgroundJob } from '@ujima/orchestrator';
import { z } from 'zod';
import { httpError } from './route-errors.js';
import {
  registerRoute,
  type RouteSpec,
} from './route-registry.js';

const RunIdParamsSchema = z.object({ runId: IdSchema });
const ThreadIdParamsSchema = z.object({ threadId: IdSchema });
const ApprovalIdParamsSchema = z.object({ approvalId: IdSchema });
const JobIdParamsSchema = z.object({ runId: IdSchema, jobId: z.string() });
const RunDetailQuerySchema = z.object({ organizationId: IdSchema });
const RunTraceListQuerySchema = z.object({
  organizationId: IdSchema,
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(20).optional(),
});
const RunTraceListResponseSchema = createPaginatedSchema(
  z.object({
    run: RunStateSchema,
    steps: z.array(RunStepSchema),
    message: MessageSchema.optional(),
  }),
);
const RunListResponseSchema = createPaginatedSchema(RunStateSchema);
const RunDetailResponseSchema = z.object({
  run: RunStateSchema,
  approvals: z.array(ApprovalRequestSchema),
  messages: z.array(MessageSchema),
  activeAgents: z.array(
    z.object({
      memberId: IdSchema,
      statusLabel: z.string().min(1),
    }),
  ),
  tokens: z.object({
    perMemberId: z.record(IdSchema, z.number().int().nonnegative()),
  }),
  tools: z.record(
    z.string(),
    z.object({
      count: z.number().int().nonnegative(),
      pending: z.number().int().nonnegative(),
    }),
  ),
});

export interface RunRoutesOptions {
  repo: Repository;
  runs: SpiritService;
  approvals: ApprovalService;
  auth: AuthService;
}

export function registerRunRoutes(
  _app: FastifyInstance,
  options: RunRoutesOptions,
): void {
  const { repo, runs, approvals, auth } = options;
  const app = _app.withTypeProvider<ZodTypeProvider>();

  const register = (spec: RouteSpec) => registerRoute(app, spec, { auth, repo });

  const orgQuery = (req: FastifyRequest) => (req.query as { organizationId: string }).organizationId;
  const orgBody = (req: FastifyRequest) => (req.body as { organizationId: string }).organizationId;

  register({
    method: 'get',
    path: '/runs',
    auth: { kind: 'none' },
    schema: {
      description: 'List runs for an organization',
      tags: ['Runs'],
      querystring: RunListQuerySchema,
      response: {
        200: RunListResponseSchema,
        400: ApiErrorSchema,
      },
    },
    error: { fallback: 400 },
    handler: async (req) =>
      runs.listRuns(req.query.organizationId, req.query.cursor, req.query.limit),
  });

  register({
    method: 'get',
    path: '/runs/:runId',
    auth: { kind: 'none' },
    schema: {
      description: 'Get a run by ID',
      tags: ['Runs'],
      params: RunIdParamsSchema,
      querystring: RunDetailQuerySchema,
      response: {
        200: RunStateSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    error: { fallback: 400 },
    handler: async (req) => {
      const run = runs.getRun(req.query.organizationId, req.params.runId);
      if (!run) throw httpError(404, 'Run not found');
      return run;
    },
  });

  register({
    method: 'get',
    path: '/runs/:runId/detail',
    auth: { kind: 'none' },
    schema: {
      description: 'Get a run with its related approvals and messages',
      tags: ['Runs'],
      params: RunIdParamsSchema,
      querystring: RunDetailQuerySchema,
      response: {
        200: RunDetailResponseSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    error: { fallback: 400 },
    handler: async (req) => {
      const detail = runs.getRunDetail(req.query.organizationId, req.params.runId);
      if (!detail) throw httpError(404, 'Run not found');
      return detail;
    },
  });

  register({
    method: 'get',
    path: '/threads/:threadId/traces',
    auth: { kind: 'none' },
    schema: {
      description: 'List run traces for a thread',
      tags: ['Runs'],
      params: ThreadIdParamsSchema,
      querystring: RunTraceListQuerySchema,
      response: {
        200: RunTraceListResponseSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    error: { fallback: 404 },
    handler: async (req) =>
      runs.listThreadTraces(
        req.query.organizationId,
        req.params.threadId,
        req.query.cursor,
        req.query.limit,
      ),
  });

  register({
    method: 'post',
    path: '/runs',
    auth: { kind: 'org-session', organizationId: orgBody },
    workspaceRoot: true,
    schema: {
      description: 'Create a run for an agent',
      tags: ['Runs'],
      body: RunCreateSchema,
      response: {
        200: RunStateSchema,
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
      byPrefix: { 'Member not found': 404, 'Organization not found': 404 },
      fallback: 503,
    },
    handler: async (req) => runs.createRun(req.body),
  });

  register({
    method: 'post',
    path: '/runs/:runId/cancel',
    auth: { kind: 'org-session', organizationId: orgBody },
    workspaceRoot: true,
    schema: {
      description: 'Cancel an in-flight or queued run',
      tags: ['Runs'],
      params: RunIdParamsSchema,
      body: RunCancelSchema,
      response: {
        200: RunStateSchema,
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        503: ApiErrorSchema,
      },
    },
    error: {
      workspaceRoot: true,
      byPrefix: { 'Run not found': 404 },
      fallback: 400,
    },
    handler: async (req) => runs.cancelRun(req.body.organizationId, req.params.runId),
  });

  register({
    method: 'get',
    path: '/approvals',
    auth: { kind: 'none' },
    schema: {
      description: 'List pending approvals',
      tags: ['Runs'],
      querystring: ApprovalListQuerySchema,
      response: {
        200: z.array(ApprovalRequestSchema),
        400: ApiErrorSchema,
      },
    },
    error: { fallback: 400 },
    handler: async (req) => approvals.listPending(req.query.organizationId),
  });

  register({
    method: 'post',
    path: '/approvals/:approvalId/resolve',
    auth: { kind: 'org-session', organizationId: orgBody },
    workspaceRoot: true,
    schema: {
      description: 'Resolve a pending approval',
      tags: ['Runs'],
      params: ApprovalIdParamsSchema,
      body: ApprovalResolveSchema,
      response: {
        200: ApprovalRequestSchema,
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        409: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    error: {
      workspaceRoot: true,
      byPrefix: { 'Approval not found': 404 },
      fallback: 400,
    },
    handler: async (req, { authState }) => {
      const status = req.body.resolution === 'reject' ? 'rejected' : 'approved';
      return await approvals.resolveApproval({
        organizationId: req.body.organizationId,
        approvalId: req.params.approvalId,
        status,
        resolution: req.body.resolution,
        reason: req.body.reason,
        resolverMemberId: authState.member?.id,
      });
    },
  });

  register({
    method: 'get',
    path: '/runs/:runId/jobs',
    auth: { kind: 'org-session', organizationId: orgQuery },
    schema: {
      description: 'Get background shell jobs for a run',
      tags: ['Runs'],
      params: RunIdParamsSchema,
      querystring: RunDetailQuerySchema,
      response: {
        200: z.array(ShellJobSchema),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    error: { fallback: 400 },
    handler: async (req, { organizationId }) => {
      const run = runs.getRun(organizationId, req.params.runId);
      if (!run) throw httpError(404, 'Run not found');
      return listBackgroundJobs(req.params.runId);
    },
  });

  register({
    method: 'get',
    path: '/runs/:runId/jobs/:jobId',
    auth: { kind: 'org-session', organizationId: orgQuery },
    schema: {
      description: 'Peek live stdout/stderr for a background shell job (non-destructive)',
      tags: ['Runs'],
      params: JobIdParamsSchema,
      querystring: ShellJobDetailQuerySchema,
      response: {
        200: ShellJobDetailSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    error: { fallback: 400 },
    handler: async (req, { organizationId }) => {
      const run = runs.getRun(organizationId, req.params.runId);
      if (!run) throw httpError(404, 'Run not found');
      const snapshot = peekBackgroundJob(req.params.runId, req.params.jobId);
      if (!snapshot) {
        throw httpError(404, 'Background job not found');
      }
      return snapshot;
    },
  });

  register({
    method: 'post',
    path: '/runs/:runId/jobs/:jobId/terminate',
    auth: { kind: 'org-session', organizationId: orgBody },
    schema: {
      description: 'Terminate a background shell job',
      tags: ['Runs'],
      params: JobIdParamsSchema,
      body: RunJobTerminateSchema,
      response: {
        200: z.object({ success: z.boolean() }),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    error: { fallback: 400 },
    handler: async (req, { organizationId }) => {
      const run = runs.getRun(organizationId, req.params.runId);
      if (!run) throw httpError(404, 'Run not found');
      const success = terminateBackgroundJob(req.params.runId, req.params.jobId);
      return { success };
    },
  });
}