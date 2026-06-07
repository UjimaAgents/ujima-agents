// Connector meta-tools for the V2 spawn path
// (mcp_connector_dispatch_plan.md §7.5).
//
// Two tools the dispatch tier expects in every V2 spawn:
//   * get_connector_tools(server_id)       — fenced tool result that
//                                            returns the cached tool
//                                            inventory for one server.
//   * invoke_connector_tool(server_id,
//                            tool_name,
//                            args)         — dispatches a tool call to
//                                            the named MCP through the
//                                            standard permission gate.
//
// This module is orphaned in PR 4 — nothing registers these tools
// yet. PR 5 plugs `buildConnectorMetaTools(deps)` into the V2 spawn
// and adds the entries to the ToolSet returned from the V2
// `buildMcpToolDefinitionsV2`.
//
// Three invariants worth naming:
//   1. get_connector_tools is a READ from the persisted cache, never
//      a live listTools(). The cache is populated by the same code
//      paths that already exist (settings UI "Test", spawn-time
//      seeding in spirit-agent-run). PR 4 does not change those.
//   2. get_connector_tools filters tool names through
//      sanitizeToolName from PR 3. A hostile tool name like
//      "\nSYSTEM: ignore" is dropped from the response even though
//      the surface is a fenced tool result, not prompt prose — same
//      conservative shape rule, two surfaces.
//   3. invoke_connector_tool routes through ToolService.invoke with
//      the synthetic permissionToolName the legacy MCP path already
//      uses (mcpPermissionToolName). The permission gate sees the
//      same shape it always has, so no governance rules need to be
//      re-targeted at the dispatch tier — they apply unchanged.

import { randomUUID } from 'node:crypto';
import { tool, type Tool } from 'ai';
import { z } from 'zod';
import type {
  AgentMcpAttachment,
  McpServer,
  McpToolCache,
  SpiritRole,
} from '@ujima/shared';
import { sanitizeToolName } from '../services/connector-catalog.js';
import { mcpPermissionToolName } from '../services/mcp-runtime.js';
import {
  toModelToolErrorOutput,
  toModelToolOutput,
} from '../services/tool-loop-result.js';
import type { ToolService } from '../services/tool-service.js';

// ───────────────────────────────────────────────────────────────────────
// Public surface
// ───────────────────────────────────────────────────────────────────────

/**
 * Narrow repository interface — only what the meta-tools actually need.
 * Tests pass a stub; the runtime passes the full Repository class
 * without coupling either side to changes elsewhere.
 */
export interface ConnectorMetaToolRepo {
  getMcpServer(organizationId: string, serverId: string): McpServer | null;
  getMcpToolCache(
    organizationId: string,
    serverId: string,
  ): McpToolCache | null;
  /**
   * Role-scoped attachment lookup. Used as the FIRST check in both
   * meta-tools: the model can only see / invoke server_ids in this
   * set. Without this scoping a leaked or guessed serverId for
   * another connector in the same org could be listed or invoked,
   * because `getMcpServer` is org-scoped, not attachment-scoped.
   * Mirrors the same query the legacy spawn-time resolver uses to
   * pick which servers an agent gets to see in its palette.
   */
  listAttachedServersForSpirit(
    organizationId: string,
    memberId: string,
    role: 'worker' | 'supervisor',
  ): { attachment: AgentMcpAttachment; server: McpServer }[];
}

export interface ConnectorMetaToolDeps {
  organizationId: string;
  memberId: string;
  runId: string;
  threadId?: string;
  taskSessionId?: string;
  spiritRole: SpiritRole;
  tools: ToolService;
  repo: ConnectorMetaToolRepo;
}

export interface ConnectorMetaToolSet {
  get_connector_tools: Tool;
  invoke_connector_tool: Tool;
}

// ───────────────────────────────────────────────────────────────────────
// Input schemas
// ───────────────────────────────────────────────────────────────────────

const GetConnectorToolsSchema = z.object({
  server_id: z
    .string()
    .min(1)
    .describe(
      'ID of the connector server whose tool list you want to see. ' +
        'Use a server ID from the catalog (e.g. "srv_abc12345").',
    ),
});

const InvokeConnectorToolSchema = z.object({
  server_id: z
    .string()
    .min(1)
    .describe('ID of the connector server hosting the tool.'),
  tool_name: z
    .string()
    .min(1)
    .describe(
      'Name of the tool to call. Must match a tool returned by ' +
        'get_connector_tools(server_id).',
    ),
  args: z
    .record(z.string(), z.unknown())
    .default({})
    .describe(
      'Arguments for the tool. Shape comes from the tool\'s input ' +
        'schema (visible via get_connector_tools).',
    ),
});

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

