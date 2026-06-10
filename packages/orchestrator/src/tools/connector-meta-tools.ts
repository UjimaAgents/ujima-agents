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
  AgentToolAttachment,
  McpServer,
  McpToolCache,
  SpiritRole,
} from '@ujima/shared';
import { mcpPermissionToolName } from '../services/mcp-runtime.js';
import {
  toModelToolErrorOutput,
  toModelToolOutput,
} from '../services/tool-loop-result.js';
import type { ToolService } from '../services/tool-service.js';
import type { ConnectorAuditWriter } from '../services/connector-audit.js';

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
  /**
   * PR 10/11 union — channel attachments the agent inherits via
   * channel membership. The meta-tools must include these in the
   * "attached?" check; without them, the model sees a server in
   * search_catalog (which DOES consult the §17.5.3 union) but the
   * meta-tools reject the call as "not attached to this agent".
   * Same scope filter applies (role | both).
   */
  listChannelMcpAttachmentsForMember(
    organizationId: string,
    memberId: string,
  ): { mcpServerId: string; scope: 'worker' | 'supervisor' | 'both' }[];
  /**
   * Per-tool grants for an agent on a specific server. When any
   * applicable grant exists for the current spirit role, this acts
   * as the allow-list for both meta-tools — get_connector_tools
   * omits non-granted names and invoke_connector_tool refuses to
   * dispatch them. Same shape as the legacy spawn-time grant filter
   * in spirit-agent-run.ts.
   */
  listAgentToolAttachments(
    organizationId: string,
    memberId: string,
    mcpServerId: string,
  ): AgentToolAttachment[];
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
  /**
   * §12 connector audit writer. Optional so tests + legacy callers
   * don't have to construct one — when absent the meta-tools run
   * exactly as before, just without writing the new event types.
   */
  audit?: ConnectorAuditWriter;
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
 * Reject only tool names that would actually break a tool result —
 * control characters, escapes, or absurd lengths. Anything else (spaces,
 * dots, mixed case, punctuation) is preserved verbatim because MCPs
 * publish wildly varying naming conventions and an over-strict
 * identifier-shape filter would make legitimate tools undiscoverable
 * and uncallable. mcpPermissionToolName URL-encodes when it builds the
 * policy/audit key, so non-identifier characters are safe downstream.
 *
 * The actual gate against attacker-shaped names is the cache lookup:
 * tools that aren't in the persisted mcp_tool_cache cannot be
 * dispatched, period. This helper is just a defense-in-depth on the
 * tool-result emission surface so a publisher can't smuggle a literal
 * newline into the listing.
 */
const TOOL_NAME_MAX_LENGTH = 256;
// eslint-disable-next-line no-control-regex
const TOOL_NAME_DISALLOWED = /[\x00-\x1F\x7F]/;
function isToolNameSafeForDisplay(name: string): boolean {
  if (name.length === 0) return false;
  if (name.length > TOOL_NAME_MAX_LENGTH) return false;
  return !TOOL_NAME_DISALLOWED.test(name);
}

/**
 * Compute the role-scoped allow-list of tool names for one (member,
 * server). Returns null when there are no applicable grants — that's
 * the legacy "all tools" mode (back-compat). When non-null, BOTH
 * meta-tools narrow their behavior to this set.
 *
 * The role filter is load-bearing: a worker-only grant must not flip
 * the palette into allowlist mode for supervisor runs, and vice
 * versa. The legacy spawn-time filter already encodes this; the
 * meta-tools must apply the same logic so the dispatch tier doesn't
 * regress the per-tool authorization contract.
 */
