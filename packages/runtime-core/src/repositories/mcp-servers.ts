import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import {
  AgentMcpAttachmentSchema,
  McpServerSchema,
  McpToolCacheSchema,
  type AgentMcpAttachment,
  type McpAttachmentScope,
  type McpServer,
  type McpToolCache,
  type McpToolDescriptor,
} from '@ujima/shared';
import { optionalRowString, parseJsonArray, rowString } from './common.js';

type Row = Record<string, unknown>;

function rowToServer(row: Row): McpServer {
  return McpServerSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    name: rowString(row, 'name'),
    description: rowString(row, 'description'),
    category: rowString(row, 'category'),
    transport: rowString(row, 'transport'),
    command: optionalRowString(row, 'command'),
    args: parseJsonArray(row.args),
    envKeyRef: optionalRowString(row, 'env_key_ref'),
    url: optionalRowString(row, 'url'),
    headersKeyRef: optionalRowString(row, 'headers_key_ref'),
    isolation: rowString(row, 'isolation'),
    status: rowString(row, 'status'),
    lastTestedAt: optionalRowString(row, 'last_tested_at'),
    lastTestError: optionalRowString(row, 'last_test_error'),
    createdBy: rowString(row, 'created_by'),
    createdAt: rowString(row, 'created_at'),
    updatedAt: rowString(row, 'updated_at'),
  });
}

export function saveMcpServer(db: DbHandle, server: McpServer): McpServer {
  const payload = McpServerSchema.parse(server);
  db.prepare(
    `INSERT INTO mcp_servers (
       id, organization_id, name, description, category, transport,
       command, args, env_key_ref, url, headers_key_ref, isolation,
       status, last_tested_at, last_test_error, created_by, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       category = excluded.category,
       transport = excluded.transport,
       command = excluded.command,
       args = excluded.args,
       env_key_ref = excluded.env_key_ref,
       url = excluded.url,
       headers_key_ref = excluded.headers_key_ref,
       isolation = excluded.isolation,
       status = excluded.status,
       last_tested_at = excluded.last_tested_at,
       last_test_error = excluded.last_test_error,
       updated_at = excluded.updated_at`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.name,
    payload.description,
    payload.category,
    payload.transport,
    payload.command ?? null,
    JSON.stringify(payload.args),
    payload.envKeyRef ?? null,
    payload.url ?? null,
    payload.headersKeyRef ?? null,
    payload.isolation,
    payload.status,
    payload.lastTestedAt ?? null,
    payload.lastTestError ?? null,
    payload.createdBy,
    payload.createdAt,
    payload.updatedAt,
  );
  return payload;
}

export function getMcpServer(
  db: DbHandle,
  organizationId: string,
  serverId: string,
): McpServer | null {
  const row = db
    .prepare('SELECT * FROM mcp_servers WHERE organization_id = ? AND id = ?')
    .get(organizationId, serverId) as Row | null;
  return row ? rowToServer(row) : null;
}

export function getMcpServerByName(
  db: DbHandle,
  organizationId: string,
  name: string,
): McpServer | null {
  const row = db
    .prepare('SELECT * FROM mcp_servers WHERE organization_id = ? AND name = ?')
    .get(organizationId, name) as Row | null;
  return row ? rowToServer(row) : null;
}

export function listMcpServers(db: DbHandle, organizationId: string): McpServer[] {
  const rows = db
    .prepare(
      `SELECT * FROM mcp_servers WHERE organization_id = ?
       ORDER BY name ASC`,
    )
    .all(organizationId) as Row[];
  return rows.map(rowToServer);
}

