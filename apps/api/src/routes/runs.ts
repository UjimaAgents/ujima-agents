import type { FastifyInstance } from "fastify";
import { ApprovalResolveSchema, OrganizationQuerySchema, RunCreateSchema } from "../schemas.ts";

export default async function runRoutes(fastify: FastifyInstance) {
  fastify.get("/api/runs", async (request, reply) => {
    const query = OrganizationQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: "organizationId is required" });
    }

    try {
      return fastify.services.runs.listRuns(query.data.organizationId);
    } catch (error) {
      return reply.code(404).send({ error: (error as Error).message });
    }
  });

  fastify.get("/api/runs/:runId", async (request, reply) => {
    const query = OrganizationQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: "organizationId is required" });
    }

    const { runId } = request.params as { runId: string };
    try {
      const run = fastify.services.runs.getRun(query.data.organizationId, runId);
      if (!run) {
        return reply.code(404).send({ error: "Run not found" });
      }
      return run;
    } catch (error) {
      return reply.code(404).send({ error: (error as Error).message });
    }
  });

  fastify.post("/api/runs", async (request, reply) => {
    const body = RunCreateSchema.parse(request.body);
    try {
      return fastify.services.runs.createRun({
        organizationId: body.organizationId,
        agentId: body.agentId,
        threadId: body.threadId,
        summary: body.summary,
      });
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(message.startsWith("Member not found") || message.startsWith("Organization not found") ? 404 : 503).send({
        error: message,
      });
    }
  });

  fastify.post("/api/approvals/:approvalId/resolve", async (request, reply) => {
    const body = ApprovalResolveSchema.parse(request.body);
    const { approvalId } = request.params as { approvalId: string };
    try {
      return fastify.services.approvals.resolveApproval({
        organizationId: body.organizationId,
        approvalId,
        status: body.status,
        reason: body.reason,
      });
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(message.startsWith("Approval not found") ? 404 : 400).send({ error: message });
    }
  });
}
