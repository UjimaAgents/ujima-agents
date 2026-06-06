// V2 spawn — connector dispatch wire-in
// (mcp_connector_dispatch_plan.md §7.4, technical centerpiece).
//
// Sibling to the legacy `buildMcpToolDefinitions` in spirit-agent-run.ts.
// Legacy is byte-for-byte unchanged per §3.5 rule 1. The caller in
// spirit-agent-run.ts branches on `isMcpDispatchEnabled()` and routes
// to this method when the flag is on; flag off → legacy runs unchanged.
//
// Tier-aware partition uses PR 3's `resolveConnectorCatalog`:
//   * native attachments  → the typed-palette path (live listTools,
//                            spawn-time cache refresh, AI-SDK tool() wraps
//                            with `mcp:<id>:<name>` permission shape —
//                            same as legacy, but applied only to
//                            tier='native' servers)
//   * dispatch attachments → the meta-tools path (PR 4's
//                            buildConnectorMetaTools registers
//                            get_connector_tools + invoke_connector_tool;
//                            the rendered catalogText flows back to the
//                            caller and into the system prompt)
//
// Three invariants worth naming:
//   1. The two meta-tools are present even when the dispatch tier is
//      empty. That keeps the model's tool surface stable across spawns
//      so an agent that learned to call get_connector_tools doesn't
//      hit "tool not registered" on the next spawn when no dispatch
//      attachments exist yet.
//   2. Native-tier rendering uses the legacy `mcp:<serverId>:<toolName>`
//      synthetic permissionToolName so existing governance rules,
//      audit rows, and approval shapes apply unchanged to V2.
//   3. catalogText comes pre-rendered + pre-sanitized from PR 3. This
//      module never inspects it — it just threads the string back to
//      the caller, which passes it to buildAgentSystemPrompt. No
//      catalog-rendering logic leaks into the spawn path.

import { tool, type ToolSet } from 'ai';
import type { SpiritRole } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import { materializeMcpDef, mcpPermissionToolName } from './mcp-runtime.js';
import {
  resolveConnectorCatalog,
  type CatalogEntry,
} from './connector-catalog.js';
import {
  buildMcpNamespace,
  mcpToolInputSchema,
  sanitizeMcpToolName,
  uniqueMcpToolId,
  type McpServerSummary,
} from './spirit-mcp-helpers.js';
import {
  toModelToolErrorOutput,
  toModelToolOutput,
} from './tool-loop-result.js';
import type { SpiritMcpPool } from './spirit-types.js';
import { buildConnectorMetaTools } from '../tools/connector-meta-tools.js';
import type { ToolService } from './tool-service.js';

export interface ConnectorSpawnV2Services {
  mcpPool: SpiritMcpPool;
  repo: ApiRepository;
  tools: ToolService;
}

export interface ConnectorSpawnV2Ctx {
  organizationId: string;
  memberId: string;
  runId: string;
  threadId: string;
  taskSessionId: string;
  role: SpiritRole;
}

export interface ConnectorSpawnV2Result {
  toolSet: ToolSet;
  servers: McpServerSummary[];
  /** Pre-rendered dispatch catalog block for the system prompt (PR 3). */
  catalogText: string;
  /** Resolved dispatch entries; surfaced for tracing/debug, not rendering. */
  dispatchCatalog: CatalogEntry[];
}

