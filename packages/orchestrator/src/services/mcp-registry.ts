import { randomUUID } from 'node:crypto';
import {
  McpServerPublicSchema,
  McpServerSchema,
  type McpAttachmentScope,
  type McpServer,
  type McpServerPublic,
  type McpToolDescriptor,
} from '@ujima/shared';
import { connectMCP, parseMCPConfigJSON, type MCPConnection } from '@ujima/mcp-client';
import type { MCPDef } from '@ujima/shared';
import { materializeMcpDef } from './mcp-runtime.js';
import type { ApiRepository } from './repository-reader.js';

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
}

export class McpRegistryService {
  constructor(private readonly repo: ApiRepository) {}

  // ----------------- CRUD -----------------------------------------------

  create(input: CreateMcpServerInput): McpServerPublic {
    this.requireOrganization(input.organizationId);
    if (!input.name.trim()) {
      throw new Error('MCP server name is required');
    }
    if (this.repo.getMcpServerByName(input.organizationId, input.name)) {
      throw new Error(`MCP server "${input.name}" already exists in this organisation`);
    }
    this.validateConnectivity(input);

    const now = new Date().toISOString();
    const envKeyRef = this.writeSecretMap(input.env);
    const headersKeyRef = this.writeSecretMap(input.headers);

    const server = McpServerSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      name: input.name.trim(),
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
    this.repo.saveMcpServer(server);
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
      nextEnvKeyRef = this.writeSecretMap(input.env);
      envKeyRef = nextEnvKeyRef;
    }
    let headersKeyRef = existing.headersKeyRef;
    let nextHeadersKeyRef: string | undefined;
    if (input.headers !== undefined) {
      nextHeadersKeyRef = this.writeSecretMap(input.headers);
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
      this.deleteSecretIfPresent(nextEnvKeyRef);
      this.deleteSecretIfPresent(nextHeadersKeyRef);
      throw err;
    }
    if (input.env !== undefined && existing.envKeyRef !== envKeyRef) {
      this.deleteSecretIfPresent(existing.envKeyRef);
    }
    if (input.headers !== undefined && existing.headersKeyRef !== headersKeyRef) {
      this.deleteSecretIfPresent(existing.headersKeyRef);
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
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse MCP config JSON: ${message}`);
    }

    const imported: McpServerPublic[] = [];
    const skipped: { name: string; reason: string }[] = [];
    const now = new Date().toISOString();

    for (const def of parsed.defs) {
      if (this.repo.getMcpServerByName(input.organizationId, def.name)) {
        skipped.push({
          name: def.name,
          reason: 'A server with this name already exists in the organisation',
        });
        continue;
      }
      const envKeyRef = this.writeSecretMap(Object.keys(def.env).length > 0 ? def.env : undefined);
      const headersKeyRef = this.writeSecretMap(
        def.headers && Object.keys(def.headers).length > 0 ? def.headers : undefined,
      );
      const server = McpServerSchema.parse({
        id: randomUUID(),
        organizationId: input.organizationId,
        name: def.name,
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
      this.repo.saveMcpServer(server);
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
    try {
      connection = await connectMCP(def);
      const tools = await connection.listTools();
      const descriptors: McpToolDescriptor[] = tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
        inputSchema:
          tool.inputSchema && typeof tool.inputSchema === 'object'
            ? (tool.inputSchema as Record<string, unknown>)
            : undefined,
      }));
      this.repo.saveMcpToolCache({
        mcpServerId: server.id,
        organizationId,
        tools: descriptors,
        fetchedAt: testedAt,
      });
      this.repo.saveMcpServer({
        ...server,
        status: 'active',
        lastTestedAt: testedAt,
        lastTestError: undefined,
        updatedAt: testedAt,
      });
      return { ok: true, tools: descriptors, testedAt };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.repo.saveMcpToolCache({
        mcpServerId: server.id,
        organizationId,
        tools: [],
        fetchedAt: testedAt,
        error: message,
      });
      this.repo.saveMcpServer({
        ...server,
        // Don't auto-flip to disabled — operator decides. Just record
        // the test failure so the UI can show it.
        lastTestedAt: testedAt,
        lastTestError: message,
        updatedAt: testedAt,
      });
      return { ok: false, tools: [], error: message, testedAt };
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
      createdAt: now,
      updatedAt: now,
    });
  }

  detach(organizationId: string, memberId: string, mcpServerId: string): void {
    this.requireOrganization(organizationId);
    this.repo.deleteAgentMcpAttachment(organizationId, memberId, mcpServerId);
  }

  listAttachments(organizationId: string, memberId: string) {
    this.requireOrganization(organizationId);
    return this.repo.listAgentMcpAttachments(organizationId, memberId);
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
    const env = this.readSecretMap(server.envKeyRef);
    const headers = this.readSecretMap(server.headersKeyRef);
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

  private writeSecretMap(map: Record<string, string> | undefined): string | undefined {
    if (!map || Object.keys(map).length === 0) return undefined;
    return this.repo.writeSecret(JSON.stringify(map));
  }

  private deleteSecretIfPresent(keyRef: string | undefined): void {
    if (keyRef) this.repo.deleteSecret(keyRef);
  }

  private readSecretMap(keyRef: string | undefined): Record<string, string> {
    if (!keyRef) return {};
    const raw = this.repo.readSecret(keyRef);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof key === 'string' && typeof value === 'string') {
            out[key] = value;
          }
        }
        return out;
      }
    } catch {
      // Corrupt secret blob — return empty rather than throwing so the
      // settings page can still render and the operator can fix it.
    }
    return {};
  }

  private validateConnectivity(input: CreateMcpServerInput): void {
    if (input.transport === 'stdio') {
      if (!input.command || input.command.trim().length === 0) {
        throw new Error('stdio MCP servers require a command');
      }
    } else {
      if (!input.url || input.url.trim().length === 0) {
        throw new Error(`${input.transport} MCP servers require a url`);
      }
    }
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
}
