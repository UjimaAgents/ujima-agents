import type { FastifyInstance, FastifyReply } from 'fastify';
import { IdSchema } from '@ujima/shared';
import {
  ApprovalListQuerySchema,
  ApprovalResolveSchema,
  RunCreateSchema,
  RunListQuerySchema,
} from '@ujima/api-schema';
import type { ApprovalService, RunService } from '@ujima/orchestrator';
import { z } from 'zod';

const RunIdParamsSchema = z.object({ runId: IdSchema });
const ApprovalIdParamsSchema = z.object({ approvalId: IdSchema });
const RunDetailQuerySchema = z.object({ organizationId: IdSchema });

export interface RunRoutesOptions {
  runs: RunService;
  approvals: ApprovalService;
}

export function registerRunRoutes(
  app: FastifyInstance,
  options: RunRoutesOptions,
): void {
  const { runs, approvals } = options;

  app.get('/api/runs', async (req, reply) => {
    const query = RunListQuerySchema.safeParse(req.query);
    if (!query.success) return badRequest(reply, query.error.message);
    try {
      return runs.listRuns(query.data.organizationId, query.data.cursor, query.data.limit);
    } catch (err) {
      return badRequest(reply, errMessage(err));
    }
  });

  app.get('/api/runs/:runId', async (req, reply) => {
    const params = RunIdParamsSchema.safeParse(req.params);
    if (!params.success) return badRequest(reply, params.error.message);
    const query = RunDetailQuerySchema.safeParse(req.query);
    if (!query.success) return badRequest(reply, query.error.message);
    try {
      const run = runs.getRun(query.data.organizationId, params.data.runId);
      if (!run) return notFound(reply, 'Run not found');
      return run;
    } catch (err) {
      return badRequest(reply, errMessage(err));
    }
  });

  app.get('/api/runs/:runId/detail', async (req, reply) => {
    const params = RunIdParamsSchema.safeParse(req.params);
    if (!params.success) return badRequest(reply, params.error.message);
    const query = RunDetailQuerySchema.safeParse(req.query);
    if (!query.success) return badRequest(reply, query.error.message);
    try {
      const detail = runs.getRunDetail(query.data.organizationId, params.data.runId);
      if (!detail) return notFound(reply, 'Run not found');
      return detail;
    } catch (err) {
      return badRequest(reply, errMessage(err));
    }
  });

  app.post('/api/runs', async (req, reply) => {
    const body = RunCreateSchema.safeParse(req.body);
    if (!body.success) return badRequest(reply, body.error.message);
    try {
      return await runs.createRun(body.data);
    } catch (err) {
      const message = errMessage(err);
      const status =
        message.startsWith('Member not found') || message.startsWith('Organization not found')
          ? 404
          : 503;
      return reply.code(status).send({ error: message });
    }
  });

  app.get('/api/approvals', async (req, reply) => {
    const query = ApprovalListQuerySchema.safeParse(req.query);
    if (!query.success) return badRequest(reply, query.error.message);
    try {
      return approvals.listPending(query.data.organizationId);
    } catch (err) {
      return badRequest(reply, errMessage(err));
    }
  });

  app.post('/api/approvals/:approvalId/resolve', async (req, reply) => {
    const params = ApprovalIdParamsSchema.safeParse(req.params);
    if (!params.success) return badRequest(reply, params.error.message);
    const body = ApprovalResolveSchema.safeParse(req.body);
    if (!body.success) return badRequest(reply, body.error.message);
    try {
      return await approvals.resolveApproval({
        organizationId: body.data.organizationId,
        approvalId: params.data.approvalId,
        status: body.data.status,
        reason: body.data.reason,
      });
    } catch (err) {
      const message = errMessage(err);
      return reply
        .code(message.startsWith('Approval not found') ? 404 : 400)
        .send({ error: message });
    }
  });
}

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: message });
}

function notFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(404).send({ error: message });
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
