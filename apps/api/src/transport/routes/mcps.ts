import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  AgentMcpAttachInputSchema,
  AgentMcpAttachmentResponseSchema,
  AgentMcpAttachmentsResponseSchema,
  AgentToolGrantsResponseSchema,
  ApiErrorSchema,
  CreateMcpServerRequestSchema,
  GrantToolRequestSchema,
  GrantToolResponseSchema,
  ImportMcpServersRequestSchema,
  ImportMcpServersResponseSchema,
  McpCatalogQuerySchema,
  McpCatalogResponseSchema,
  McpScopedQuerySchema,
  McpServerListResponseSchema,
  McpServerResponseSchema,
  McpToolsResponseSchema,
  RefreshTierCurationRequestSchema,
  RefreshTierCurationResponseSchema,
  TestMcpResponseSchema,
  TierCurationSuggestionResponseSchema,
  TierCurationSuggestionsResponseSchema,
  UpdateTierCurationSuggestionStatusRequestSchema,
  ToolClassificationResponseSchema,
  ChannelMcpAttachInputSchema,
  ChannelMcpAttachmentResponseSchema,
  ChannelMcpAttachmentsResponseSchema,
  UpdateAttachmentTierRequestSchema,
  UpdateChannelAttachmentTierRequestSchema,
  UpdateMcpServerRequestSchema,
  UpdateToolClassificationRequestSchema,
} from '@ujima/api-schema';
import type {
  ApiRepository,
  AuthService,
  McpRegistryService,
  TierCurationService,
} from '@ujima/orchestrator';
import { apiError } from './route-errors.js';
import {
  registerOrgSettingsRoute,
  settingsServerErrors,
  withTypeProvider,
} from './org-settings-route.js';

export interface McpRoutesOptions {
  auth: AuthService;
  mcpRegistry: McpRegistryService;
  tierCuration: TierCurationService;
  repo: ApiRepository;
}

const ServerIdParamsSchema = z.object({ id: z.string().min(1) });
const ServerIdToolParamsSchema = z.object({
  id: z.string().min(1),
  toolName: z.string().min(1),
});
const AgentMcpParamsSchema = z.object({
  agentId: z.string().min(1),
  mcpServerId: z.string().min(1),
});
const AgentToolParamsSchema = z.object({
  agentId: z.string().min(1),
  mcpServerId: z.string().min(1),
  toolName: z.string().min(1),
});
const AgentParamsSchema = z.object({ agentId: z.string().min(1) });
const ChannelParamsSchema = z.object({ channelId: z.string().min(1) });
const ChannelMcpParamsSchema = z.object({
  channelId: z.string().min(1),
  mcpServerId: z.string().min(1),
});

const mcpErrors = settingsServerErrors;
const mcpWriteErrors = { ...mcpErrors, 400: ApiErrorSchema, 409: ApiErrorSchema };
const attachmentsResponse = { 200: AgentMcpAttachmentsResponseSchema, ...mcpErrors };

function mcpHandle(reply: FastifyReply, err: unknown): FastifyReply {
  const { status, code, message } = mapMcpRouteError(err);
  return apiError(reply, status, message, code);
}

