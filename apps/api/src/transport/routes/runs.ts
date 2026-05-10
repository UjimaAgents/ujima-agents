import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Repository } from '@ujima/runtime-core';
import { ApprovalRequestSchema, MessageSchema, RunStateSchema, createPaginatedSchema, IdSchema } from '@ujima/shared';
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
import type { ApprovalService, AuthService, RunService } from '@ujima/orchestrator';
import { listBackgroundJobs, peekBackgroundJob, terminateBackgroundJob } from '@ujima/orchestrator';
import { z } from 'zod';
import {
  ERR_NO_WORKSPACE_ROOT,
  assertReadyWorkspaceRoot,
  isWorkspaceRootNotReadyError,
} from './workspace-root.js';
import { requireOrgSession } from './org-auth.js';

const RunIdParamsSchema = z.object({ runId: IdSchema });
const ApprovalIdParamsSchema = z.object({ approvalId: IdSchema });
const JobIdParamsSchema = z.object({ runId: IdSchema, jobId: z.string() });
const RunDetailQuerySchema = z.object({ organizationId: IdSchema });
const RunListResponseSchema = createPaginatedSchema(RunStateSchema);
const RunDetailResponseSchema = z.object({
  run: RunStateSchema,
  approvals: z.array(ApprovalRequestSchema),
  messages: z.array(MessageSchema),
});

export interface RunRoutesOptions {
  repo: Repository;
  runs: RunService;
  approvals: ApprovalService;
  auth: AuthService;
}

export function registerRunRoutes(
  _app: FastifyInstance,
  options: RunRoutesOptions,
): void {
  const { repo, runs, approvals, auth } = options;
  const app = _app.withTypeProvider<ZodTypeProvider>();

  app.get('/runs', {
    schema: {
      description: 'List runs for an organization',
      tags: ['Runs'],
      querystring: RunListQuerySchema,
      response: {
        200: RunListResponseSchema,
        400: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      return runs.listRuns(req.query.organizationId, req.query.cursor, req.query.limit);
    } catch (err) {
      return badRequest(reply, errMessage(err));
    }
  });

  app.get('/runs/:runId', {
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
  }, async (req, reply) => {
    try {
      const run = runs.getRun(req.query.organizationId, req.params.runId);
      if (!run) return notFound(reply, 'Run not found');
      return run;
    } catch (err) {
      return badRequest(reply, errMessage(err));
    }
  });

  app.get('/runs/:runId/detail', {
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
  }, async (req, reply) => {
    try {
      const detail = runs.getRunDetail(req.query.organizationId, req.params.runId);
      if (!detail) return notFound(reply, 'Run not found');
      return detail;
    } catch (err) {
      return badRequest(reply, errMessage(err));
    }
  });

  app.post('/runs', {
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
  }, async (req, reply) => {
    try {
      assertReadyWorkspaceRoot(repo, req.body.organizationId);
      const forbidden = requireOrgSession(auth, req, reply, req.body.organizationId);
      if (forbidden) return forbidden;
      return await runs.createRun(req.body);
    } catch (err) {
      const message = errMessage(err);
      if (isWorkspaceRootNotReadyError(err)) {
        return reply.code(409).send({ code: ERR_NO_WORKSPACE_ROOT, message });
      }
      const status =
        message.startsWith('Member not found') || message.startsWith('Organization not found')
          ? 404
          : 503;
      return replyError(reply, status, message);
    }
  });

  app.post('/runs/:runId/cancel', {
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
  }, async (req, reply) => {
    try {
      assertReadyWorkspaceRoot(repo, req.body.organizationId);
      const forbidden = requireOrgSession(auth, req, reply, req.body.organizationId);
      if (forbidden) return forbidden;
      return runs.cancelRun(req.body.organizationId, req.params.runId);
    } catch (err) {
      const message = errMessage(err);
      if (isWorkspaceRootNotReadyError(err)) {
        return reply.code(409).send({ code: ERR_NO_WORKSPACE_ROOT, message });
      }
      if (message.startsWith('Run not found')) {
        return notFound(reply, message);
      }
      return replyError(reply, 400, message);
    }
  });

  app.get('/approvals', {
    schema: {
      description: 'List pending approvals',
      tags: ['Runs'],
      querystring: ApprovalListQuerySchema,
      response: {
        200: z.array(ApprovalRequestSchema),
        400: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      return approvals.listPending(req.query.organizationId);
    } catch (err) {
      return badRequest(reply, errMessage(err));
    }
  });

  app.post('/approvals/:approvalId/resolve', {
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
  }, async (req, reply) => {
    try {
      assertReadyWorkspaceRoot(repo, req.body.organizationId);
      const forbidden = requireOrgSession(auth, req, reply, req.body.organizationId);
      if (forbidden) return forbidden;
      const status =
        req.body.resolution === 'reject' ? 'rejected' : 'approved';
      return await approvals.resolveApproval({
        organizationId: req.body.organizationId,
        approvalId: req.params.approvalId,
        status,
        resolution: req.body.resolution,
        reason: req.body.reason,
      });
    } catch (err) {
      const message = errMessage(err);
      if (isWorkspaceRootNotReadyError(err)) {
        return reply.code(409).send({ code: ERR_NO_WORKSPACE_ROOT, message });
      }
      return reply
        .code(message.startsWith('Approval not found') ? 404 : 400)
        .send({ code: message.startsWith('Approval not found') ? 'ERR_NOT_FOUND' : 'ERR_BAD_REQUEST', message });
    }
  });

  app.get('/runs/:runId/jobs', {
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
  }, async (req, reply) => {
    try {
      const { organizationId } = RunDetailQuerySchema.parse(req.query);
      const forbidden = requireOrgSession(auth, req, reply, organizationId);
      if (forbidden) return forbidden;
      const run = runs.getRun(organizationId, req.params.runId);
      if (!run) return notFound(reply, 'Run not found');
      return listBackgroundJobs(req.params.runId);
    } catch (err) {
      return badRequest(reply, errMessage(err));
    }
  });

  app.get('/runs/:runId/jobs/:jobId', {
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
  }, async (req, reply) => {
    try {
      const { organizationId } = ShellJobDetailQuerySchema.parse(req.query);
      const forbidden = requireOrgSession(auth, req, reply, organizationId);
      if (forbidden) return forbidden;
      const run = runs.getRun(organizationId, req.params.runId);
      if (!run) return notFound(reply, 'Run not found');
      const snapshot = peekBackgroundJob(req.params.runId, req.params.jobId);
      if (!snapshot) {
        return notFound(reply, 'Background job not found');
      }
      return snapshot;
    } catch (err) {
      return badRequest(reply, errMessage(err));
    }
  });

  app.post('/runs/:runId/jobs/:jobId/terminate', {
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
  }, async (req, reply) => {
    try {
      const forbidden = requireOrgSession(auth, req, reply, req.body.organizationId);
      if (forbidden) return forbidden;
      const run = runs.getRun(req.body.organizationId, req.params.runId);
      if (!run) return notFound(reply, 'Run not found');

      const success = terminateBackgroundJob(req.params.runId, req.params.jobId);
      return { success };
    } catch (err) {
      return badRequest(reply, errMessage(err));
    }
  });
}

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return replyError(reply, 400, message);
}

function notFound(reply: FastifyReply, message: string): FastifyReply {
  return replyError(reply, 404, message);
}

function replyError(reply: FastifyReply, status: number, message: string): FastifyReply {
  const code = status === 404 ? 'ERR_NOT_FOUND' : status === 503 ? 'ERR_INTERNAL' : 'ERR_BAD_REQUEST';
  return reply.code(status).send({ code, message });
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
