import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AgentMcpAttachInputSchema,
  AgentMcpAttachmentsResponseSchema,
  ApiErrorSchema,
  CreateMcpServerRequestSchema,
  ImportMcpServersRequestSchema,
  ImportMcpServersResponseSchema,
  McpScopedQuerySchema,
  McpServerListResponseSchema,
  McpServerResponseSchema,
  McpToolsResponseSchema,
  TestMcpResponseSchema,
  UpdateMcpServerRequestSchema,
} from '@ujima/api-schema';
import type { AuthService, McpRegistryService } from '@ujima/orchestrator';
import { requireOrgSession } from './org-auth.js';
import { apiError } from './route-errors.js';

// REST surface for the MCP registry (Phase 3 of the MCP integration).
//
// Routing convention:
//   * /settings/mcps              — server CRUD + import + test + tools
//   * /settings/agents/:id/mcps   — per-agent attachments
//
// All responses go through the registry's redacted `McpServerPublic`
// shape (or the cached tool list). Secrets never leave the daemon.

export interface McpRoutesOptions {
  auth: AuthService;
  mcpRegistry: McpRegistryService;
}

const ServerIdParamsSchema = z.object({ id: z.string().min(1) });
const AgentMcpParamsSchema = z.object({
  agentId: z.string().min(1),
  mcpServerId: z.string().min(1),
});
const AgentParamsSchema = z.object({ agentId: z.string().min(1) });