export function registerMcpRoutes(
  fastify: FastifyInstance,
  options: McpRoutesOptions,
): void {
  const { auth, mcpRegistry, tierCuration, repo } = options;
  const app = withTypeProvider(fastify);

  registerOrgSettingsRoute(app, 'get', '/settings/mcps', auth, {
    tags: ['MCP'],
    description: 'List MCP servers registered for an organization',
    querystring: McpScopedQuerySchema,
    response: { 200: McpServerListResponseSchema, ...mcpErrors },
    organizationId: (req) => (req.query as { organizationId: string }).organizationId,
    onError: mcpHandle,
    handler: async (_req, organizationId) => ({ servers: mcpRegistry.list(organizationId) }),
  });

  registerOrgSettingsRoute(app, 'post', '/settings/mcps', auth, {
    tags: ['MCP'],
    description: 'Register a new MCP server',
    body: CreateMcpServerRequestSchema,
    response: { 200: McpServerResponseSchema, ...mcpWriteErrors },
    organizationId: (req) => (req.body as { organizationId: string }).organizationId,
    onError: mcpHandle,
    handler: async (req) => ({ server: mcpRegistry.create(req.body as never) }),
  });

  registerOrgSettingsRoute(app, 'post', '/settings/mcps/import', auth, {
    tags: ['MCP'],
    description:
      'Bulk-import MCP servers from a Claude Desktop / `servers` / bare keyed-map JSON config',
    body: ImportMcpServersRequestSchema,
    response: { 200: ImportMcpServersResponseSchema, ...mcpWriteErrors },
    organizationId: (req) => (req.body as { organizationId: string }).organizationId,
    onError: mcpHandle,
    handler: async (req) => mcpRegistry.import(req.body as never),
  });

  registerOrgSettingsRoute(app, 'patch', '/settings/mcps/:id', auth, {
    tags: ['MCP'],
    description: 'Update an MCP server (name, env, headers, status, etc.)',
    params: ServerIdParamsSchema,
    body: UpdateMcpServerRequestSchema,
    response: { 200: McpServerResponseSchema, ...mcpWriteErrors },
    organizationId: (req) => (req.body as { organizationId: string }).organizationId,
    onError: mcpHandle,
    handler: async (req, organizationId) => {
      const body = req.body as z.infer<typeof UpdateMcpServerRequestSchema>;
      return {
        server: mcpRegistry.update({
          organizationId,
          serverId: (req.params as { id: string }).id,
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
        }),
      };
    },
  });

  registerOrgSettingsRoute(app, 'delete', '/settings/mcps/:id', auth, {
    tags: ['MCP'],
    description: 'Delete an MCP server. Cascades attachments + tool cache.',
    params: ServerIdParamsSchema,
    querystring: McpScopedQuerySchema,
    response: { 204: z.null(), ...mcpErrors },
    organizationId: (req) => (req.query as { organizationId: string }).organizationId,
    onError: mcpHandle,
    successStatus: 204,
    handler: async (req, organizationId) => {
      mcpRegistry.delete(organizationId, (req.params as { id: string }).id);
    },
  });

  registerOrgSettingsRoute(app, 'post', '/settings/mcps/:id/test', auth, {
    tags: ['MCP'],
    description:
      'Open a one-shot connection to the configured MCP server, call listTools, and cache the result.',
    params: ServerIdParamsSchema,
    querystring: McpScopedQuerySchema,
    response: {
      200: TestMcpResponseSchema,
      502: TestMcpResponseSchema,
      404: ApiErrorSchema,
      500: ApiErrorSchema,
    },
    organizationId: (req) => (req.query as { organizationId: string }).organizationId,
    onError: mcpHandle,
    handler: async (req, organizationId) =>
      mcpRegistry.test(organizationId, (req.params as { id: string }).id),
    respond: (reply, result) =>
      reply.status((result as { ok: boolean }).ok ? 200 : 502).send(result),
  });

  registerOrgSettingsRoute(app, 'get', '/settings/mcps/:id/tools', auth, {
    tags: ['MCP'],
    description: 'Return the cached tool inventory for an MCP server',
    params: ServerIdParamsSchema,
    querystring: McpScopedQuerySchema,
    response: { 200: McpToolsResponseSchema, ...mcpErrors },
    organizationId: (req) => (req.query as { organizationId: string }).organizationId,
    onError: mcpHandle,
    handler: async (req, organizationId) => ({
      tools: mcpRegistry.listTools(organizationId, (req.params as { id: string }).id),
    }),
  });

  // ----- Governance catalog + classification ------------------------

  registerOrgSettingsRoute(app, 'get', '/settings/mcps/catalog', auth, {
    tags: ['MCP'],
    description:
      'Unified governance catalog. When `agentId` is set, the response includes per-(server,tool) effective decisions for that agent plus an `exposed` flag indicating whether the tool reaches the model.',
    querystring: McpCatalogQuerySchema,
    response: { 200: McpCatalogResponseSchema, ...mcpErrors },
    organizationId: (req) => (req.query as { organizationId: string }).organizationId,
    onError: mcpHandle,
    handler: async (req, organizationId) => {
      const query = req.query as {
        organizationId: string;
        agentId?: string;
        role?: 'worker' | 'supervisor';
      };
      return mcpRegistry.getCatalog(organizationId, query.agentId, query.role);
    },
  });

  registerOrgSettingsRoute(
    app,
    'patch',
    '/settings/mcps/:id/tools/:toolName/classification',
    auth,
    {
      tags: ['MCP'],
      description:
        'Set the risk classification for a single MCP tool. Always writes source=manual and clears needsReview.',
      params: ServerIdToolParamsSchema,
      body: UpdateToolClassificationRequestSchema,
      response: { 200: ToolClassificationResponseSchema, ...mcpWriteErrors },
      organizationId: (req) => (req.body as { organizationId: string }).organizationId,
      onError: mcpHandle,
      handler: async (req, organizationId) => {
        const params = req.params as { id: string; toolName: string };
        const body = req.body as z.infer<typeof UpdateToolClassificationRequestSchema>;
        const updatedBy =
          (req.headers['x-actor-id'] as string | undefined) ?? 'web-admin';
        mcpRegistry.setToolClassification({
          organizationId,
          serverId: params.id,
          toolName: params.toolName,
          risk: body.risk,
          reason: body.reason,
          updatedBy,
        });
        // Refresh from catalog so the response carries the same shape
        // the UI gets elsewhere (with `effective` + `attachedAgents`).
        const catalog = mcpRegistry.getCatalog(organizationId);
        const server = catalog.servers.find((s) => s.id === params.id);
        const tool = server?.tools.find((t) => t.name === params.toolName);
        if (!tool) {
          throw new Error(`Tool "${params.toolName}" not found after update`);
        }
        return { tool };
      },
    },
  );

  registerOrgSettingsRoute(
    app,
    'delete',
    '/settings/mcps/:id/tools/:toolName/classification',
    auth,
    {
      tags: ['MCP'],
      description:
        'Reset a tool to its inferred classification. Drops the manual row and re-seeds from the heuristic.',
      params: ServerIdToolParamsSchema,
      querystring: McpScopedQuerySchema,
      response: { 200: ToolClassificationResponseSchema, ...mcpErrors },
      organizationId: (req) => (req.query as { organizationId: string }).organizationId,
      onError: mcpHandle,
      handler: async (req, organizationId) => {
        const params = req.params as { id: string; toolName: string };
        mcpRegistry.resetToolClassification(
          organizationId,
          params.id,
          params.toolName,
        );
        const catalog = mcpRegistry.getCatalog(organizationId);
        const server = catalog.servers.find((s) => s.id === params.id);
        const tool = server?.tools.find((t) => t.name === params.toolName);
        if (!tool) {
          throw new Error(`Tool "${params.toolName}" not found after reset`);
        }
        return { tool };
      },
    },
  );

  registerOrgSettingsRoute(app, 'get', '/settings/agents/:agentId/mcps', auth, {
    tags: ['MCP'],
    description: 'List the MCP attachments for an agent',
    params: AgentParamsSchema,
    querystring: McpScopedQuerySchema,
    response: attachmentsResponse,
    organizationId: (req) => (req.query as { organizationId: string }).organizationId,
    onError: mcpHandle,
    handler: async (req, organizationId) => ({
      attachments: mcpRegistry.listAttachments(
        organizationId,
        (req.params as { agentId: string }).agentId,
      ),
    }),
  });

  registerOrgSettingsRoute(app, 'post', '/settings/agents/:agentId/mcps', auth, {
    tags: ['MCP'],
    description: 'Attach an MCP server to an agent (worker / supervisor / both)',
    params: AgentParamsSchema,
    body: AgentMcpAttachInputSchema,
    response: { 204: z.null(), ...mcpWriteErrors },
    organizationId: (req) => (req.body as { organizationId: string }).organizationId,
    onError: mcpHandle,
    successStatus: 204,
    handler: async (req, organizationId) => {
      const body = req.body as z.infer<typeof AgentMcpAttachInputSchema>;
      mcpRegistry.attach({
        organizationId,
        memberId: (req.params as { agentId: string }).agentId,
        mcpServerId: body.mcpServerId,
        scope: body.scope,
      });
    },
  });

  registerOrgSettingsRoute(app, 'delete', '/settings/agents/:agentId/mcps/:mcpServerId', auth, {
    tags: ['MCP'],
    description: 'Detach an MCP server from an agent',
    params: AgentMcpParamsSchema,
    querystring: McpScopedQuerySchema,
    response: { 204: z.null(), ...mcpErrors },
    organizationId: (req) => (req.query as { organizationId: string }).organizationId,
    onError: mcpHandle,
    successStatus: 204,
    handler: async (req, organizationId) => {
      const params = req.params as { agentId: string; mcpServerId: string };
      mcpRegistry.detach(organizationId, params.agentId, params.mcpServerId);
    },
  });

  // PR 6 — tier toggle.
  registerOrgSettingsRoute(app, 'patch', '/settings/agents/:agentId/mcps/:mcpServerId/tier', auth, {
    tags: ['MCP'],
    description:
      "Update an agent's attachment tier on an MCP server. " +
      "'native' = the typed-palette path (legacy behavior, default for new attachments). " +
      "'dispatch' = the meta-tool dispatch path (catalog text + get_connector_tools / invoke_connector_tool). " +
      "Harmless metadata when the V2 spawn flag is off — the legacy spawn path is tier-blind.",
    params: AgentMcpParamsSchema,
    body: UpdateAttachmentTierRequestSchema,
    response: { 200: AgentMcpAttachmentResponseSchema, ...mcpWriteErrors },
    organizationId: (req) => (req.body as { organizationId: string }).organizationId,
    onError: mcpHandle,
    handler: async (req, organizationId) => {
      const params = req.params as { agentId: string; mcpServerId: string };
      const body = req.body as z.infer<typeof UpdateAttachmentTierRequestSchema>;
      return {
        attachment: mcpRegistry.updateAttachmentTier({
          organizationId,
          memberId: params.agentId,
          mcpServerId: params.mcpServerId,
          tier: body.tier,
        }),
      };
    },
  });

  // ---------------- PR 10 — Channel attachments -----------------------

  registerOrgSettingsRoute(app, 'get', '/settings/channels/:channelId/mcps', auth, {
    tags: ['MCP'],
    description:
      'List MCP servers attached to a channel. Every agent in the channel ' +
      'inherits these attachments via the §17.5.3 union step in V2 spawn — ' +
      'per-agent attachments still win on conflict.',
    params: ChannelParamsSchema,
    querystring: McpScopedQuerySchema,
    response: { 200: ChannelMcpAttachmentsResponseSchema, ...mcpErrors },
    organizationId: (req) => (req.query as { organizationId: string }).organizationId,
    onError: mcpHandle,
    handler: async (req, organizationId) => ({
      attachments: mcpRegistry.listChannelAttachments(
        organizationId,
        (req.params as { channelId: string }).channelId,
      ),
    }),
  });

  registerOrgSettingsRoute(app, 'post', '/settings/channels/:channelId/mcps', auth, {
    tags: ['MCP'],
    description:
      'Attach an MCP server to a channel. New channel attachments default ' +
      "to 'dispatch' tier — channels often bulk-attach 10+ MCPs and " +
      'dispatch keeps the §17.5.3 native palette small. Promote to native ' +
      'via the PATCH .../tier endpoint when usage data justifies it.',
    params: ChannelParamsSchema,
    body: ChannelMcpAttachInputSchema,
    response: { 204: z.null(), ...mcpWriteErrors },
    organizationId: (req) => (req.body as { organizationId: string }).organizationId,
    onError: mcpHandle,
    successStatus: 204,
    handler: async (req, organizationId) => {
      const body = req.body as z.infer<typeof ChannelMcpAttachInputSchema>;
      mcpRegistry.attachServerToChannel({
        organizationId,
        channelId: (req.params as { channelId: string }).channelId,
        mcpServerId: body.mcpServerId,
        scope: body.scope,
      });
    },
  });

  registerOrgSettingsRoute(
    app,
    'delete',
    '/settings/channels/:channelId/mcps/:mcpServerId',
    auth,
    {
      tags: ['MCP'],
      description: 'Detach an MCP server from a channel',
      params: ChannelMcpParamsSchema,
      querystring: McpScopedQuerySchema,
      response: { 204: z.null(), ...mcpErrors },
      organizationId: (req) => (req.query as { organizationId: string }).organizationId,
      onError: mcpHandle,
      successStatus: 204,
      handler: async (req, organizationId) => {
        const params = req.params as { channelId: string; mcpServerId: string };
        mcpRegistry.detachServerFromChannel(
          organizationId,
          params.channelId,
          params.mcpServerId,
        );
      },
    },
  );

  registerOrgSettingsRoute(
    app,
    'patch',
    '/settings/channels/:channelId/mcps/:mcpServerId/tier',
    auth,
    {
      tags: ['MCP'],
      description:
        "Update a channel's attachment tier on an MCP server. Resolves " +
        'via §17.5.3 during V2 spawn — per-agent attachments still win on ' +
        'conflict, and channel-vs-channel conflicts resolve to dispatch ' +
        '(lossless overflow). Harmless metadata when the dispatch flag is off.',
      params: ChannelMcpParamsSchema,
      body: UpdateChannelAttachmentTierRequestSchema,
      response: { 200: ChannelMcpAttachmentResponseSchema, ...mcpWriteErrors },
      organizationId: (req) => (req.body as { organizationId: string }).organizationId,
      onError: mcpHandle,
      handler: async (req, organizationId) => {
        const params = req.params as { channelId: string; mcpServerId: string };
        const body = req.body as z.infer<typeof UpdateChannelAttachmentTierRequestSchema>;
        return {
          attachment: mcpRegistry.updateChannelAttachmentTier({
            organizationId,
            channelId: params.channelId,
            mcpServerId: params.mcpServerId,
            tier: body.tier,
          }),
        };
      },
    },
  );

  // ---------------- Per-tool grants ----------------------------------

  registerOrgSettingsRoute(app, 'get', '/settings/agents/:agentId/tools', auth, {
    tags: ['MCP'],
    description:
      'List the per-tool grants for an agent. When the list is empty for an attached MCP, the runtime exposes all tools (back-compat). Any rows for a server flip it into allowlist mode.',
    params: AgentParamsSchema,
    querystring: McpScopedQuerySchema,
    response: { 200: AgentToolGrantsResponseSchema, ...mcpErrors },
    organizationId: (req) => (req.query as { organizationId: string }).organizationId,
    onError: mcpHandle,
    handler: async (req, organizationId) => {
      const params = req.params as { agentId: string };
      return {
        agentId: params.agentId,
        grants: mcpRegistry.listToolGrants(organizationId, params.agentId),
      };
    },
  });

  registerOrgSettingsRoute(
    app,
    'put',
    '/settings/agents/:agentId/tools/:mcpServerId/:toolName',
    auth,
    {
      tags: ['MCP'],
      description:
        'Grant a single MCP tool to an agent. Auto-attaches the MCP server if missing. Adding the first tool grant for an (agent, server) pair flips the runtime palette into allowlist mode for that server.',
      params: AgentToolParamsSchema,
      body: GrantToolRequestSchema,
      response: { 200: GrantToolResponseSchema, ...mcpWriteErrors },
      organizationId: (req) => (req.body as { organizationId: string }).organizationId,
      onError: mcpHandle,
      handler: async (req, organizationId) => {
        const params = req.params as {
          agentId: string;
          mcpServerId: string;
          toolName: string;
        };
        const body = req.body as { scope?: 'worker' | 'supervisor' | 'both' };
        return mcpRegistry.grantToolToAgent({
          organizationId,
          memberId: params.agentId,
          mcpServerId: params.mcpServerId,
          toolName: params.toolName,
          scope: body.scope,
        });
      },
    },
  );

  registerOrgSettingsRoute(
    app,
    'delete',
    '/settings/agents/:agentId/tools/:mcpServerId/:toolName',
    auth,
    {
      tags: ['MCP'],
      description:
        'Revoke a single tool grant. Removing the last grant for a server flips it back to "all tools" mode but does NOT detach the MCP server.',
      params: AgentToolParamsSchema,
      querystring: McpScopedQuerySchema,
      response: { 204: z.null(), ...mcpErrors },
      organizationId: (req) => (req.query as { organizationId: string }).organizationId,
      onError: mcpHandle,
      successStatus: 204,
      handler: async (req, organizationId) => {
        const params = req.params as {
          agentId: string;
          mcpServerId: string;
          toolName: string;
        };
        mcpRegistry.revokeToolFromAgent(
          organizationId,
          params.agentId,
          params.mcpServerId,
          params.toolName,
        );
      },
    },
  );

  // ---------------- PR 9 — tier curation suggestions -----------------

  // List pending demote/promote suggestions for the org. Empty array +
  // zero counters is the legitimate zero-state (no analyzer pass yet,
  // or the org has no idle/hot dispatch attachments). The panel
  // distinguishes that from a fetch error so operators don't see a
  // spinner forever.
  registerOrgSettingsRoute(
    app,
    'get',
    '/settings/mcps/tier-curation-suggestions',
    auth,
    {
      tags: ['MCP'],
      description:
        "List pending tier-curation suggestions for this org. " +
        "Each row is the analyzer's proposal — demote a never-called " +
        "native tool to dispatch (reclaim palette budget), or promote " +
        "a high-volume + high-error-rate dispatch tool to native " +
        "(typed schema reduces model-fumbling). Operators apply via " +
        "the existing PATCH /settings/agents/:agentId/mcps/:serverId/" +
        "tier endpoint. The §17.5 orthogonality invariant stays " +
        "intact: nothing here ever auto-applies.",
      querystring: McpScopedQuerySchema,
      response: { 200: TierCurationSuggestionsResponseSchema, ...mcpErrors },
      organizationId: (req) => (req.query as { organizationId: string }).organizationId,
      onError: mcpHandle,
      handler: async (_req, organizationId) => {
        const suggestions = repo.listTierCurationSuggestions(organizationId);
        const pending = suggestions.filter((s) => s.status === 'pending');
        return {
          suggestions: pending,
          summary: {
            pending: pending.length,
            demoteCount: pending.filter((s) => s.direction === 'demote').length,
            promoteCount: pending.filter((s) => s.direction === 'promote').length,
          },
        };
      },
    },
  );

  // Manual analyzer trigger. The §9.4 design has the job running on a
  // schedule, but exposing this lets operators force a refresh from
  // the panel (after they apply a tier flip, after a noisy run,
  // before a curation review meeting). Tunable thresholds let the
  // dogfood org probe the signal before we lock in defaults.
  registerOrgSettingsRoute(
    app,
    'post',
    '/settings/mcps/tier-curation-suggestions/refresh',
    auth,
    {
      tags: ['MCP'],
      description:
        'Run the §9.4 audit-driven analyzer right now and persist any ' +
        'demote/promote candidates it finds. Idempotent: the underlying ' +
        'UPSERT on (org, member, server, direction, status) preserves ' +
        'the original `created_at` so the panel can show "first ' +
        'surfaced N days ago" across repeated triggers.',
      body: RefreshTierCurationRequestSchema,
      response: { 200: RefreshTierCurationResponseSchema, ...mcpWriteErrors },
      organizationId: (req) => (req.body as { organizationId: string }).organizationId,
      onError: mcpHandle,
      handler: async (req, organizationId) => {
        const body = req.body as z.infer<typeof RefreshTierCurationRequestSchema>;
        return tierCuration.analyzeOrganization({
          organizationId,
          windowRuns: body.windowRuns,
          volumePerRunThreshold: body.volumePerRunThreshold,
          errorRateThreshold: body.errorRateThreshold,
        });
      },
    },
  );

  // Persist the operator's Apply/Dismiss decision. Without this the
  // panel can only optimistically drop the row from local state — a
  // refresh resurfaces the suggestion even though the underlying tier
  // flip has already been committed. The PATCH writes the
  // status + resolved_at columns so the next analyzer pass leaves the
  // applied row alone (UNIQUE on (org,member,server,direction,status)
  // means a fresh `pending` slot is available if the operator later
  // reverts).
  registerOrgSettingsRoute(
    app,
    'patch',
    '/settings/mcps/tier-curation-suggestions/:suggestionId',
    auth,
    {
      tags: ['MCP'],
      description:
        "Update the operator-decision status on a tier-curation " +
        "suggestion. 'applied' fires after a successful tier flip; " +
        "'dismissed' lets the operator hide a row without acting on " +
        "it. 'pending' is the analyzer default and shouldn't normally " +
        "be set by hand.",
      params: z.object({ suggestionId: z.string().min(1) }),
      body: UpdateTierCurationSuggestionStatusRequestSchema,
      response: { 200: TierCurationSuggestionResponseSchema, ...mcpWriteErrors },
      organizationId: (req) => (req.body as { organizationId: string }).organizationId,
      onError: mcpHandle,
      handler: async (req, organizationId) => {
        const body = req.body as z.infer<typeof UpdateTierCurationSuggestionStatusRequestSchema>;
        const params = req.params as { suggestionId: string };
        const updated = repo.updateTierCurationSuggestionStatus(
          organizationId,
          params.suggestionId,
          body.status,
          new Date().toISOString(),
        );
        if (!updated) {
          // Message starts with "Suggestion not found" so
          // mapMcpRouteError classifies it as 404 ERR_NOT_FOUND.
          throw new Error(`Suggestion not found: ${params.suggestionId}`);
        }
        return { suggestion: updated };
      },
    },
  );
}

export function mapMcpRouteError(err: unknown): {
  status: number;
  code: 'ERR_NOT_FOUND' | 'ERR_CONFLICT' | 'ERR_BAD_REQUEST' | 'ERR_INTERNAL';
  message: string;
} {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.startsWith('Organization not found') ||
    message.startsWith('MCP server not found') ||
    message.startsWith('Member not found') ||
    message.startsWith('Tool not found') ||
    message.startsWith('Attachment not found') ||
    message.startsWith('Suggestion not found') ||
    message.startsWith('Channel not found')
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