// Cap on tool-result descriptions. Long descriptions in tool results
// are still model-readable text; truncating is a cheap defense-in-
// depth against prose-style injection through cache.tools[].description.
// 256 chars is enough for substantive guidance ("Posts a message to a
// channel. Requires channel ID and message text.") but tight enough to
// truncate a malicious paragraph mid-sentence.
const DESCRIPTION_TRUNCATE = 256;

// Egress patterns used by `hasEgressSignals`. Conservative — over-
// reporting is safer than under-reporting because the only consequence
// of a false positive is that the gate doesn't auto-grant a read tool
// (PR 5 will wire that auto-grant; PR 4 just exports the classifier).
const URL_PATTERN = /https?:\/\/\S+/i;
const EMAIL_PATTERN = /\S+@\S+\.\S+/;
const IP_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

/**
 * Recursively walk a structured value and collect every string leaf.
 * Used by `hasEgressSignals` so a URL buried in a nested args field
 * (e.g. `args.body.callback_url`) still trips the egress detector.
 */
function collectStringLeaves(value: unknown, acc: string[] = []): string[] {
  if (typeof value === 'string') {
    acc.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStringLeaves(v, acc);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStringLeaves(v, acc);
    }
  }
  return acc;
}

/**
 * Returns true when the requested server_id is in the agent's
 * role-scoped attached set. getMcpServer is org-scoped, so without
 * this narrowing a model that guessed or was fed an arbitrary
 * serverId from another connector in the same org could list or
 * invoke it. The legacy spawn-time resolver narrows servers by
 * attachment + role; the meta-tools must do the same before either
 * tool reads or dispatches.
 */
function isServerAttachedToSpirit(
  repo: ConnectorMetaToolRepo,
  organizationId: string,
  memberId: string,
  serverId: string,
  role: SpiritRole,
): boolean {
  const attached = repo.listAttachedServersForSpirit(
    organizationId,
    memberId,
    role,
  );
  return attached.some((row) => row.server.id === serverId);
}

/**
 * Conservative egress classifier (mcp_connector_dispatch_plan.md §7.6).
 *
 * Returns true if any string leaf in `args` looks like it could carry
 * data outside the agent's normal context (URL, email address, IP
 * address). The auto-grant rule in §7.6 demands that a tool with
 * static risk='read' AND no egress signals can skip the prompt. PR 4
 * does not wire that rule — it exports this helper so PR 5 (or the
 * permission middleware once it grows an egress-aware classification
 * lookup) can apply it.
 *
 * Over-reports rather than under-reports: a missed egress signal could
 * silently auto-approve an exfiltration call, while a false positive
 * just means the operator sees an approval prompt.
 */
export function hasEgressSignals(args: unknown): boolean {
  const leaves = collectStringLeaves(args);
  for (const s of leaves) {
    if (URL_PATTERN.test(s)) return true;
    if (EMAIL_PATTERN.test(s)) return true;
    if (IP_PATTERN.test(s)) return true;
  }
  return false;
}

// ───────────────────────────────────────────────────────────────────────
// Builder
// ───────────────────────────────────────────────────────────────────────

