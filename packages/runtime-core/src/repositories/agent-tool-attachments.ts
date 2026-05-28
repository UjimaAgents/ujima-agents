import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import {
  AgentToolAttachmentSchema,
  type AgentToolAttachment,
  type McpAttachmentScope,
} from '@ujima/shared';
import { rowString } from './common.js';

type Row = Record<string, unknown>;

function rowToAttachment(row: Row): AgentToolAttachment {
  return AgentToolAttachmentSchema.parse({
    organizationId: rowString(row, 'organization_id'),
    memberId: rowString(row, 'member_id'),
    mcpServerId: rowString(row, 'mcp_server_id'),
    toolName: rowString(row, 'tool_name'),
    scope: rowString(row, 'scope') as McpAttachmentScope,
    createdAt: rowString(row, 'created_at'),
    updatedAt: rowString(row, 'updated_at'),
  });
}

export function saveAgentToolAttachment(
  db: DbHandle,
  attachment: AgentToolAttachment,
): AgentToolAttachment {
  const payload = AgentToolAttachmentSchema.parse(attachment);
  db.prepare(
    `INSERT INTO agent_tool_attachments (
       organization_id, member_id, mcp_server_id, tool_name, scope, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(organization_id, member_id, mcp_server_id, tool_name) DO UPDATE SET
       scope = excluded.scope,
       updated_at = excluded.updated_at`,
  ).run(
    payload.organizationId,
    payload.memberId,
    payload.mcpServerId,
    payload.toolName,
    payload.scope,
    payload.createdAt,
    payload.updatedAt,
  );
  return payload;
}

export function deleteAgentToolAttachment(
  db: DbHandle,
  organizationId: string,
  memberId: string,
  mcpServerId: string,
  toolName: string,
): void {
  db.prepare(
    `DELETE FROM agent_tool_attachments
       WHERE organization_id = ? AND member_id = ?
         AND mcp_server_id = ? AND tool_name = ?`,
  ).run(organizationId, memberId, mcpServerId, toolName);
}

export function listAgentToolAttachments(
  db: DbHandle,
  organizationId: string,
  memberId: string,
  mcpServerId?: string,
): AgentToolAttachment[] {
  const rows = mcpServerId
    ? (db
        .prepare(
          `SELECT * FROM agent_tool_attachments
             WHERE organization_id = ? AND member_id = ? AND mcp_server_id = ?
             ORDER BY tool_name ASC`,
        )
        .all(organizationId, memberId, mcpServerId) as Row[])
    : (db
        .prepare(
          `SELECT * FROM agent_tool_attachments
             WHERE organization_id = ? AND member_id = ?
             ORDER BY mcp_server_id ASC, tool_name ASC`,
        )
        .all(organizationId, memberId) as Row[]);
  return rows.map(rowToAttachment);
}

// Reverse lookup: which agents have this exact tool granted?
export function listAgentsForTool(
  db: DbHandle,
  organizationId: string,
  mcpServerId: string,
  toolName: string,
): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT member_id FROM agent_tool_attachments
         WHERE organization_id = ? AND mcp_server_id = ? AND tool_name = ?
         ORDER BY member_id ASC`,
    )
    .all(organizationId, mcpServerId, toolName) as Row[];
  return rows.map((r) => rowString(r, 'member_id'));
}

// Used by the runtime tool-palette filter to know if the (agent, server)
// pair is in "allowlist mode" (any rows) or "all tools mode" (no rows).
export function countAgentToolAttachments(
  db: DbHandle,
  organizationId: string,
  memberId: string,
  mcpServerId: string,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM agent_tool_attachments
         WHERE organization_id = ? AND member_id = ? AND mcp_server_id = ?`,
    )
    .get(organizationId, memberId, mcpServerId) as { c?: number } | undefined;
  return Number(row?.c ?? 0);
}

export function deleteAgentToolAttachmentsForServer(
  db: DbHandle,
  organizationId: string,
  mcpServerId: string,
): void {
  db.prepare(
    `DELETE FROM agent_tool_attachments
       WHERE organization_id = ? AND mcp_server_id = ?`,
  ).run(organizationId, mcpServerId);
}

export function deleteAgentToolAttachmentsForAgent(
  db: DbHandle,
  organizationId: string,
  memberId: string,
  mcpServerId?: string,
): void {
  if (mcpServerId) {
    db.prepare(
      `DELETE FROM agent_tool_attachments
         WHERE organization_id = ? AND member_id = ? AND mcp_server_id = ?`,
    ).run(organizationId, memberId, mcpServerId);
    return;
  }
  db.prepare(
    `DELETE FROM agent_tool_attachments
       WHERE organization_id = ? AND member_id = ?`,
  ).run(organizationId, memberId);
}
