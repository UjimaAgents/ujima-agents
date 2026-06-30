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
import {
  classifyTool,
  type McpServer,
  type McpToolDescriptor,
  type SpiritRole,
} from '@ujima/shared';
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
import { wrapAttachmentCapture } from '../utils/tool-output.js';
import type { SpiritMcpPool } from './spirit-types.js';
import { buildConnectorMetaTools } from '../tools/connector-meta-tools.js';
import {
  buildDiscoveryTools,
  type AttachmentApprovalRequest,
} from '../tools/discovery-tools.js';
import type { ApprovalRequest } from '@ujima/shared';
import type { ToolService } from './tool-service.js';
import { createConnectorAuditWriter } from './connector-audit.js';
import type { AttachmentCaptureClosure } from './agent-attachment-closure.js';

export interface ConnectorSpawnV2Services {
  mcpPool: SpiritMcpPool;
  repo: ApiRepository;
  tools: ToolService;
  /**
   * PR 11 — discovery escalation. `request_attachment` calls this
   * to surface the §17.5.6 approval card. Optional so existing V2
   * callsites (PR 8/9/10 tests) keep typechecking; without it the
   * tool returns a clean "not wired" error to the model rather
   * than throwing.
   */
  approvals?: {
    requestAttachmentApproval: (
      input: AttachmentApprovalRequest,
    ) => ApprovalRequest;
  };
  /**
   * Attachment-capture hook. Runs after every successful native
   * MCP invoke; surfaces `attachment_refs` on the tool result so
   * the agent can pass them to channel.reply without re-encoding
   * the bytes.
   */
  attachmentCapture?: AttachmentCaptureClosure;
}

// Re-export so existing consumers don't break. New code should
// import from `./agent-attachment-closure.js` to keep the type
// path independent of this runtime-bearing module.
export type { AttachmentCaptureClosure } from './agent-attachment-closure.js';

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

/**
 * Insert inferred risk classifications for every tool in `toolList`.
 * Runs regardless of where toolList came from (live refresh OR cache
 * fallback) so a transient MCP outage can't leave a server with no
 * classification rows — that would silently make
 * risk_defaults.destructive=require_approval stop firing.
 *
 * INSERT OR IGNORE in the underlying repo preserves manual overrides.
 * Server-declared `destructive` hints are honoured first; classifyTool's
 * verb heuristic kicks in only when the MCP didn't set the bit.
 *
 * Used by BOTH the native-tier loop and the dispatch-tier seed loop in
 * buildMcpToolDefinitionsV2, so a dispatch-only attachment isn't
 * silently skipped (the regression the bot flagged on the dispatch
 * path).
 */