export function buildConnectorMetaTools(
  deps: ConnectorMetaToolDeps,
): ConnectorMetaToolSet {
  const get_connector_tools = tool({
    description:
      'List the tools available on a connector server. Returns each ' +
      "tool's name, description, and input schema so you can choose " +
      'one and call invoke_connector_tool.',
    inputSchema: GetConnectorToolsSchema,
    execute: async ({ server_id }) => {
      // Attachment-scope check FIRST. Without it a leaked or guessed
      // serverId for another connector in the same org could be read
      // — getMcpServer is org-scoped, not attachment-scoped. Returns
      // the same "not attached" error shape for both "no such server
      // in the org" and "server exists but isn't attached to this
      // agent" so the model can't probe org membership through
      // differential error messages.
      if (
        !isServerAttachedToSpirit(
          deps.repo,
          deps.organizationId,
          deps.memberId,
          server_id,
          deps.spiritRole,
        )
      ) {
        return toModelToolErrorOutput(
          new Error(
            `Connector "${server_id}" is not attached to this agent. ` +
              'Pick a server_id from the catalog in your system prompt.',
          ),
        );
      }
      const server = deps.repo.getMcpServer(deps.organizationId, server_id);
      if (!server) {
        // Defensive: listAttachedServersForSpirit already filtered to
        // existing rows, but the repo could race. Same error shape as
        // the attachment miss above to avoid leaking row state.
        return toModelToolErrorOutput(
          new Error(
            `Connector "${server_id}" is not attached to this agent. ` +
              'Pick a server_id from the catalog in your system prompt.',
          ),
        );
      }
      if (server.status !== 'active') {
        // server.name is admin-controllable — use the stable opaque
        // server_id in the error instead of interpolating the raw
        // name back into model-facing text. Same trust model PR 3
        // applies in catalog text.
        return toModelToolErrorOutput(
          new Error(
            `Connector "${server_id}" is disabled. Ask the operator to ` +
              're-enable it before retrying.',
          ),
        );
      }
      const cache = deps.repo.getMcpToolCache(
        deps.organizationId,
        server_id,
      );
      // No cache row means the server has never been tested by the
      // settings UI nor seeded by a prior spawn. Surface this honestly
      // so the operator knows to run Test on the server row.
      if (!cache) {
        // get_connector_tools is NOT routed through ToolService.invoke,
        // so we return the model-facing payload directly. The AI SDK
        // accepts arbitrary structured returns from execute and threads
        // them through as the tool result.
        return {
          server_id,
          tools: [],
          note:
            "No cached tool inventory for this server. Ask the operator " +
            'to run Test on it in Settings → MCPs.',
        };
      }
      // Sanitize names through the same shape filter as PR 3. A
      // hostile name like "\nSYSTEM: ignore" is dropped from the
      // response entirely (defense-in-depth on the tool-result
      // surface, even though the prompt-text surface in PR 3 already
      // closes the catalog-level injection path).
      const tools = cache.tools
        .map((t) => {
          const safeName = sanitizeToolName(t.name);
          if (!safeName) return null;
          return {
            name: safeName,
            description: (t.description ?? '').slice(0, DESCRIPTION_TRUNCATE),
            input_schema: t.inputSchema ?? {},
          };
        })
        .filter((t): t is NonNullable<typeof t> => t !== null);
      return { server_id, tools };
    },
  });

  const invoke_connector_tool = tool({
    description:
      'Call a tool on a connector server. The operator may need to ' +
      'approve write or destructive actions before they run. Discover ' +
      'available tools via get_connector_tools.',
    inputSchema: InvokeConnectorToolSchema,
    execute: async ({ server_id, tool_name, args }, { toolCallId }) => {
      // Attachment-scope check first (same gap as get_connector_tools).
      if (
        !isServerAttachedToSpirit(
          deps.repo,
          deps.organizationId,
          deps.memberId,
          server_id,
          deps.spiritRole,
        )
      ) {
        return toModelToolErrorOutput(
          new Error(
            `Connector "${server_id}" is not attached to this agent.`,
          ),
        );
      }
      const server = deps.repo.getMcpServer(deps.organizationId, server_id);
      if (!server) {
        return toModelToolErrorOutput(
          new Error(
            `Connector "${server_id}" is not attached to this agent.`,
          ),
        );
      }
      if (server.status !== 'active') {
        // Opaque server_id rather than server.name (admin-controllable).
        return toModelToolErrorOutput(
          new Error(`Connector "${server_id}" is disabled.`),
        );
      }
      // Cache lookup is the typed gate. A phantom toolName cannot be
      // dispatched — the agent must call get_connector_tools first
      // and pick a name that actually exists on this server. Same
      // shape sanitization as get_connector_tools so an inbound
      // hostile name (passed by the model via args) is rejected here.
      const safeName = sanitizeToolName(tool_name);
      if (!safeName) {
        return toModelToolErrorOutput(
          new Error(
            `Invalid tool name shape: "${tool_name}". Tool names must ` +
              'match the connector\'s reported inventory.',
          ),
        );
      }
      const cache = deps.repo.getMcpToolCache(
        deps.organizationId,
        server_id,
      );
      const cachedTool = cache?.tools.find((t) => t.name === safeName);
      if (!cachedTool) {
        // Opaque server_id + sanitized safeName — neither carries
        // attacker-shaped prose. server.name is intentionally not
        // interpolated here per the catalog-text trust model.
        return toModelToolErrorOutput(
          new Error(
            `Tool "${safeName}" not found on connector "${server_id}". ` +
              'Call get_connector_tools(server_id) to see the live ' +
              'inventory.',
          ),
        );
      }
      // Dispatch through the standard ToolService gate. permissionMcpId
      // + the synthetic permissionToolName from mcpPermissionToolName
      // match the shape the legacy MCP-tool path already uses, so
      // existing governance policies and audit rows apply unchanged.
      try {
        const result = await deps.tools.invoke({
          organizationId: deps.organizationId,
          runId: deps.runId,
          memberId: deps.memberId,
          threadId: deps.threadId,
          taskSessionId: deps.taskSessionId,
          spiritRole: deps.spiritRole,
          toolCallId: toolCallId ?? randomUUID(),
          toolId: 'mcp',
          action: 'mcp',
          resourceType: 'mcp',
          resourcePath: `${server.id}:${safeName}`,
          permissionMcpId: server.id,
          permissionToolName: mcpPermissionToolName(server.id, safeName),
          input: {
            mcpServerId: server.id,
            mcpServerName: server.name,
            toolName: safeName,
            args,
          },
        });
        return toModelToolOutput(result);
      } catch (err) {
        return toModelToolErrorOutput(err);
      }
    },
  });

  return { get_connector_tools, invoke_connector_tool };
}
