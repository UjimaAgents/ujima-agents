import { randomUUID } from 'node:crypto';
import {
  McpServerPublicSchema,
  McpServerSchema,
  classifyTool,
  evaluatePolicy,
  resolveClassification,
  type AgentMcpAttachment,
  type ChannelMcpAttachment,
  type AgentToolAttachment,
  type McpAttachmentScope,
  type McpServer,
  type McpServerPublic,
  type McpToolClassification,
  type McpToolDescriptor,
  type PolicyEvaluation,
  type RiskDefaults,
  type ToolPolicyState,
  type ToolRiskClass,
} from '@ujima/shared';
import {
  connectMCPWithCacheRecovery,
  parseMCPConfigJSON,
  type CacheRecovery,
  type ConnectResult,
  type MCPConnection,
} from '@ujima/mcp-client';
import type { MCPDef } from '@ujima/shared';
import { materializeMcpDef } from './mcp-runtime.js';
import type { ApiRepository } from './repository-reader.js';
import { createConnectorAuditWriter } from './connector-audit.js';
import { errorMessage } from '../utils/error-message.js';
import { writeSecretMap, readSecretMap, deleteSecretIfPresent } from '../utils/mcp-secrets.js';
import { validateMcpConnectivity } from '../utils/mcp-validation.js';

type McpConnector = (def: MCPDef) => Promise<ConnectResult>;

// ---------------------------------------------------------------------
// McpRegistryService — Phase 3 of the MCP integration.
//
// Owns the per-org MCP server registry and the per-agent attachment
// matrix. Secret material (stdio env vars, remote auth headers) is
// written into the file-backed secret store and only the key_ref
// pointer is persisted on the row. The public API surface returns
// `McpServerPublic` shapes that strip every key_ref — secrets never
// leak to clients, audit, or realtime events.
//
// Connection tests use the existing `@ujima/mcp-client.connectMCP`
// helper. Tool inventory is cached in `mcp_tool_cache` so the
// settings UI can render without re-opening a process every load.
// ---------------------------------------------------------------------

export interface CreateMcpServerInput {
  organizationId: string;
  createdBy: string;
  name: string;
  description?: string;
  category?: string;
  transport: 'stdio' | 'sse' | 'http-streamable';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  isolation?: 'shared' | 'per-agent';
}

export interface UpdateMcpServerInput {
  organizationId: string;
  serverId: string;
  name?: string;
  description?: string;
  category?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  isolation?: 'shared' | 'per-agent';
  status?: 'active' | 'disabled';
}

export interface ImportMcpServersInput {
  organizationId: string;
  createdBy: string;
  /** JSON blob: Claude Desktop shape, `{servers}`, or bare keyed map. */
  json: string;
  /** Default category to apply to every imported server. */
  defaultCategory?: string;
}

export interface ImportMcpServersResult {
  imported: McpServerPublic[];
  warnings: string[];
  /** Servers skipped because a same-name row already exists. */
  skipped: { name: string; reason: string }[];
}

export interface AttachMcpInput {
  organizationId: string;
  memberId: string;
  mcpServerId: string;
  scope?: McpAttachmentScope;
}

export interface TestMcpResult {
  ok: boolean;
  tools: McpToolDescriptor[];
  error?: string;
  testedAt: string;
  // Present only when the spawn self-healed via an isolated npm cache.
  // UI surfaces this as a non-error chip so the operator knows their
  // host npm cache is corrupted even though the Test succeeded.
  recovery?: CacheRecovery;
}

export interface CatalogTool {
  name: string;
  description: string;
  risk: ToolRiskClass;
  source: 'inferred' | 'manual' | 'registry' | 'unknown';
  needsReview: boolean;
  // Org-default decision (no specific agent).
  effective: {
    state: ToolPolicyState;
    source: PolicyEvaluation['source'];
    reason?: string;
  };
  // Agents that have this exact tool granted (per-tool attachments).
  grantedAgents: string[];
  // Agents the parent MCP server is attached to but no per-tool grant
  // exists — they currently see this tool via the back-compat "all tools"
  // expansion.
  attachedAgents: string[];
}

export interface CatalogServer {
  id: string;
  name: string;
  status: string;
  category: string;
  toolCount: number;
  // Agents in allowlist mode on this server (have ≥1 per-tool grant
  // for this server). Driving the per-agent "exposed" decision from a
  // server-scoped set avoids globally aggregated grant counts leaking
  // across agents.
  allowlistAgents: string[];
  tools: CatalogTool[];
}

// Per-agent perspective row — only present when caller asked for ?agentId.
export interface CatalogAgentView {
  agentId: string;
  // Effective decision the runtime would make for this (agent, tool).
  state: ToolPolicyState;
  source: PolicyEvaluation['source'];
  reason?: string;
  // Is the tool exposed to the model right now for this agent?
  exposed: boolean;
  // Why it is or isn't exposed.
  exposureReason: 'no-mcp-attachment' | 'no-tool-grant' | 'granted' | 'all-tools-mode';
}

export interface CatalogResult {
  servers: CatalogServer[];
  riskDefaults: RiskDefaults;
  // Per-(server,tool) per-agent decisions when ?agentId was passed.
  // Keyed by `${serverId}::${toolName}` so the UI can look up in O(1).
  agentView?: Record<string, CatalogAgentView>;
  agentViewId?: string;
}

export class McpRegistryService {
  constructor(
    private readonly repo: ApiRepository,
    private readonly connect: McpConnector = connectMCPWithCacheRecovery,
  ) {}

  // ----------------- CRUD -----------------------------------------------