export async function buildMcpToolDefinitionsV2(
  services: ConnectorSpawnV2Services,
  ctx: ConnectorSpawnV2Ctx,
): Promise<ConnectorSpawnV2Result> {
  const resolved = resolveConnectorCatalog(
    services.repo,
    ctx.organizationId,
    ctx.memberId,
    ctx.role,
  );

  const servers: McpServerSummary[] = [];
  // Entry shape mirrors legacy buildMcpToolDefinitions — we collect
  // the data fields, then build `tool({...})` calls at the end and
  // cast to ToolSet. Inlining `tool()` typing through a pre-declared
  // array type narrows the FlexibleSchema generic to `never`.
  interface NativeEntry {
    toolId: string;
    toolName: string;
    description: string;
    serverId: string;
    serverName: string;
    inputSchema?: Record<string, unknown>;
  }
  const nativeEntries: NativeEntry[] = [];
  const usedToolIds = new Set<string>();

  for (const { server } of resolved.nativeAttachments) {
    const def = materializeMcpDef(services.repo, server);
    let toolList = services.repo.getMcpToolCache(
      ctx.organizationId,
      server.id,
    )?.tools ?? [];

    // Best-effort live refresh — mirrors the legacy spawn path's
    // listTools call so a settings-UI Test isn't required after every
    // server change. Failures fall back to the cached inventory so an
    // unreachable MCP doesn't strand the agent.
    try {
      const connection = await services.mcpPool.get(def, {
        agentId: ctx.memberId,
      });
      const liveTools = await connection.listTools();
      toolList = liveTools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema:
          t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema)
            ? (t.inputSchema as Record<string, unknown>)
            : undefined,
      }));
      try {
        services.repo.saveMcpToolCache({
          mcpServerId: server.id,
          organizationId: ctx.organizationId,
          tools: toolList,
          fetchedAt: new Date().toISOString(),
        });
      } catch (err) {
        // Non-fatal: a stale cache write doesn't justify dropping
        // tools the model is about to use.
        console.warn(
          `[connector-spawn-v2] cache write failed for "${server.id}":`,
          err,
        );
      }
    } catch {
      // Live refresh failed → cache fallback above. Same shape as the
      // legacy path's behaviour.
    }

    if (toolList.length === 0) continue;

    const nsSlug = buildMcpNamespace(server.name, server.id);
    servers.push({
      serverName: server.name,
      serverId: server.id,
      toolNames: toolList.map((t) => t.name),
    });

    for (const t of toolList) {
      const sanitized = sanitizeMcpToolName(t.name);
      const baseToolId = `mcp__${nsSlug}__${sanitized}`;
      const uniqueId = uniqueMcpToolId(
        baseToolId,
        server.id,
        t.name,
        usedToolIds,
      );
      usedToolIds.add(uniqueId);

      nativeEntries.push({
        toolId: uniqueId,
        toolName: t.name,
        description: t.description || `${server.name}.${t.name}`,
        serverId: server.id,
        serverName: server.name,
        inputSchema: t.inputSchema,
      });
    }
  }

  // Build the AI-SDK tool entries from collected data. Pattern mirrors
  // legacy buildMcpToolDefinitions: bottom-of-method `Object.fromEntries
  // (...) as ToolSet` lets `tool()`'s inferred FlexibleSchema land
  // without forcing every entry through a pre-declared tuple type that
  // would narrow to `never`.
  const nativeTools = Object.fromEntries(
    nativeEntries.map((entry) => [
      entry.toolId,
      tool({
        description: entry.description,
        inputSchema: mcpToolInputSchema(entry.inputSchema),
        execute: async (rawArgs, { toolCallId }) => {
          const args = (rawArgs ?? {}) as Record<string, unknown>;
          try {
            const result = await services.tools.invoke({
              organizationId: ctx.organizationId,
              runId: ctx.runId,
              memberId: ctx.memberId,
              threadId: ctx.threadId,
              taskSessionId: ctx.taskSessionId,
              spiritRole: ctx.role,
              toolCallId,
              toolId: 'mcp',
              action: 'mcp',
              resourceType: 'mcp',
              resourcePath: `${entry.serverId}:${entry.toolName}`,
              permissionMcpId: entry.serverId,
              permissionToolName: mcpPermissionToolName(
                entry.serverId,
                entry.toolName,
              ),
              input: {
                mcpServerId: entry.serverId,
                mcpServerName: entry.serverName,
                toolName: entry.toolName,
                args,
              },
            });
            return toModelToolOutput(result);
          } catch (error) {
            return toModelToolErrorOutput(error);
          }
        },
      }),
    ]),
  );

  // Meta-tools always register, even with an empty dispatch tier. See
  // invariant 1 in the file header.
  const meta = buildConnectorMetaTools({
    organizationId: ctx.organizationId,
    memberId: ctx.memberId,
    runId: ctx.runId,
    threadId: ctx.threadId,
    taskSessionId: ctx.taskSessionId,
    spiritRole: ctx.role,
    tools: services.tools,
    repo: services.repo,
  });

  const toolSet: ToolSet = {
    ...nativeTools,
    get_connector_tools: meta.get_connector_tools,
    invoke_connector_tool: meta.invoke_connector_tool,
  } as ToolSet;

  return {
    toolSet,
    servers,
    catalogText: resolved.catalogText,
    dispatchCatalog: resolved.dispatchCatalog,
  };
}