function seedClassificationsFor(
  services: ConnectorSpawnV2Services,
  organizationId: string,
  server: McpServer,
  toolList: readonly McpToolDescriptor[],
): void {
  if (toolList.length === 0) return;
  try {
    const seedEntries = toolList.map((d) => {
      const inf = classifyTool({
        name: d.name,
        description: d.description,
        category: server.category,
        declaredDestructive: d.destructive,
      });
      return {
        toolName: d.name,
        risk: inf.risk,
        needsReview: inf.needsReview,
        reason: inf.reason,
      };
    });
    services.repo.seedInferredClassifications(
      organizationId,
      server.id,
      seedEntries,
    );
  } catch (err) {
    console.warn(
      `[connector-spawn-v2] classification seed failed for "${server.id}":`,
      err,
    );
  }
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

  // §12 audit writer — one instance per spawn, threaded into both the
  // native-tier execute closures (below) and the dispatch-tier
  // meta-tools (further down). Operator queries against
  // audit_events.tool_name need parity across both tiers, otherwise
  // half the V2 invocations are invisible to the curation analysis
  // and the operator's "every X across all agents" query.
  const audit = createConnectorAuditWriter({ repo: services.repo });

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
    // unreachable MCP doesn't strand the agent. Preserve the
    // server-declared `destructive` annotation so the post-fetch
    // classifyTool() call honours the MCP's own intent before falling
    // back to verb heuristics.
    //
    // Cache write + classification seed run AFTER the refresh
    // try/catch using whatever toolList is available. Putting them
    // inside the refresh try would skip seeding on transient MCP
    // failures — exactly the regression the bot caught. Legacy runs
    // both regardless (spirit-agent-run.ts:824-879).
    let refreshed = false;
    try {
      // Use the org's workspace_root as the child cwd so file
      // outputs land where the agent expects.
      const orgForCwd = services.repo.getOrganization(ctx.organizationId);
      const connection = await services.mcpPool.get(def, {
        agentId: ctx.memberId,
        cwd: orgForCwd?.workspace?.root,
      });
      const liveTools = await connection.listTools();
      toolList = liveTools.map((t) => {
        const declared =
          typeof (t as { destructive?: boolean }).destructive === 'boolean'
            ? (t as { destructive?: boolean }).destructive
            : undefined;
        return {
          name: t.name,
          description: t.description ?? '',
          inputSchema:
            t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema)
              ? (t.inputSchema as Record<string, unknown>)
              : undefined,
          ...(declared !== undefined ? { destructive: declared } : {}),
        };
      });
      refreshed = true;
    } catch {
      // Live refresh failed → cache fallback above. Same shape as the
      // legacy path's behaviour.
    }

    if (toolList.length === 0) continue;

    if (refreshed) {
      try {
        services.repo.saveMcpToolCache({
          mcpServerId: server.id,
          organizationId: ctx.organizationId,
          tools: toolList,
          fetchedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.warn(
          `[connector-spawn-v2] cache write failed for "${server.id}":`,
          err,
        );
      }
    }

    // Always seed — refresh success OR cache fallback. Without this
    // a cached-only path leaves the classification row absent, and
    // evaluatePolicy returns 'inherit' so risk_defaults stops firing.
    seedClassificationsFor(services, ctx.organizationId, server, toolList);

    // Per-tool grant filter (role-scoped). When the agent has at least
    // one row in agent_tool_attachments for this server matching the
    // current spirit role, narrow the palette to those tools. Zero
    // matching rows = "all tools" mode (back-compat). Same shape as
    // the legacy filter at spirit-agent-run.ts:892-903; without it
    // V2 would expose every listTools() result regardless of grants.
    const grants = services.repo.listAgentToolAttachments(
      ctx.organizationId,
      ctx.memberId,
      server.id,
    );
    const applicableGrants = grants.filter(
      (g) => g.scope === ctx.role || g.scope === 'both',
    );
    if (applicableGrants.length > 0) {
      const allowedNames = new Set(applicableGrants.map((g) => g.toolName));
      toolList = toolList.filter((t) => allowedNames.has(t.name));
      if (toolList.length === 0) continue;
    }

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
          // §12 mirror of the dispatch-tier emission shape in
          // connector-meta-tools.ts. Native tools route through the
          // same ToolService.invoke gate so the result branches
          // (ok / blocked / approval-waiting / input-waiting) are
          // identical; without this block, a V2 spawn with native
          // attachments would emit zero connector_* rows for half
          // the agent's tool surface — operator queries against
          // audit_events would show only the dispatch tier.
          audit.invocationRequested({
            organizationId: ctx.organizationId,
            actorMemberId: ctx.memberId,
            runId: ctx.runId,
            serverId: entry.serverId,
            toolName: entry.toolName,
            args,
          });
          let result: Awaited<ReturnType<typeof services.tools.invoke>>;
          try {
            result = await services.tools.invoke({
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
          } catch (error) {
            audit.invocationCompleted({
              organizationId: ctx.organizationId,
              actorMemberId: ctx.memberId,
              runId: ctx.runId,
              serverId: entry.serverId,
              toolName: entry.toolName,
              success: false,
              errorMessage: error instanceof Error ? error.message : String(error),
            });
            return toModelToolErrorOutput(error);
          }
          // Same approval-/input-waiting detection as the dispatch
          // path — those are not completions and emitting here
          // would double-count when the run resumes.
          const isWaitingForApproval = typeof result.requiresApprovalId === 'string';
          const out = result.output;
          const isWaitingForInput =
            result.ok &&
            !!out &&
            typeof out === 'object' &&
            (out as Record<string, unknown>).status === 'waiting_for_input';
          if (!isWaitingForApproval && !isWaitingForInput) {
            audit.invocationCompleted({
              organizationId: ctx.organizationId,
              actorMemberId: ctx.memberId,
              runId: ctx.runId,
              serverId: entry.serverId,
              toolName: entry.toolName,
              success: result.ok,
              errorMessage: result.ok
                ? undefined
                : result.error ?? 'tool invocation failed',
            });
          }
          // Agent-attachments capture — sniffs bytes from the
          // result, writes to the agent_attachments store, injects
          // `attachment_refs` for channel.reply to use.
          if (
            result.ok &&
            !isWaitingForApproval &&
            !isWaitingForInput &&
            services.attachmentCapture
          ) {
            try {
              const capture = services.attachmentCapture({
                organizationId: ctx.organizationId,
                runId: ctx.runId,
                memberId: ctx.memberId,
                serverId: entry.serverId,
                toolName: entry.toolName,
                toolCallId,
                toolResult: result.output,
              });
              if (capture.attachmentRefs.length > 0) {
                const wrapped = wrapAttachmentCapture(result.output, capture.attachmentRefs.map((ref) => ref.ref));
                result = { ...result, output: wrapped };
              }
            } catch (err) {
              console.warn(
                '[connector-spawn-v2] attachment capture threw; falling back to no-capture output',
                err,
              );
            }
          }
          try {
            return toModelToolOutput(result);
          } catch (error) {
            return toModelToolErrorOutput(error);
          }
        },
      }),
    ]),
  );

  // Dispatch tier — seed classifications from cache so the §9.1
  // decision matrix (risk_defaults / auto-grant rules) applies the
  // first time invoke_connector_tool dispatches against this server.
  // Without this a fresh dispatch-only attachment would have no
  // classification row, evaluatePolicy would return 'inherit', and
  // risk_defaults.write/destructive would silently bypass. We do
  // NOT live-refresh dispatch servers here — the dispatch tier is
  // explicitly the "don't fan out network calls per spawn" path. The
  // cache is populated by the settings-UI Test path and by
  // get_connector_tools's read flow; a missing cache is honest
  // ("server never tested") and surfaces through the catalog text.
  for (const entry of resolved.dispatchCatalog) {
    const dispatchServer = services.repo.getMcpServer(
      ctx.organizationId,
      entry.serverId,
    );
    if (!dispatchServer) continue;
    const dispatchCache = services.repo.getMcpToolCache(
      ctx.organizationId,
      entry.serverId,
    );
    seedClassificationsFor(
      services,
      ctx.organizationId,
      dispatchServer,
      dispatchCache?.tools ?? [],
    );
  }

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
    audit,
  });

  // PR 11 — discovery tools also always register. The asking agent
  // needs `search_catalog` even when its current dispatch tier is
  // empty: that's literally the bootstrap case ("I have no
  // connectors attached, what's available?"). Same audit writer
  // instance so the catalog_search + attachment_request_* events
  // share the run's audit identity.
  const discovery = buildDiscoveryTools({
    organizationId: ctx.organizationId,
    memberId: ctx.memberId,
    runId: ctx.runId,
    threadId: ctx.threadId,
    taskSessionId: ctx.taskSessionId,
    spiritRole: ctx.role,
    tools: services.tools,
    repo: services.repo,
    audit,
    requestAttachmentApproval: services.approvals?.requestAttachmentApproval,
  });

  const toolSet: ToolSet = {
    ...nativeTools,
    get_connector_tools: meta.get_connector_tools,
    invoke_connector_tool: meta.invoke_connector_tool,
    search_catalog: discovery.search_catalog,
    request_attachment: discovery.request_attachment,
  } as ToolSet;

  return {
    toolSet,
    servers,
    catalogText: resolved.catalogText,
    dispatchCatalog: resolved.dispatchCatalog,
  };
}