  create(input: CreateMcpServerInput): McpServerPublic {
    this.requireOrganization(input.organizationId);
    const name = input.name.trim();
    if (!name) {
      throw new Error('MCP server name is required');
    }
    if (this.repo.getMcpServerByName(input.organizationId, name)) {
      throw new Error(`MCP server "${name}" already exists in this organisation`);
    }
    validateMcpConnectivity(input);

    const now = new Date().toISOString();
    const envKeyRef = writeSecretMap(this.repo, input.env);
    const headersKeyRef = writeSecretMap(this.repo, input.headers);

    const server = McpServerSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      name,
      description: input.description ?? '',
      category: input.category ?? 'general',
      transport: input.transport,
      command: input.command,
      args: input.args ?? [],
      envKeyRef,
      url: input.url,
      headersKeyRef,
      isolation: input.isolation ?? 'shared',
      status: 'active',
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    });
    try {
      this.repo.saveMcpServer(server);
    } catch (err) {
      deleteSecretIfPresent(this.repo, envKeyRef);
      deleteSecretIfPresent(this.repo, headersKeyRef);
      throw err;
    }
    return this.toPublic(server);
  }

  update(input: UpdateMcpServerInput): McpServerPublic {
    const existing = this.requireServer(input.organizationId, input.serverId);
    const nextName = input.name?.trim() ?? existing.name;
    if (!nextName) {
      throw new Error('MCP server name is required');
    }
    const nameConflict = this.repo.getMcpServerByName(input.organizationId, nextName);
    if (nameConflict && nameConflict.id !== existing.id) {
      throw new Error(`MCP server "${nextName}" already exists in this organisation`);
    }

    let envKeyRef = existing.envKeyRef;
    let nextEnvKeyRef: string | undefined;
    if (input.env !== undefined) {
      nextEnvKeyRef = writeSecretMap(this.repo, input.env);
      envKeyRef = nextEnvKeyRef;
    }
    let headersKeyRef = existing.headersKeyRef;
    let nextHeadersKeyRef: string | undefined;
    if (input.headers !== undefined) {
      nextHeadersKeyRef = writeSecretMap(this.repo, input.headers);
      headersKeyRef = nextHeadersKeyRef;
    }

    const updated = McpServerSchema.parse({
      ...existing,
      name: nextName,
      description: input.description ?? existing.description,
      category: input.category ?? existing.category,
      command: input.command ?? existing.command,
      args: input.args ?? existing.args,
      envKeyRef,
      url: input.url ?? existing.url,
      headersKeyRef,
      isolation: input.isolation ?? existing.isolation,
      status: input.status ?? existing.status,
      updatedAt: new Date().toISOString(),
    });
    try {
      this.repo.saveMcpServer(updated);
    } catch (err) {
      deleteSecretIfPresent(this.repo, nextEnvKeyRef);
      deleteSecretIfPresent(this.repo, nextHeadersKeyRef);
      throw err;
    }
    if (input.env !== undefined && existing.envKeyRef !== envKeyRef) {
      deleteSecretIfPresent(this.repo, existing.envKeyRef);
    }
    if (input.headers !== undefined && existing.headersKeyRef !== headersKeyRef) {
      deleteSecretIfPresent(this.repo, existing.headersKeyRef);
    }
    return this.toPublic(updated);
  }

  delete(organizationId: string, serverId: string): void {
    const existing = this.requireServer(organizationId, serverId);
    if (existing.envKeyRef) this.repo.deleteSecret(existing.envKeyRef);
    if (existing.headersKeyRef) this.repo.deleteSecret(existing.headersKeyRef);
    this.repo.deleteMcpServer(organizationId, serverId);
  }

  list(organizationId: string): McpServerPublic[] {
    this.requireOrganization(organizationId);
    return this.repo.listMcpServers(organizationId).map((server) => this.toPublic(server));
  }

  get(organizationId: string, serverId: string): McpServerPublic | null {
    this.requireOrganization(organizationId);
    const server = this.repo.getMcpServer(organizationId, serverId);
    return server ? this.toPublic(server) : null;
  }

  // ----------------- Import --------------------------------------------

  /**
   * Bulk-import MCP servers from JSON. Accepts Claude Desktop's
   * `{ mcpServers: {...} }`, the alt `{ servers: {...} }`, or a bare
   * `{ id: def }` map — delegated to `parseMCPConfigJSON`. Duplicate
   * names are skipped (not rewritten). Parse warnings surface back to
   * the caller for display.
   */
  import(input: ImportMcpServersInput): ImportMcpServersResult {
    this.requireOrganization(input.organizationId);
    let parsed;
    try {
      parsed = parseMCPConfigJSON(input.json);
    } catch (err) {
      const message = errorMessage(err);
      throw new Error(`Failed to parse MCP config JSON: ${message}`);
    }

    const imported: McpServerPublic[] = [];
    const skipped: { name: string; reason: string }[] = [];
    const now = new Date().toISOString();

    for (const def of parsed.defs) {
      const name = def.name.trim();
      if (!name) {
        skipped.push({
          name: def.name,
          reason: 'MCP server name is required',
        });
        continue;
      }
      try {
        validateMcpConnectivity(def);
      } catch (err) {
        skipped.push({
          name,
          reason: errorMessage(err),
        });
        continue;
      }
      if (this.repo.getMcpServerByName(input.organizationId, name)) {
        skipped.push({
          name,
          reason: 'A server with this name already exists in the organisation',
        });
        continue;
      }
      const envKeyRef = writeSecretMap(this.repo, Object.keys(def.env).length > 0 ? def.env : undefined);
      const headersKeyRef = writeSecretMap(
        this.repo,
        def.headers && Object.keys(def.headers).length > 0 ? def.headers : undefined,
      );
      const server = McpServerSchema.parse({
        id: randomUUID(),
        organizationId: input.organizationId,
        name,
        description: def.description,
        category: input.defaultCategory ?? def.category,
        transport: def.transport,
        command: def.command,
        args: def.args,
        envKeyRef,
        url: def.url,
        headersKeyRef,
        isolation: def.isolation,
        status: 'active',
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      });
      try {
        this.repo.saveMcpServer(server);
      } catch (err) {
        deleteSecretIfPresent(this.repo, envKeyRef);
        deleteSecretIfPresent(this.repo, headersKeyRef);
        throw err;
      }
      imported.push(this.toPublic(server));
    }

    return { imported, warnings: parsed.warnings, skipped };
  }

  // ----------------- Test + tool list ----------------------------------

  /**
   * Open a one-shot MCP connection to the configured server, run
   * `listTools`, cache the result, and close. Records `last_tested_at`
   * + `last_test_error` on the server row so the settings UI can show
   * a status badge without re-running the test on every load.
   */
  async test(organizationId: string, serverId: string): Promise<TestMcpResult> {
    const server = this.requireServer(organizationId, serverId);
    const def = this.toMcpDef(server);
    const testedAt = new Date().toISOString();
    let connection: MCPConnection | undefined;
    // Two-phase: (1) live fetch isolated in its own try; (2) post-fetch
    // persistence writes isolated. Pre-fix a single try wrapped both,
    // so a transient cache/seed/server-row write failure dumped into
    // the catch and rewrote the cache with `existingCache?.tools ?? []`
    // — turning a successful listTools result into an empty inventory
    // on first-ever test of a server. The split mirrors the wake-run
    // path in spirit-agent-run.ts.
    let descriptors: McpToolDescriptor[];
    let recovery: CacheRecovery | undefined;
    try {
      const result = await this.connect(def);
      connection = result.connection;
      recovery = result.recovery;
      const tools = await connection.listTools();
      descriptors = tools.map((tool) => {
        // Carry the server-declared destructive intent through so the
        // classifier honours it before the verb heuristic kicks in.
        // Pre-fix this hint was dropped at the descriptor boundary and
        // every reclassification went straight to verb-based inference.
        const declared =
          typeof (tool as { destructive?: boolean }).destructive === 'boolean'
            ? (tool as { destructive?: boolean }).destructive
            : undefined;
        return {
          name: tool.name,
          description: tool.description ?? '',
          inputSchema:
            tool.inputSchema && typeof tool.inputSchema === 'object'
              ? (tool.inputSchema as Record<string, unknown>)
              : undefined,
          ...(declared !== undefined ? { destructive: declared } : {}),
        };
      });
    } catch (err) {
      const message = errorMessage(err);
      // Live fetch genuinely failed — preserve the previous cache
      // (this is the legacy "transient outage" behaviour).
      const existingCache = this.repo.getMcpToolCache(organizationId, server.id);
      this.repo.saveMcpToolCache({
        mcpServerId: server.id,
        organizationId,
        tools: existingCache?.tools ?? [],
        fetchedAt: existingCache?.fetchedAt ?? testedAt,
        error: message,
      });
      this.repo.saveMcpServer({
        ...server,
        lastTestedAt: testedAt,
        lastTestError: message,
        updatedAt: testedAt,
      });
      if (connection) {
        try { await connection.close(); } catch { /* ignore */ }
      }
      return {
        ok: false,
        tools: existingCache?.tools ?? [],
        error: message,
        testedAt,
      };
    }
    try {
      this.repo.saveMcpToolCache({
        mcpServerId: server.id,
        organizationId,
        tools: descriptors,
        fetchedAt: testedAt,
      });
      const seedEntries = descriptors.map((d) => {
        const out = classifyTool({
          name: d.name,
          description: d.description,
          category: server.category,
          declaredDestructive: d.destructive,
        });
        return {
          toolName: d.name,
          risk: out.risk,
          needsReview: out.needsReview,
          reason: out.reason,
        };
      });
      this.repo.seedInferredClassifications(organizationId, server.id, seedEntries);
      this.repo.saveMcpServer({
        ...server,
        lastTestedAt: testedAt,
        lastTestError: undefined,
        updatedAt: testedAt,
      });
      return { ok: true, tools: descriptors, testedAt, ...(recovery ? { recovery } : {}) };
    } catch (err) {
      const message = errorMessage(err);
      // Persistence write failed AFTER a successful live fetch. Surface
      // the error in the server row but keep the freshly fetched
      // descriptors in the response so the UI shows the real tool
      // inventory instead of an empty list. Don't overwrite the cache:
      // either the saveMcpToolCache itself failed and there's nothing
      // we can do, or a later step did and the cache is already
      // up-to-date with the live tools.
      try {
        this.repo.saveMcpServer({
          ...server,
          lastTestedAt: testedAt,
          lastTestError: message,
          updatedAt: testedAt,
        });
      } catch {
        // best-effort
      }
      return {
        ok: false,
        tools: descriptors,
        error: message,
        testedAt,
      };
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch {
          // Closing a dead connection is best-effort.
        }
      }
    }
  }

  /**
   * Return the cached tool inventory for an MCP server. Does NOT
   * trigger a re-test — callers must invoke `test()` explicitly when
   * the cache is stale.
   */
  listTools(organizationId: string, serverId: string): McpToolDescriptor[] {
    this.requireServer(organizationId, serverId);
    const cache = this.repo.getMcpToolCache(organizationId, serverId);
    return cache?.tools ?? [];
  }

  // ----------------- Governance catalog --------------------------------

  getCatalog(
    organizationId: string,
    agentId?: string,
    role?: 'worker' | 'supervisor',
  ): CatalogResult {
    this.requireOrganization(organizationId);
    const policy = this.repo.getGovernancePolicy(organizationId);
    const servers = this.repo.listMcpServers(organizationId);

    // A grant applies to the current view when its scope matches the
    // requested role (or is 'both'). When `role` is unspecified the
    // catalog is the role-agnostic union — the UI's planning surface.
    const matchesRole = (grantScope: 'worker' | 'supervisor' | 'both'): boolean =>
      role ? grantScope === role || grantScope === 'both' : true;

    // Per-agent perspective: track presence of an attachment row (any
    // scope) separately from a role-matching attachment, because the
    // runtime's reachability rule (listAttachedServersForSpirit) is
    //   exists(attachment row) AND (attachment.scope matches OR
    //   exists(grant with matching scope)).
    // The catalog must mirror that — without the all-scope set, a
    // worker attachment + supervisor-only grant looked unreachable in
    // the supervisor view even though the runtime exposes it.
    const agentAttachmentRows = agentId
      ? this.repo.listAgentMcpAttachments(organizationId, agentId)
      : null;
    const agentMcpAttachmentsAnyScope = agentAttachmentRows
      ? new Set(agentAttachmentRows.map((a) => a.mcpServerId))
      : null;
    const agentMcpAttachments = agentAttachmentRows
      ? new Set(
          agentAttachmentRows
            .filter((a) => matchesRole(a.scope))
            .map((a) => a.mcpServerId),
        )
      : null;
    // PR 6 — tier lookup for the active agent. Surfaced verbatim per
    // server on the catalog response so the Agents tab can render the
    // toggle without a second round trip. Map only populated when
    // agentId is set; absent for the role-agnostic planning view.
    const agentTierByServer = agentAttachmentRows
      ? new Map(agentAttachmentRows.map((a) => [a.mcpServerId, a.tier]))
      : null;
    // For each server: tool-grant set + whether the agent is in "allowlist
    // mode" (has any per-tool rows for that server with a matching scope).
    const agentToolGrantsByServer = new Map<string, Set<string>>();
    if (agentId) {
      for (const row of this.repo.listAgentToolAttachments(organizationId, agentId)) {
        if (!matchesRole(row.scope)) continue;
        let set = agentToolGrantsByServer.get(row.mcpServerId);
        if (!set) {
          set = new Set();
          agentToolGrantsByServer.set(row.mcpServerId, set);
        }
        set.add(row.toolName);
      }
    }

    const agentView: Record<string, CatalogAgentView> | undefined = agentId
      ? {}
      : undefined;

    const out: CatalogResult['servers'] = [];
    for (const server of servers) {
      const cache = this.repo.getMcpToolCache(organizationId, server.id);
      const descriptors = cache?.tools ?? [];
      // Role-scope the per-server attachment list: a worker-only
      // attachment must not surface in the supervisor catalog (and
      // vice versa) because listAttachedServersForSpirit ignores it
      // at the runtime resolver. attachedAgents flows into both
      // tool.attachedAgents (the row-level field the UI uses to
      // decide exposure in all-tools mode) AND the loop that builds
      // grantedByTool / allowlistAgents — so this single filter
      // keeps the catalog and the runtime in lock-step.
      const attachments = this.repo
        .listMcpServerAttachments(organizationId, server.id)
        .filter((a) => matchesRole(a.scope));
      const attachedAgents = [...new Set(attachments.map((a) => a.memberId))];

      // Per-server: agents → tools-granted, for fast row-level "grantedAgents".
      // Also collect the set of agents in allowlist mode on this server
      // (any per-tool grant for the (agent, server) pair flips them in).
      //
      // When the caller scoped the catalog by `role`, only grants with
      // a matching scope contribute — a supervisor-only grant must not
      // make the worker view think the agent is in allowlist mode.
      //
      // Source-of-truth for grantedByTool is the per-tool grant
      // rows on this server, filtered by role scope. Pre-fix the
      // loop only iterated attachedAgents (role-filtered server
      // attachments), so any agent reachable for this role via a
      // per-tool grant on a sibling-role attachment was dropped —
      // the runtime resolver still exposed the tool (since
      // listAttachedServersForSpirit was extended to surface via
      // grants), so the catalog disagreed with reality.
      //
      // Build the candidate-member set from BOTH attachedAgents
      // AND every member who has a per-tool grant on this server
      // matching the requested role, then iterate the union.
      const candidateMembers = new Set<string>(attachedAgents);
      for (const d of descriptors) {
        const grantHolders =
          this.repo.listAgentsForTool?.(organizationId, server.id, d.name) ?? [];
        for (const m of grantHolders) candidateMembers.add(m);
      }
      const grantedByTool = new Map<string, Set<string>>();
      const allowlistAgents = new Set<string>();
      for (const member of candidateMembers) {
        const rows = this.repo
          .listAgentToolAttachments(organizationId, member, server.id)
          .filter((r) => matchesRole(r.scope));
        if (rows.length > 0) allowlistAgents.add(member);
        for (const row of rows) {
          let set = grantedByTool.get(row.toolName);
          if (!set) {
            set = new Set();
            grantedByTool.set(row.toolName, set);
          }
          set.add(member);
        }
      }

      const tools = descriptors.map((d) => {
        const stored: McpToolClassification | null = this.repo.getMcpToolClassification(
          organizationId,
          server.id,
          d.name,
        );
        // Preserve the full classifier output for tools without a
        // stored row — `needsReview` (and `reason`) drives the admin
        // review queue. Pre-fix only `inf.risk` was threaded through,
        // and the catalog defaulted needsReview to false because
        // resolveClassification returns source='inferred' (not
        // 'unknown') when an inferred fallback is supplied — so
        // low-confidence inferences silently never surfaced.
        let inferred: { risk: ToolRiskClass; needsReview: boolean } | undefined;
        if (!stored) {
          const inf = classifyTool({
            name: d.name,
            description: d.description,
            category: server.category,
            declaredDestructive: d.destructive,
          });
          inferred = { risk: inf.risk, needsReview: inf.needsReview };
        }
        const effective = resolveClassification(stored, inferred?.risk);
        const evaluation = evaluatePolicy(policy, {
          // Synthetic agent id so agent rules don't fire — only platform
          // + risk defaults inform the org-default chip.
          agentId: '*org-default*',
          mcpId: server.id,
          toolName: d.name,
          classification: effective.risk,
        });

        const grantedAgents = [...(grantedByTool.get(d.name) ?? [])];

        if (agentView && agentId) {
          const perAgentEval = evaluatePolicy(policy, {
            agentId,
            mcpId: server.id,
            toolName: d.name,
            classification: effective.risk,
          });
          const hasAnyAttachment =
            agentMcpAttachmentsAnyScope?.has(server.id) ?? false;
          const hasScopedAttachment = agentMcpAttachments?.has(server.id) ?? false;
          const toolGrants = agentToolGrantsByServer.get(server.id);
          const hasToolGrant = toolGrants?.has(d.name) ?? false;
          const allowlistMode = (toolGrants?.size ?? 0) > 0;
          // Server reachability mirrors listAttachedServersForSpirit:
          // attachment row must exist AND (scope matches OR an in-scope
          // grant exists). A cross-scope attachment with no grant is
          // not reachable, so we collapse it to 'no-mcp-attachment'.
          const reachable = hasAnyAttachment && (hasScopedAttachment || allowlistMode);
          const exposed = reachable && (!allowlistMode || hasToolGrant);
          const exposureReason: CatalogAgentView['exposureReason'] = !reachable
            ? 'no-mcp-attachment'
            : allowlistMode
              ? hasToolGrant
                ? 'granted'
                : 'no-tool-grant'
              : 'all-tools-mode';
          agentView[`${server.id}::${d.name}`] = {
            agentId,
            state: perAgentEval.state,
            source: perAgentEval.source,
            reason: perAgentEval.reason,
            exposed,
            exposureReason,
          };
        }

        return {
          name: d.name,
          description: d.description ?? '',
          risk: (effective.risk === 'unknown' ? 'write' : effective.risk) as ToolRiskClass,
          source: effective.source,
          needsReview:
            stored?.needsReview ??
            inferred?.needsReview ??
            effective.source === 'unknown',
          effective: {
            state: evaluation.state,
            source: evaluation.source,
            reason: evaluation.reason,
          },
          grantedAgents,
          attachedAgents,
        };
      });

      const agentTier = agentTierByServer?.get(server.id);
      out.push({
        id: server.id,
        name: server.name,
        status: server.status,
        category: server.category,
        toolCount: tools.length,
        allowlistAgents: [...allowlistAgents],
        tools,
        ...(agentTier ? { agentTier } : {}),
      });
    }
    return {
      servers: out,
      riskDefaults: policy.risk_defaults,
      ...(agentView ? { agentView, agentViewId: agentId } : {}),
    };
  }

  /**
   * Grant a single tool to an agent. Idempotent. Auto-attaches the MCP
   * server if no attachment exists.
   *
   * Scope rules:
   *   - existing MCP attachment → mirror its scope so the grant lines
   *     up with whatever spirit role the operator already authorised.
   *   - no MCP attachment + caller specified scope → use it.
   *   - no MCP attachment + no caller scope → default to 'both' so a
   *     per-tool grant works regardless of which spirit role runs.
   *     ('worker' is the wrong default here because a single-tool
   *     grant is a precise op and the operator probably wants it to
   *     be visible everywhere the agent can act.)
   */
  grantToolToAgent(input: {
    organizationId: string;
    memberId: string;
    mcpServerId: string;
    toolName: string;
    scope?: 'worker' | 'supervisor' | 'both';
  }): { attachment: AgentToolAttachment } {
    const server = this.requireServer(input.organizationId, input.mcpServerId);
    if (server.status === 'disabled') {
      throw new Error(`MCP server "${server.name}" is disabled`);
    }
    // Reject phantom tool names BEFORE any persistence. A typo could
    // otherwise persist a grant that doesn't match any live tool,
    // flipping the agent into an empty-allowlist mode → the runtime
    // palette filter would strip every real tool and the server would
    // vanish from the agent's model context.
    this.requireTool(input.organizationId, input.mcpServerId, input.toolName);

    const member = this.repo.getMember(input.organizationId, input.memberId);
    if (!member) throw new Error(`Member not found: ${input.memberId}`);
    if (member.kind !== 'agent') {
      throw new Error(`Cannot grant tool to non-agent member "${input.memberId}"`);
    }
    if (member.retiredAt) {
      throw new Error(`Cannot grant tool to retired member "${input.memberId}"`);
    }

    const now = new Date().toISOString();
    const existingAttachments = this.repo.listAgentMcpAttachments(
      input.organizationId,
      input.memberId,
    );
    const existingServerAttachment = existingAttachments.find(
      (a) => a.mcpServerId === input.mcpServerId,
    );

    // Scope resolution rules:
    //   - Caller supplied scope → use it (the active UI role lands here).
    //   - No caller scope + existing attachment → mirror it (preserves
    //     whatever the operator authorised at the server level).
    //   - No caller scope + no attachment → default 'both' so the
    //     grant reaches whichever spirit role runs.
    const scope =
      input.scope ?? existingServerAttachment?.scope ?? 'both';

    // Wrap the (optional) attachment insert + per-tool grant write
    // in one transaction. Without it, a transient failure on the
    // grant write would leave a fresh attachment with zero matching
    // per-tool rows, which the runtime treats as "all tools" mode
    // for the granted role — silently widening access beyond the
    // single tool the operator clicked.
    //
    // We do NOT promote an existing attachment to 'both' when the
    // grant scope doesn't match. The runtime resolver
    // (listAttachedServersForSpirit) surfaces the server for the
    // granted role via the per-tool grant alone, so the tool reaches
    // the requested role without touching the attachment scope.
    const attachment = this.repo.transaction(() => {
      if (!existingServerAttachment) {
        this.repo.saveAgentMcpAttachment({
          id: randomUUID(),
          organizationId: input.organizationId,
          memberId: input.memberId,
          mcpServerId: input.mcpServerId,
          scope,
          // Legacy attachment-creation path. 'native' preserves the pre-V2
          // behavior exactly (full schemas in palette at spawn). Dispatch-tier
          // attachments arrive via the V2 paths landing in later PRs.
          tier: 'native',
          createdAt: now,
          updatedAt: now,
        });
      }
      return this.repo.saveAgentToolAttachment({
        organizationId: input.organizationId,
        memberId: input.memberId,
        mcpServerId: input.mcpServerId,
        toolName: input.toolName,
        scope,
        createdAt: now,
        updatedAt: now,
      });
    });
    return { attachment };
  }

  // Revoke a single tool grant. MCP attachment is preserved so removing
  // the last grant flips the agent back to "all tools" mode rather than
  // silently detaching the server. UI exposes a separate "Detach MCP"
  // affordance for the all-or-nothing op.
  revokeToolFromAgent(
    organizationId: string,
    memberId: string,
    mcpServerId: string,
    toolName: string,
  ): void {
    this.repo.deleteAgentToolAttachment(organizationId, memberId, mcpServerId, toolName);
  }

  listToolGrants(
    organizationId: string,
    memberId: string,
  ): AgentToolAttachment[] {
    return this.repo.listAgentToolAttachments(organizationId, memberId);
  }

  setToolClassification(input: {
    organizationId: string;
    serverId: string;
    toolName: string;
    risk: ToolRiskClass;
    reason?: string;
    updatedBy: string;
  }): McpToolClassification {
    this.requireServer(input.organizationId, input.serverId);
    // Validate up-front so a typo or removed tool can't leave an
    // orphaned manual row in mcp_tool_classifications — a future tool
    // with the same name would otherwise inherit the wrong class.
    this.requireTool(input.organizationId, input.serverId, input.toolName);
    return this.repo.upsertMcpToolClassification({
      organizationId: input.organizationId,
      mcpServerId: input.serverId,
      toolName: input.toolName,
      risk: input.risk,
      source: 'manual',
      needsReview: false,
      reason: input.reason,
      updatedAt: new Date().toISOString(),
      updatedBy: input.updatedBy,
    });
  }

  resetToolClassification(
    organizationId: string,
    serverId: string,
    toolName: string,
  ): McpToolClassification {
    const server = this.requireServer(organizationId, serverId);
    // Reset is a CLEANUP op — strictly less restrictive than
    // grantToolToAgent / setToolClassification. The admin is asking
    // to undo a manual override. They must be allowed to do that
    // even if the cache has drifted (renamed tool, MCP upgrade) as
    // long as some persisted state ties the name to this server:
    //
    //   - cache descriptor present → reseed from live descriptor
    //   - cache gone but classification row exists → delete the
    //     manual row + reseed from a name-only classify (safe
    //     fallback; same heuristic as runtime spawn for unseeded
    //     tools)
    //   - nothing anywhere → pure typo, throw
    //
    // Grant/setClassification stay strict because phantom writes
    // there are exploitable; reset only deletes / re-seeds an
    // inferred row, neither of which corrupts the runtime palette.
    const cache = this.repo.getMcpToolCache(organizationId, serverId);
    const descriptor = cache?.tools.find((t) => t.name === toolName);
    const stored = this.repo.getMcpToolClassification(
      organizationId,
      serverId,
      toolName,
    );
    if (!descriptor && !stored) {
      throw new Error(
        `Tool not found: "${toolName}" on MCP server "${serverId}". Run Test on the server first or check the tool name.`,
      );
    }

    // Single upsert: ON CONFLICT REPLACE collapses delete+reseed into
    // one statement, so a transient failure can't strand the tool
    // unclassified between the two writes.
    const inf = classifyTool({
      name: descriptor?.name ?? toolName,
      description: descriptor?.description,
      category: server.category,
      declaredDestructive: descriptor?.destructive,
    });
    const now = new Date().toISOString();
    return this.repo.upsertMcpToolClassification({
      organizationId,
      mcpServerId: serverId,
      toolName: descriptor?.name ?? toolName,
      risk: inf.risk,
      source: 'inferred',
      needsReview: inf.needsReview,
      reason: inf.reason,
      updatedAt: now,
      updatedBy: 'system:inference',
    });
  }

  // ----------------- Attachments ---------------------------------------

  attach(input: AttachMcpInput): void {
    this.requireOrganization(input.organizationId);
    const server = this.requireServer(input.organizationId, input.mcpServerId);
    if (server.status === 'disabled') {
      throw new Error(`MCP server "${server.name}" is disabled`);
    }
    const member = this.repo.getMember(input.organizationId, input.memberId);
    if (!member) {
      throw new Error(`Member not found: ${input.memberId}`);
    }
    if (member.kind !== 'agent') {
      throw new Error(`Cannot attach MCP to non-agent member "${input.memberId}"`);
    }
    if (member.retiredAt) {
      throw new Error(`Cannot attach MCP to retired member "${input.memberId}"`);
    }

    const now = new Date().toISOString();
    this.repo.saveAgentMcpAttachment({
      id: randomUUID(),
      organizationId: input.organizationId,
      memberId: input.memberId,
      mcpServerId: input.mcpServerId,
      scope: input.scope ?? 'worker',
      // Legacy attachment-creation path; see grantToolToAgent comment above.
      tier: 'native',
      createdAt: now,
      updatedAt: now,
    });
  }

  detach(organizationId: string, memberId: string, mcpServerId: string): void {
    this.requireOrganization(organizationId);
    this.repo.deleteAgentMcpAttachment(organizationId, memberId, mcpServerId);
    // Cascade per-tool grants too. Without this, re-attaching later
    // would immediately restore stale grants — flipping the agent
    // back into allowlist mode with whatever tools were granted
    // before, none of which the operator explicitly re-authorised.
    this.repo.deleteAgentToolAttachmentsForAgent(
      organizationId,
      memberId,
      mcpServerId,
    );
  }

  /**
   * Flip the tier of an existing (member, server) attachment row.
   * Mirrors the §13.3 rollback contract: tier='dispatch' rows are
   * harmless metadata when the V2 spawn flag is off (the legacy path
   * is tier-blind). Wraps PR 1's `repo.updateAttachmentTier`.
   *
   * Validates org + server + member up front so a missing row, a
   * disabled server, or a retired agent throws cleanly instead of
   * silently no-op'ing through the repo's UPDATE.
   */
  updateAttachmentTier(input: {
    organizationId: string;
    memberId: string;
    mcpServerId: string;
    tier: AgentMcpAttachment['tier'];
  }): AgentMcpAttachment {
    this.requireOrganization(input.organizationId);
    const server = this.requireServer(input.organizationId, input.mcpServerId);
    if (server.status === 'disabled') {
      throw new Error(`MCP server "${server.name}" is disabled`);
    }
    const member = this.repo.getMember(input.organizationId, input.memberId);
    if (!member) {
      throw new Error(`Member not found: ${input.memberId}`);
    }
    if (member.kind !== 'agent') {
      throw new Error(
        `Cannot update tier on non-agent member "${input.memberId}"`,
      );
    }
    if (member.retiredAt) {
      throw new Error(
        `Cannot update tier on retired member "${input.memberId}"`,
      );
    }
    // Capture the prior tier before the UPDATE so the §12 audit row
    // carries fromTier accurately. Reading the row twice is cheap; the
    // alternative (returning fromTier from the repo UPDATE) would
    // ripple through the ApiRepository surface for one telemetry field.
    const priorAttachments = this.repo.listAgentMcpAttachments(
      input.organizationId,
      input.memberId,
    );
    const prior = priorAttachments.find((row) => row.mcpServerId === input.mcpServerId);
    const updated = this.repo.updateAttachmentTier(
      input.organizationId,
      input.memberId,
      input.mcpServerId,
      input.tier,
      new Date().toISOString(),
    );
    if (!updated) {
      // Message starts with "Attachment not found" so mapMcpRouteError
      // classifies it as 404 ERR_NOT_FOUND, not the catch-all 500.
      // Without this prefix the missing-attachment branch leaked
      // through to the route's `ERR_INTERNAL` fallback and broke
      // the UI's error handling.
      throw new Error(
        `Attachment not found for member "${input.memberId}" on server "${server.name}". ` +
          'Attach it first via POST /settings/agents/:agentId/mcps.',
      );
    }
    // §12.2 audit emit. Only fire on an actual tier change — a no-op
    // PATCH (same tier) shouldn't produce a spurious row that distorts
    // the curation job's idle-server signal in PR 9.
    if (prior && prior.tier !== updated.tier) {
      const writer = createConnectorAuditWriter({ repo: this.repo });
      writer.tierChanged({
        organizationId: input.organizationId,
        memberId: input.memberId,
        serverId: input.mcpServerId,
        fromTier: prior.tier,
        toTier: updated.tier,
      });
    }
    return updated;
  }

  listAttachments(organizationId: string, memberId: string) {
    this.requireOrganization(organizationId);
    return this.repo.listAgentMcpAttachments(organizationId, memberId);
  }

  // ----------------- Channel attachments (PR 10) -----------------------

  /**
   * Attach an MCP server to a channel. Every agent in the channel
   * inherits this attachment via the §17.5.3 union step in V2 spawn.
   *
   * Default tier is 'dispatch' when the dispatch flag is on for this
   * org (per the schema default). Operators can promote to native via
   * `updateChannelAttachmentTier`. With the flag off the new row is
   * still safely written — legacy spawn never reads channel
   * attachments, and the row stays harmless metadata.
   */
  attachServerToChannel(input: {
    organizationId: string;
    channelId: string;
    mcpServerId: string;
    scope?: 'worker' | 'supervisor' | 'both';
  }): ChannelMcpAttachment {
    this.requireOrganization(input.organizationId);
    const server = this.requireServer(input.organizationId, input.mcpServerId);
    if (server.status === 'disabled') {
      throw new Error(`MCP server "${server.name}" is disabled`);
    }
    // Validate the channel — without this, an UPSERT against a
    // non-existent channelId would succeed and produce attachment
    // rows that no agent ever inherits (channel_members joins to
    // nothing). The error message starts with a known prefix so
    // mapMcpRouteError can classify it as 404.
    const channel = this.repo.getChannel(input.organizationId, input.channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${input.channelId}`);
    }
    const now = new Date().toISOString();
    return this.repo.saveChannelMcpAttachment({
      id: randomUUID(),
      organizationId: input.organizationId,
      channelId: input.channelId,
      mcpServerId: input.mcpServerId,
      scope: input.scope ?? 'worker',
      // Defaults to 'dispatch' per the Zod schema default — channel
      // attachments lean dispatch to keep the §17.5.3 native-balloon
      // surface narrow.
      tier: 'dispatch',
      createdAt: now,
      updatedAt: now,
    });
  }

  detachServerFromChannel(
    organizationId: string,
    channelId: string,
    mcpServerId: string,
  ): void {
    this.requireOrganization(organizationId);
    this.repo.deleteChannelMcpAttachment(organizationId, channelId, mcpServerId);
  }

  /**
   * Flip the tier of an existing channel attachment row. Mirrors the
   * shape of agent-side `updateAttachmentTier` so the channel
   * settings UI can reuse the same surface contract.
   *
   * Does NOT emit a §12 audit event — connector_tier_changed audits
   * are scoped to per-agent tier flips today, because the audit
   * actor is the member whose effective set changes. A channel flip
   * affects every member of the channel, which would either need a
   * multi-emit (one audit row per member) or a new event type
   * (connector_channel_tier_changed). Deferred to a later PR per
   * §17.5 scope discipline.
   */
  updateChannelAttachmentTier(input: {
    organizationId: string;
    channelId: string;
    mcpServerId: string;
    tier: ChannelMcpAttachment['tier'];
  }): ChannelMcpAttachment {
    this.requireOrganization(input.organizationId);
    const server = this.requireServer(input.organizationId, input.mcpServerId);
    if (server.status === 'disabled') {
      throw new Error(`MCP server "${server.name}" is disabled`);
    }
    const channel = this.repo.getChannel(input.organizationId, input.channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${input.channelId}`);
    }
    const updated = this.repo.updateChannelAttachmentTier(
      input.organizationId,
      input.channelId,
      input.mcpServerId,
      input.tier,
      new Date().toISOString(),
    );
    if (!updated) {
      throw new Error(
        `Attachment not found for channel "${input.channelId}" on server "${server.name}". ` +
          'Attach it first via POST /settings/channels/:channelId/mcps.',
      );
    }
    return updated;
  }

  listChannelAttachments(organizationId: string, channelId: string) {
    this.requireOrganization(organizationId);
    return this.repo.listChannelMcpAttachments(organizationId, channelId);
  }

  // ----------------- Internal helpers ----------------------------------

  /** Materialise an MCPDef for transport / connection from a stored row. */
  toMcpDef(server: McpServer): MCPDef {
    return materializeMcpDef(this.repo, server);
  }

  /**
   * Strip every key_ref. Surface only `hasEnv` / `hasHeaders` and the
   * key NAMES (not values) so settings forms can render "configured"
   * indicators without ever exposing secret material.
   */
  private toPublic(server: McpServer): McpServerPublic {
    const env = readSecretMap(this.repo, server.envKeyRef);
    const headers = readSecretMap(this.repo, server.headersKeyRef);
    return McpServerPublicSchema.parse({
      id: server.id,
      organizationId: server.organizationId,
      name: server.name,
      description: server.description,
      category: server.category,
      transport: server.transport,
      command: server.command,
      args: server.args,
      url: server.url,
      isolation: server.isolation,
      status: server.status,
      hasEnv: Object.keys(env).length > 0,
      hasHeaders: Object.keys(headers).length > 0,
      envKeys: Object.keys(env).sort(),
      headerKeys: Object.keys(headers).sort(),
      lastTestedAt: server.lastTestedAt,
      lastTestError: server.lastTestError,
      createdBy: server.createdBy,
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
    });
  }



  private requireOrganization(organizationId: string): void {
    if (!this.repo.getOrganization(organizationId)) {
      throw new Error(`Organization not found: ${organizationId}`);
    }
  }

  private requireServer(organizationId: string, serverId: string): McpServer {
    this.requireOrganization(organizationId);
    const server = this.repo.getMcpServer(organizationId, serverId);
    if (!server) {
      throw new Error(`MCP server not found: ${serverId}`);
    }
    return server;
  }

  // Validates the tool exists in the *current* cached inventory. The
  // cache is the source of truth for "is this tool live right now":
  // both McpRegistryService.test() and the runtime spawn path
  // (buildMcpToolDefinitions) populate it from a fresh listTools, so
  // any cache row reflects a tool the MCP just confirmed exists.
  //
  // Classification rows are NOT accepted as proof of existence:
  // mcp_tool_classifications outlives the cache (manual overrides
  // are sticky by design), so a stale row from a renamed/removed
  // tool could otherwise authorise grants whose names never match
  // anything live — the runtime palette filter would then narrow
  // the agent's tool list to that phantom name and the whole server
  // would vanish from the model context.
  //
  // Throws "Tool not found ..." so the route mapper can return 404.
  private requireTool(
    organizationId: string,
    serverId: string,
    toolName: string,
  ): void {
    const cache = this.repo.getMcpToolCache(organizationId, serverId);
    if (cache?.tools?.some((t) => t.name === toolName)) return;
    throw new Error(
      `Tool not found: "${toolName}" on MCP server "${serverId}". Run Test on the server first or check the tool name.`,
    );
  }
}