export function deleteMcpServer(db: DbHandle, organizationId: string, serverId: string): void {
  // Cascade attachments + tool cache + classifications so the FK
  // invariant survives even without ON DELETE CASCADE (which isn't
  // declared on the table since we want explicit control over the
  // soft-disable vs hard-delete semantics).
  db.prepare('DELETE FROM agent_mcp_attachments WHERE organization_id = ? AND mcp_server_id = ?').run(
    organizationId,
    serverId,
  );
  db.prepare('DELETE FROM mcp_tool_cache WHERE organization_id = ? AND mcp_server_id = ?').run(
    organizationId,
    serverId,
  );
  db.prepare(
    'DELETE FROM mcp_tool_classifications WHERE organization_id = ? AND mcp_server_id = ?',
  ).run(organizationId, serverId);
  db.prepare(
    'DELETE FROM agent_tool_attachments WHERE organization_id = ? AND mcp_server_id = ?',
  ).run(organizationId, serverId);
  db.prepare('DELETE FROM mcp_servers WHERE organization_id = ? AND id = ?').run(
    organizationId,
    serverId,
  );
}

// ---------------- Attachments ----------------------------------------

function rowToAttachment(row: Row): AgentMcpAttachment {
  // `tier` is missing from rows on databases that pre-date migration 048
  // until the migration runs. The schema's `.default('native')` handles
  // that — reading a NULL/absent column yields undefined, which Zod
  // replaces with the default. Same backwards-compat shape as `scope`.
  const tier = (row as Record<string, unknown>).tier;
  return AgentMcpAttachmentSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    memberId: rowString(row, 'member_id'),
    mcpServerId: rowString(row, 'mcp_server_id'),
    scope: rowString(row, 'scope'),
    ...(typeof tier === 'string' ? { tier } : {}),
    createdAt: rowString(row, 'created_at'),
    updatedAt: rowString(row, 'updated_at'),
  });
}

export function saveAgentMcpAttachment(
  db: DbHandle,
  attachment: AgentMcpAttachment,
): AgentMcpAttachment {
  const payload = AgentMcpAttachmentSchema.parse(attachment);
  db.prepare(
    `INSERT INTO agent_mcp_attachments (
       id, organization_id, member_id, mcp_server_id, scope, tier, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(organization_id, member_id, mcp_server_id) DO UPDATE SET
       scope = excluded.scope,
       tier = excluded.tier,
       updated_at = excluded.updated_at`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.memberId,
    payload.mcpServerId,
    payload.scope,
    payload.tier,
    payload.createdAt,
    payload.updatedAt,
  );
  return payload;
}

// Tier-only update so the V2 spawn path and the settings tier-toggle UI
// can promote/demote without rewriting scope or createdAt. Returns the
// resulting row (or null if no matching attachment exists) so callers
// can audit-log the transition without an extra read.
export function updateAttachmentTier(
  db: DbHandle,
  organizationId: string,
  memberId: string,
  mcpServerId: string,
  tier: AgentMcpAttachment['tier'],
  updatedAt: string,
): AgentMcpAttachment | null {
  // Validate the tier value through Zod up-front; defence-in-depth
  // against callers passing arbitrary strings from API payloads.
  AgentMcpAttachmentSchema.shape.tier.parse(tier);
  const result = db
    .prepare(
      `UPDATE agent_mcp_attachments
         SET tier = ?, updated_at = ?
         WHERE organization_id = ? AND member_id = ? AND mcp_server_id = ?`,
    )
    .run(tier, updatedAt, organizationId, memberId, mcpServerId);
  if (result.changes === 0) return null;
  const row = db
    .prepare(
      `SELECT * FROM agent_mcp_attachments
         WHERE organization_id = ? AND member_id = ? AND mcp_server_id = ?`,
    )
    .get(organizationId, memberId, mcpServerId) as Row | undefined;
  return row ? rowToAttachment(row) : null;
}

export function deleteAgentMcpAttachment(
  db: DbHandle,
  organizationId: string,
  memberId: string,
  mcpServerId: string,
): void {
  db.prepare(
    `DELETE FROM agent_mcp_attachments
       WHERE organization_id = ? AND member_id = ? AND mcp_server_id = ?`,
  ).run(organizationId, memberId, mcpServerId);
}

export function listAgentMcpAttachments(
  db: DbHandle,
  organizationId: string,
  memberId: string,
): AgentMcpAttachment[] {
  const rows = db
    .prepare(
      `SELECT * FROM agent_mcp_attachments
         WHERE organization_id = ? AND member_id = ?
         ORDER BY created_at ASC`,
    )
    .all(organizationId, memberId) as Row[];
  return rows.map(rowToAttachment);
}