export function registerMcpRoutes(
  fastify: FastifyInstance,
  options: McpRoutesOptions,
): void {
  const { auth, mcpRegistry } = options;
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // -------- Server CRUD ------------------------------------------------

  app.get('/settings/mcps', {
    schema: {
      description: 'List MCP servers registered for an organization',
      tags: ['MCP'],
      querystring: McpScopedQuerySchema,
      response: {
        200: McpServerListResponseSchema,
        404: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const forbidden = requireOrgSession(auth, req, reply, req.query.organizationId);
      if (forbidden) return forbidden;
      return { servers: mcpRegistry.list(req.query.organizationId) };
    } catch (err) {
      return handle(reply, err);
    }
  });

  app.post('/settings/mcps', {
    schema: {
      description: 'Register a new MCP server',
      tags: ['MCP'],
      body: CreateMcpServerRequestSchema,
      response: {
        200: McpServerResponseSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
        409: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const forbidden = requireOrgSession(auth, req, reply, req.body.organizationId);
      if (forbidden) return forbidden;
      const server = mcpRegistry.create(req.body);
      return { server };
    } catch (err) {
      return handle(reply, err);
    }
  });

  app.post('/settings/mcps/import', {
    schema: {
      description:
        'Bulk-import MCP servers from a Claude Desktop / `servers` / bare keyed-map JSON config',
      tags: ['MCP'],
      body: ImportMcpServersRequestSchema,
      response: {
        200: ImportMcpServersResponseSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const forbidden = requireOrgSession(auth, req, reply, req.body.organizationId);
      if (forbidden) return forbidden;
      return mcpRegistry.import(req.body);
    } catch (err) {
      return handle(reply, err);
    }
  });

  app.patch('/settings/mcps/:id', {
    schema: {
      description: 'Update an MCP server (name, env, headers, status, etc.)',
      tags: ['MCP'],
      params: ServerIdParamsSchema,
      body: UpdateMcpServerRequestSchema,
      response: {
        200: McpServerResponseSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const body = req.body;
      const forbidden = requireOrgSession(auth, req, reply, body.organizationId);
      if (forbidden) return forbidden;
      const server = mcpRegistry.update({
        organizationId: body.organizationId,
        serverId: req.params.id,
        name: body.name,
        description: body.description,
        category: body.category,
        command: body.command,
        args: body.args,
        env: body.env === null ? {} : body.env,
        url: body.url,
        headers: body.headers === null ? {} : body.headers,
        isolation: body.isolation,
        status: body.status,
      });
      return { server };
    } catch (err) {
      return handle(reply, err);
    }
  });

  app.delete('/settings/mcps/:id', {
    schema: {
      description: 'Delete an MCP server. Cascades attachments + tool cache.',
      tags: ['MCP'],
      params: ServerIdParamsSchema,
      querystring: McpScopedQuerySchema,
      response: {
        204: z.null(),
        404: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const forbidden = requireOrgSession(auth, req, reply, req.query.organizationId);
      if (forbidden) return forbidden;
      mcpRegistry.delete(req.query.organizationId, req.params.id);
      return reply.status(204).send();
    } catch (err) {
      return handle(reply, err);
    }
  });

  // -------- Test + tool list -------------------------------------------

  app.post('/settings/mcps/:id/test', {
    schema: {
      description:
        'Open a one-shot connection to the configured MCP server, call listTools, and cache the result.',
      tags: ['MCP'],
      params: ServerIdParamsSchema,
      querystring: McpScopedQuerySchema,
      response: {
        200: TestMcpResponseSchema,
        404: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const forbidden = requireOrgSession(auth, req, reply, req.query.organizationId);
      if (forbidden) return forbidden;
      const result = await mcpRegistry.test(req.query.organizationId, req.params.id);
      return result;
    } catch (err) {
      return handle(reply, err);
    }
  });

  app.get('/settings/mcps/:id/tools', {
    schema: {
      description: 'Return the cached tool inventory for an MCP server',
      tags: ['MCP'],
      params: ServerIdParamsSchema,
      querystring: McpScopedQuerySchema,
      response: {
        200: McpToolsResponseSchema,
        404: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const forbidden = requireOrgSession(auth, req, reply, req.query.organizationId);
      if (forbidden) return forbidden;
      return { tools: mcpRegistry.listTools(req.query.organizationId, req.params.id) };
    } catch (err) {
      return handle(reply, err);
    }
  });

  // -------- Per-agent attachments --------------------------------------

  app.get('/settings/agents/:agentId/mcps', {
    schema: {
      description: 'List the MCP attachments for an agent',
      tags: ['MCP'],
      params: AgentParamsSchema,
      querystring: McpScopedQuerySchema,
      response: {
        200: AgentMcpAttachmentsResponseSchema,
        404: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const forbidden = requireOrgSession(auth, req, reply, req.query.organizationId);
      if (forbidden) return forbidden;
      return {
        attachments: mcpRegistry.listAttachments(req.query.organizationId, req.params.agentId),
      };
    } catch (err) {
      return handle(reply, err);
    }
  });

  app.post('/settings/agents/:agentId/mcps', {
    schema: {
      description: 'Attach an MCP server to an agent (worker / supervisor / both)',
      tags: ['MCP'],
      params: AgentParamsSchema,
      body: AgentMcpAttachInputSchema,
      response: {
        204: z.null(),
        400: ApiErrorSchema,
        404: ApiErrorSchema,
        409: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const forbidden = requireOrgSession(auth, req, reply, req.body.organizationId);
      if (forbidden) return forbidden;
      mcpRegistry.attach({
        organizationId: req.body.organizationId,
        memberId: req.params.agentId,
        mcpServerId: req.body.mcpServerId,
        scope: req.body.scope,
      });
      return reply.status(204).send();
    } catch (err) {
      return handle(reply, err);
    }
  });

  app.delete('/settings/agents/:agentId/mcps/:mcpServerId', {
    schema: {
      description: 'Detach an MCP server from an agent',
      tags: ['MCP'],
      params: AgentMcpParamsSchema,
      querystring: McpScopedQuerySchema,
      response: {
        204: z.null(),
        404: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const forbidden = requireOrgSession(auth, req, reply, req.query.organizationId);
      if (forbidden) return forbidden;
      mcpRegistry.detach(req.query.organizationId, req.params.agentId, req.params.mcpServerId);
      return reply.status(204).send();
    } catch (err) {
      return handle(reply, err);
    }
  });
}

/**
 * Map an MCP-route error to an HTTP status + code + message. Pure so a
 * unit test can pin the mapping without spinning up Fastify.
 *
 * Buckets:
 *   * 404 — caller addressed something that doesn't exist
 *   * 409 — state conflict (already-present, disabled, wrong-kind, retired)
 *   * 400 — EXPLICIT validation allowlist. The catch-all is 500, NOT
 *           400, so unknown server faults (DB outage, secret-store
 *           I/O, MCP connection blip) don't get silently labelled as
 *           "your request was malformed" — that mislabelling hides
 *           real incidents from monitoring/retry tooling and makes
 *           triage much harder.
 *   * 500 — anything else.
 */
export function mapMcpRouteError(err: unknown): {
  status: number;
  code: 'ERR_NOT_FOUND' | 'ERR_CONFLICT' | 'ERR_BAD_REQUEST' | 'ERR_INTERNAL';
  message: string;
} {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.startsWith('Organization not found') ||
    message.startsWith('MCP server not found') ||
    message.startsWith('Member not found')
  ) {
    return { status: 404, code: 'ERR_NOT_FOUND', message };
  }
  if (
    message.includes('already exists') ||
    message.includes('is disabled') ||
    message.includes('retired') ||
    message.includes('non-agent')
  ) {
    return { status: 409, code: 'ERR_CONFLICT', message };
  }
  if (
    message.startsWith('MCP server name is required') ||
    message.startsWith('stdio MCP servers require') ||
    message.includes('MCP servers require a url') ||
    message.startsWith('Failed to parse MCP config JSON')
  ) {
    return { status: 400, code: 'ERR_BAD_REQUEST', message };
  }
  return { status: 500, code: 'ERR_INTERNAL', message };
}

function handle(reply: FastifyReply, err: unknown): FastifyReply {
  const { status, code, message } = mapMcpRouteError(err);
  return apiError(reply, status, message, code);
}
