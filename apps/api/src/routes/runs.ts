import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { PaginationQuerySchema, IdSchema, RunStateSchema, ApprovalRequestSchema, createPaginatedSchema } from "@ujima/shared";
import { ApprovalResolveSchema, OrganizationQuerySchema, RunCreateSchema } from "../schemas.ts";
import { z } from "zod";

export default async function runRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/api/runs", {
    schema: {
      summary: "List agent runs",
      description: "Retrieve a paginated list of agent execution runs for the organization.",
      tags: ["Runs"],
      querystring: OrganizationQuerySchema.merge(PaginationQuerySchema),
      response: {
        200: createPaginatedSchema(RunStateSchema),
        400: z.object({ error: z.string() }),
      },
    },
  }, async (request, reply) => {
    try {
      const { organizationId, cursor, limit } = request.query;
      return fastify.services.runs.listRuns(organizationId, cursor, limit);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get("/api/runs/:runId", {
    schema: {
      summary: "Get run details",
      description: "Retrieve detailed status and summary information for a specific agent execution run.",
      tags: ["Runs"],
      params: z.object({
        runId: IdSchema,
      }),
      querystring: OrganizationQuerySchema,
      response: {
        200: RunStateSchema,
        400: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
      },
    },
  }, async (request, reply) => {
    try {
      const { runId } = request.params;
      const { organizationId } = request.query;
      const run = fastify.services.runs.getRun(organizationId, runId);
      if (!run) {
        return reply.code(404).send({ error: "Run not found" });
      }
      return run;
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/api/runs", {
    schema: {
      summary: "Start agent run",
      description: "Initialize and trigger a new execution run for a specific agent in a thread.",
      tags: ["Runs"],
      body: RunCreateSchema,
      response: {
        200: RunStateSchema,
        404: z.object({ error: z.string() }),
        503: z.object({ error: z.string() }),
      },
    },
  }, async (request, reply) => {
    try {
      return fastify.services.runs.createRun(request.body);
    } catch (error) {
      const message = (error as Error).message;
      const status = message.startsWith("Member not found") || message.startsWith("Organization not found") ? 404 : 503;
      return reply.code(status).send({ error: message });
    }
  });

  app.post("/api/approvals/:approvalId/resolve", {
    schema: {
      summary: "Resolve tool approval",
      description: "Approve or reject a pending tool execution request.",
      tags: ["Approvals"],
      params: z.object({
        approvalId: IdSchema,
      }),
      body: ApprovalResolveSchema,
      response: {
        200: ApprovalRequestSchema,
        400: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
      },
    },
  }, async (request, reply) => {
    const { approvalId } = request.params;
    try {
      return fastify.services.approvals.resolveApproval({
        organizationId: request.body.organizationId,
        approvalId,
        status: request.body.status,
        reason: request.body.reason,
      });
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(message.startsWith("Approval not found") ? 404 : 400).send({ error: message });
    }
  });
}