export function listMcpServerAttachments(
  db: DbHandle,
  organizationId: string,
  mcpServerId: string,
): AgentMcpAttachment[] {
  const rows = db
    .prepare(
      `SELECT * FROM agent_mcp_attachments
         WHERE organization_id = ? AND mcp_server_id = ?
         ORDER BY created_at ASC`,
    )
    .all(organizationId, mcpServerId) as Row[];
  return rows.map(rowToAttachment);
}

/**
 * Resolve the attached MCPs visible to a given spirit role. `'worker'`
 * receives attachments scoped `worker` or `both`; `'supervisor'`
 * receives `supervisor` or `both`. Defensive: callers should not
 * filter again.
 *
 * Three SQL-layer filters guard the result:
 *   1. `mcp_servers.status = 'active'` — disabled servers are excluded
 *      so an operator can pause access without losing the attachment
 *      metadata.
 *   2. `members.retired_at IS NULL` — retired agents are excluded so a
 *      member retired AFTER MCPs were attached can't keep invoking
 *      those servers through a still-running spirit. (The attach()
 *      service already blocks new bindings for retired members; this
 *      closes the same boundary on the runtime side.)
 *   3. `agent_mcp_attachments.scope IN (...)` — role-scoped: a
 *      `worker`-scoped attachment is invisible to supervisor spirits
 *      and vice-versa.
 */
export function listAttachedServersForSpirit(
  db: DbHandle,
  organizationId: string,
  memberId: string,
  role: 'worker' | 'supervisor',
): { attachment: AgentMcpAttachment; server: McpServer }[] {
  const allowedScopes: McpAttachmentScope[] =
    role === 'supervisor' ? ['supervisor', 'both'] : ['worker', 'both'];
  const placeholders = allowedScopes.map(() => '?').join(', ');
  // The server is reachable for `role` when EITHER
  //   (a) the agent_mcp_attachments scope covers the role, OR
  //   (b) the agent has at least one per-tool grant whose scope
  //       covers the role on this server.
  // (b) used to be coupled with promoting the attachment to 'both'
  // in McpRegistryService.grantToolToAgent, which broadened the
  // SERVER attachment beyond the granted tool and re-exposed the
  // full MCP to the sibling role via the "no matching grants =
  // all-tools" fallback in spirit-agent-run. Now the attachment
  // scope stays untouched and the grant alone is enough to surface
  // the server here.
  const rows = db
    .prepare(
      `SELECT a.*, s.id AS s_id, s.organization_id AS s_organization_id,
              s.name AS s_name, s.description AS s_description,
              s.category AS s_category, s.transport AS s_transport,
              s.command AS s_command, s.args AS s_args,
              s.env_key_ref AS s_env_key_ref, s.url AS s_url,
              s.headers_key_ref AS s_headers_key_ref,
              s.isolation AS s_isolation, s.status AS s_status,
              s.last_tested_at AS s_last_tested_at,
              s.last_test_error AS s_last_test_error,
              s.created_by AS s_created_by,
              s.created_at AS s_created_at,
              s.updated_at AS s_updated_at
         FROM agent_mcp_attachments a
         JOIN mcp_servers s
           ON s.id = a.mcp_server_id
          AND s.organization_id = a.organization_id
         JOIN members m
           ON m.id = a.member_id
          AND m.organization_id = a.organization_id
        WHERE a.organization_id = ? AND a.member_id = ?
          AND s.status = 'active'
          AND m.retired_at IS NULL
          AND (
            a.scope IN (${placeholders})
            OR EXISTS (
              SELECT 1 FROM agent_tool_attachments g
              WHERE g.organization_id = a.organization_id
                AND g.member_id = a.member_id
                AND g.mcp_server_id = a.mcp_server_id
                AND g.scope IN (${placeholders})
            )
          )
        ORDER BY s.name ASC`,
    )
    .all(organizationId, memberId, ...allowedScopes, ...allowedScopes) as Row[];

  return rows.map((row) => ({
    attachment: AgentMcpAttachmentSchema.parse({
      id: rowString(row, 'id'),
      organizationId: rowString(row, 'organization_id'),
      memberId: rowString(row, 'member_id'),
      mcpServerId: rowString(row, 'mcp_server_id'),
      scope: rowString(row, 'scope'),
      createdAt: rowString(row, 'created_at'),
      updatedAt: rowString(row, 'updated_at'),
    }),
    server: McpServerSchema.parse({
      id: rowString(row, 's_id'),
      organizationId: rowString(row, 's_organization_id'),
      name: rowString(row, 's_name'),
      description: rowString(row, 's_description'),
      category: rowString(row, 's_category'),
      transport: rowString(row, 's_transport'),
      command: optionalRowString(row, 's_command'),
      args: parseJsonArray(row.s_args),
      envKeyRef: optionalRowString(row, 's_env_key_ref'),
      url: optionalRowString(row, 's_url'),
      headersKeyRef: optionalRowString(row, 's_headers_key_ref'),
      isolation: rowString(row, 's_isolation'),
      status: rowString(row, 's_status'),
      lastTestedAt: optionalRowString(row, 's_last_tested_at'),
      lastTestError: optionalRowString(row, 's_last_test_error'),
      createdBy: rowString(row, 's_created_by'),
      createdAt: rowString(row, 's_created_at'),
      updatedAt: rowString(row, 's_updated_at'),
    }),
  }));
}

