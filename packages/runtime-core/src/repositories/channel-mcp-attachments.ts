import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import {
  ChannelMcpAttachmentSchema,
  type ChannelMcpAttachment,
} from '@ujima/shared';
import { rowString } from './common.js';

/**
 * Repository surface for `channel_mcp_attachments`
 * (mcp_connector_dispatch_plan.md §17.5 / PR 10).
 *
 * Channel-scoped MCP attachment — every agent who is a member of the
 * channel inherits these attachments as part of their effective set
 * via the §17.5.3 union step inside V2 spawn. This module is the
 * SQL surface only; the union/dedup lives in
 * `services/connector-spawn-v2.ts`.
 *
 * Same writer shape as `agent_mcp_attachments` (UPSERT on the natural
 * key) so a noop re-attach doesn't churn `created_at`. The natural
 * key for channels is (organization_id, channel_id, mcp_server_id).
 */

type Row = Record<string, unknown>;

function rowToAttachment(row: Row): ChannelMcpAttachment {
  const tier = row.tier;
  return ChannelMcpAttachmentSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    channelId: rowString(row, 'channel_id'),
    mcpServerId: rowString(row, 'mcp_server_id'),
    scope: rowString(row, 'scope'),
    ...(typeof tier === 'string' ? { tier } : {}),
    createdAt: rowString(row, 'created_at'),
    updatedAt: rowString(row, 'updated_at'),
  });
}

export function saveChannelMcpAttachment(
  db: DbHandle,
  attachment: ChannelMcpAttachment,
): ChannelMcpAttachment {
  const payload = ChannelMcpAttachmentSchema.parse(attachment);
  db.prepare(
    `INSERT INTO channel_mcp_attachments (
       id, organization_id, channel_id, mcp_server_id, scope, tier, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(organization_id, channel_id, mcp_server_id) DO UPDATE SET
       scope = excluded.scope,
       tier = excluded.tier,
       updated_at = excluded.updated_at`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.channelId,
    payload.mcpServerId,
    payload.scope,
    payload.tier,
    payload.createdAt,
    payload.updatedAt,
  );
  return payload;
}

// Tier-only update so the channels-subtab tier toggle can promote /
// demote without rewriting scope or createdAt. Returns the resulting
// row (or null if no matching attachment exists) so callers can
// audit-log the transition without an extra read — mirrors the
// updateAttachmentTier shape from PR 6's agent-side path.
export function updateChannelAttachmentTier(
  db: DbHandle,
  organizationId: string,
  channelId: string,
  mcpServerId: string,
  tier: ChannelMcpAttachment['tier'],
  updatedAt: string,
): ChannelMcpAttachment | null {
  ChannelMcpAttachmentSchema.shape.tier.parse(tier);
  const result = db
    .prepare(
      `UPDATE channel_mcp_attachments
         SET tier = ?, updated_at = ?
         WHERE organization_id = ? AND channel_id = ? AND mcp_server_id = ?`,
    )
    .run(tier, updatedAt, organizationId, channelId, mcpServerId);
  if (result.changes === 0) return null;
  const row = db
    .prepare(
      `SELECT * FROM channel_mcp_attachments
         WHERE organization_id = ? AND channel_id = ? AND mcp_server_id = ?`,
    )
    .get(organizationId, channelId, mcpServerId) as Row | undefined;
  return row ? rowToAttachment(row) : null;
}

export function deleteChannelMcpAttachment(
  db: DbHandle,
  organizationId: string,
  channelId: string,
  mcpServerId: string,
): void {
  db.prepare(
    `DELETE FROM channel_mcp_attachments
       WHERE organization_id = ? AND channel_id = ? AND mcp_server_id = ?`,
  ).run(organizationId, channelId, mcpServerId);
}

export function listChannelMcpAttachments(
  db: DbHandle,
  organizationId: string,
  channelId: string,
): ChannelMcpAttachment[] {
  const rows = db
    .prepare(
      `SELECT * FROM channel_mcp_attachments
         WHERE organization_id = ? AND channel_id = ?
         ORDER BY created_at ASC`,
    )
    .all(organizationId, channelId) as Row[];
  return rows.map(rowToAttachment);
}

// The hot path for the §17.5.3 union step: V2 spawn needs every
// channel attachment for every channel the spawning agent is a
// member of. Joining channels (which carries organization_id) →
// channel_members → channel_mcp_attachments in a single query
// avoids a round-trip per channel and keeps the effective-set
// computation O(N=attachments) instead of O(channels × attachments).
//
// channel_members has only (channel_id, member_id) — the org scope
// comes via the channels table. The query still filters
// channel_mcp_attachments by org explicitly so a member who somehow
// references a channel from another org doesn't leak attachments.
export function listChannelMcpAttachmentsForMember(
  db: DbHandle,
  organizationId: string,
  memberId: string,
): ChannelMcpAttachment[] {
  const rows = db
    .prepare(
      `SELECT a.*
         FROM channel_mcp_attachments a
         INNER JOIN channels c ON c.id = a.channel_id
         INNER JOIN channel_members cm
           ON cm.channel_id = c.id
        WHERE a.organization_id = ?
          AND c.organization_id = ?
          AND cm.member_id = ?
        ORDER BY a.created_at ASC`,
    )
    .all(organizationId, organizationId, memberId) as Row[];
  return rows.map(rowToAttachment);
}