function applicableGrantedNames(
  repo: ConnectorMetaToolRepo,
  organizationId: string,
  memberId: string,
  serverId: string,
  role: SpiritRole,
): Set<string> | null {
  const grants = repo.listAgentToolAttachments(
    organizationId,
    memberId,
    serverId,
  );
  const applicable = grants.filter(
    (g) => g.scope === role || g.scope === 'both',
  );
  if (applicable.length === 0) return null;
  return new Set(applicable.map((g) => g.toolName));
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
  if (attached.some((row) => row.server.id === serverId)) return true;
  // PR 10/11 union — channel attachments the agent inherits via
  // channel membership. Without this branch the meta-tools rejected
  // channel-attached MCPs as "not attached to this agent" even
  // though §17.5.3 and search_catalog correctly fold them into the
  // effective set. Scope filter mirrors discovery-tools'
  // resolveEffectiveSet.
  const channelAttached = repo.listChannelMcpAttachmentsForMember(
    organizationId,
    memberId,
  );
  return channelAttached.some(
    (att) =>
      att.mcpServerId === serverId &&
      (att.scope === role || att.scope === 'both'),
  );
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

/**
 * Pull a human-readable error message out of a non-ok ToolInvocationResult
 * for the §12 audit row's errorMessage field. Prefers the structured
 * `error` field; falls back to a `blocked` status string from the output;
 * defaults to a generic invocation-failed message.
 */
function extractInvocationError(result: { error?: string; output?: unknown }): string {
  if (result.error) return result.error;
  const output = result.output;
  if (output && typeof output === 'object') {
    const record = output as Record<string, unknown>;
    if (typeof record.error === 'string') return record.error;
    if (typeof record.status === 'string') return `tool_status:${record.status}`;
  }
  return 'tool invocation failed';
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
      // No cache row means one of three things; the model uses the
      // message below to pick the right escalation. Most commonly hit
      // when an agent just called request_attachment for a curated
      // registry entry that needs credentials or template args — the
      // auto-test fired by the approval resolver couldn't reach the
      // server, so the cache stayed empty. The prior wording ("run
      // Test in Settings") was too narrow and steered the model
      // toward asking the operator for a no-op Test click instead
      // of the actual fix (credentials or argument values).
      if (!cache) {
        // get_connector_tools is NOT routed through ToolService.invoke,
        // so we return the model-facing payload directly. The AI SDK
        // accepts arbitrary structured returns from execute and threads
        // them through as the tool result.
        return {
          server_id,
          tools: [],
          note:
            "No cached tool inventory for this server. Common causes:\n" +
            "(1) The connector requires credentials (PAT, env vars, OAuth) " +
            "that haven't been set yet — ask the operator to provide them via " +
            "Settings → MCPs → <connector> → Edit.\n" +
            "(2) The connector requires config args (file paths, dataset ids, " +
            "etc.) that need real values — ask the operator to fill them in via " +
            "Settings → MCPs → <connector> → Edit.\n" +
            "(3) The connector is reachable but hasn't been tested yet — ask " +
            "the operator to click Test in Settings → MCPs.\n" +
            "Pick the most likely cause based on the connector name and " +
            "tell the operator specifically what they need to do.",
        };
      }
      // Apply the role-scoped per-tool grant filter so the model only
      // sees tools it can actually invoke. Mirrors the legacy spawn-
      // time grant filter (spirit-agent-run.ts:892-903).
      const allowedNames = applicableGrantedNames(
        deps.repo,
        deps.organizationId,
        deps.memberId,
        server_id,
        deps.spiritRole,
      );
      // Preserve cached tool names verbatim — they're the dispatch key
      // the model has to pass back. MCPs publish wildly varying naming
      // conventions (spaces, dots, mixed case); an identifier-shape
      // sanitizer makes legitimate tools undiscoverable + uncallable.
      // Defense-in-depth against prompt injection through the tool
      // result is the control-char filter below: only names containing
      // \x00-\x1F or absurd lengths are dropped. The actual gate is
      // the cache itself — phantom names cannot be dispatched.
      const tools = cache.tools
        .map((t) => {
          if (!isToolNameSafeForDisplay(t.name)) return null;
          if (allowedNames !== null && !allowedNames.has(t.name)) return null;
          return {
            name: t.name,
            description: (t.description ?? '').slice(0, DESCRIPTION_TRUNCATE),
            input_schema: t.inputSchema ?? {},
          };
        })
        .filter((t): t is NonNullable<typeof t> => t !== null);
      // §12.2 audit emit — emit after grant filtering so fetchedToolCount
      // matches what the model actually saw, not the raw cache size.
      deps.audit?.toolsListed({
        organizationId: deps.organizationId,
        actorMemberId: deps.memberId,
        runId: deps.runId,
        serverId: server_id,
        fetchedToolCount: tools.length,
      });
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
      // §12.2 audit emit — `_requested` fires BEFORE any gate so denied
      // attempts (phantom tool, ungranted tool, unattached server,
      // disabled server) are visible to operators auditing the
      // dispatch tier. Each early-return gate below is paired with a
      // matching `_completed{success:false}` so the per-attempt
      // (requested, completed) shape stays consistent across allowed
      // and denied paths.
      deps.audit?.invocationRequested({
        organizationId: deps.organizationId,
        actorMemberId: deps.memberId,
        runId: deps.runId,
        serverId: server_id,
        toolName: tool_name,
        args,
      });

      // Closure-local helper for the four pre-invoke denial paths.
      // Keeping the args + member context captured in scope avoids
      // re-threading them through every early-return site.
      const denyWithAudit = (error: Error): ReturnType<typeof toModelToolErrorOutput> => {
        deps.audit?.invocationCompleted({
          organizationId: deps.organizationId,
          actorMemberId: deps.memberId,
          runId: deps.runId,
          serverId: server_id,
          toolName: tool_name,
          success: false,
          errorMessage: error.message,
        });
        return toModelToolErrorOutput(error);
      };

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
        return denyWithAudit(
          new Error(
            `Connector "${server_id}" is not attached to this agent.`,
          ),
        );
      }
      const server = deps.repo.getMcpServer(deps.organizationId, server_id);
      if (!server) {
        return denyWithAudit(
          new Error(
            `Connector "${server_id}" is not attached to this agent.`,
          ),
        );
      }
      if (server.status !== 'active') {
        // Opaque server_id rather than server.name (admin-controllable).
        return denyWithAudit(new Error(`Connector "${server_id}" is disabled.`));
      }
      // Cache lookup is the typed gate. A tool_name that doesn't
      // appear in the persisted cache cannot be dispatched, period.
      // We do NOT sanitize tool_name before the lookup — MCPs publish
      // names with spaces, dots, mixed case, etc., and the legacy
      // mcpPermissionToolName URL-encodes whatever we pass when it
      // builds the policy/audit key, so non-identifier characters are
      // safe downstream. Pre-fix this method ran sanitizeToolName on
      // the inbound name and any tool whose published name fell
      // outside `[A-Za-z0-9_.-]` became silently unreachable — exactly
      // the regression the bot caught.
      const cache = deps.repo.getMcpToolCache(
        deps.organizationId,
        server_id,
      );
      const cachedTool = cache?.tools.find((t) => t.name === tool_name);
      if (!cachedTool) {
        // Opaque server_id — server.name is intentionally not
        // interpolated here per the catalog-text trust model. The
        // tool_name as supplied by the model is echoed back so it
        // can self-correct (it picked this string).
        return denyWithAudit(
          new Error(
            `Tool "${tool_name}" not found on connector "${server_id}". ` +
              'Call get_connector_tools(server_id) to see the live ' +
              'inventory.',
          ),
        );
      }
      // Per-tool grant filter (same as get_connector_tools): if the
      // agent has any role-scoped grants on this server, the named
      // tool must be in the set. Without this dispatch tier would
      // expose every cached tool regardless of governance state.
      const allowedNames = applicableGrantedNames(
        deps.repo,
        deps.organizationId,
        deps.memberId,
        server_id,
        deps.spiritRole,
      );
      if (allowedNames !== null && !allowedNames.has(tool_name)) {
        return denyWithAudit(
          new Error(
            `Tool "${tool_name}" is not granted to this agent on connector ` +
              `"${server_id}". Ask the operator to grant it via Settings ` +
              '→ MCPs, or pick a tool returned by get_connector_tools.',
          ),
        );
      }
      // Dispatch through the standard ToolService gate. permissionMcpId
      // + the synthetic permissionToolName from mcpPermissionToolName
      // match the shape the legacy MCP-tool path already uses, so
      // existing governance policies and audit rows apply unchanged.
      let result: Awaited<ReturnType<typeof deps.tools.invoke>>;
      try {
        result = await deps.tools.invoke({
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
          resourcePath: `${server.id}:${tool_name}`,
          permissionMcpId: server.id,
          permissionToolName: mcpPermissionToolName(server.id, tool_name),
          input: {
            mcpServerId: server.id,
            mcpServerName: server.name,
            toolName: tool_name,
            args,
          },
        });
      } catch (err) {
        // Unexpected exception from the invoke layer itself (DB
        // failure, etc.). Record one completion row with the error
        // and re-throw through the model-error path.
        deps.audit?.invocationCompleted({
          organizationId: deps.organizationId,
          actorMemberId: deps.memberId,
          runId: deps.runId,
          serverId: server.id,
          toolName: tool_name,
          success: false,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        return toModelToolErrorOutput(err);
      }
      // Approval-waiting and input-waiting calls are NOT completions
      // — the gate is holding the call open. Emitting `_completed`
      // here would double-count (the row fires again when the run
      // resumes and the model re-invokes) and would also distort the
      // PR 9 curation signal (an approval-stalled call would look
      // like a successful invocation). The matching `_resolved`
      // event already fires from the approval-resolution path.
      const isWaitingForApproval = typeof result.requiresApprovalId === 'string';
      const output = result.output;
      const isWaitingForInput =
        result.ok &&
        !!output &&
        typeof output === 'object' &&
        (output as Record<string, unknown>).status === 'waiting_for_input';
      if (!isWaitingForApproval && !isWaitingForInput) {
        // Blocked invocations come back as ok=false with output={status:'blocked',...}
        // — toModelToolOutput returns that object without throwing,
        // so we MUST branch on result.ok here (not on whether
        // toModelToolOutput threw) to record blocked calls as
        // success=false rather than silently as successes.
        deps.audit?.invocationCompleted({
          organizationId: deps.organizationId,
          actorMemberId: deps.memberId,
          runId: deps.runId,
          serverId: server.id,
          toolName: tool_name,
          success: result.ok,
          errorMessage: result.ok ? undefined : extractInvocationError(result),
        });
      }
      try {
        return toModelToolOutput(result);
      } catch (err) {
        // toModelToolOutput throws for approval/input waits — those
        // were detected above and intentionally skipped from the
        // completion emit, so just bubble the error to the model
        // path without writing a second row.
        return toModelToolErrorOutput(err);
      }
    },
  });

  return { get_connector_tools, invoke_connector_tool };
}