// ---------------- Tool cache -----------------------------------------

export function saveMcpToolCache(db: DbHandle, cache: McpToolCache): McpToolCache {
  const payload = McpToolCacheSchema.parse(cache);
  db.prepare(
    `INSERT INTO mcp_tool_cache (mcp_server_id, organization_id, tools_json, fetched_at, error)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(mcp_server_id) DO UPDATE SET
       tools_json = excluded.tools_json,
       fetched_at = excluded.fetched_at,
       error = excluded.error`,
  ).run(
    payload.mcpServerId,
    payload.organizationId,
    JSON.stringify(payload.tools),
    payload.fetchedAt,
    payload.error ?? null,
  );
  return payload;
}

export function getMcpToolCache(
  db: DbHandle,
  organizationId: string,
  mcpServerId: string,
): McpToolCache | null {
  const row = db
    .prepare(
      `SELECT * FROM mcp_tool_cache
         WHERE organization_id = ? AND mcp_server_id = ?`,
    )
    .get(organizationId, mcpServerId) as Row | null;
  if (!row) return null;
  const toolsJson = typeof row.tools_json === 'string' ? row.tools_json : '[]';
  let tools: McpToolDescriptor[] = [];
  try {
    const parsed = JSON.parse(toolsJson) as unknown;
    if (Array.isArray(parsed)) {
      tools = parsed
        .map((entry) => {
          const result = McpToolDescriptorSchemaSafe(entry);
          return result;
        })
        .filter((entry): entry is McpToolDescriptor => entry !== null);
    }
  } catch {
    // Bad cache row; fall back to empty list rather than throwing.
  }
  return McpToolCacheSchema.parse({
    mcpServerId: rowString(row, 'mcp_server_id'),
    organizationId: rowString(row, 'organization_id'),
    tools,
    fetchedAt: rowString(row, 'fetched_at'),
    error: optionalRowString(row, 'error'),
  });
}

function McpToolDescriptorSchemaSafe(entry: unknown): McpToolDescriptor | null {
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  if (typeof record.name !== 'string' || record.name.length === 0) return null;
  return {
    name: record.name,
    description: typeof record.description === 'string' ? record.description : '',
    inputSchema:
      record.inputSchema && typeof record.inputSchema === 'object' && !Array.isArray(record.inputSchema)
        ? (record.inputSchema as Record<string, unknown>)
        : undefined,
    destructive: typeof record.destructive === 'boolean' ? record.destructive : undefined,
  };
}
