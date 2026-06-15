import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import {
  AgentAttachmentSchema,
  type AgentAttachment,
} from '@ujima/shared';
import { rowString, optionalRowString } from './common.js';

type Row = Record<string, unknown>;

function rowToAgentAttachment(row: Row): AgentAttachment {
  return AgentAttachmentSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    runId: rowString(row, 'run_id'),
    memberId: rowString(row, 'member_id'),
    sourceToolCallId: optionalRowString(row, 'source_tool_call_id') ?? null,
    sourceServerId: optionalRowString(row, 'source_server_id') ?? null,
    sourceToolName: optionalRowString(row, 'source_tool_name') ?? null,
    category: rowString(row, 'category'),
    mimeType: rowString(row, 'mime_type'),
    filename: rowString(row, 'filename'),
    storagePath: rowString(row, 'storage_path'),
    byteSize: Number(row.byte_size ?? 0),
    createdAt: rowString(row, 'created_at'),
    pinnedToMessageId: optionalRowString(row, 'pinned_to_message_id') ?? null,
  });
}

export function saveAgentAttachment(
  db: DbHandle,
  attachment: AgentAttachment,
): AgentAttachment {
  const payload = AgentAttachmentSchema.parse(attachment);
  db.prepare(
    `INSERT INTO agent_attachments
       (id, organization_id, run_id, member_id, source_tool_call_id,
        source_server_id, source_tool_name, category, mime_type,
        filename, storage_path, byte_size, created_at, pinned_to_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.runId,
    payload.memberId,
    payload.sourceToolCallId,
    payload.sourceServerId,
    payload.sourceToolName,
    payload.category,
    payload.mimeType,
    payload.filename,
    payload.storagePath,
    payload.byteSize,
    payload.createdAt,
    payload.pinnedToMessageId,
  );
  return payload;
}

export function getAgentAttachment(
  db: DbHandle,
  organizationId: string,
  id: string,
): AgentAttachment | null {
  const row = db
    .prepare(
      `SELECT * FROM agent_attachments WHERE organization_id = ? AND id = ?`,
    )
    .get(organizationId, id) as Row | undefined;
  return row ? rowToAgentAttachment(row) : null;
}

/**
 * Resolve a tool-result-captured agent_attachment by the tool_call_id
 * the daemon wrote at capture time. The ref shape the agent passes to
 * channel.reply is `tc_<toolCallId>:<index>`; this method returns the
 * Nth row for that tool call (most MCPs produce 0-1 attachments per
 * call, but we support multiples for completeness).
 */
export function findAgentAttachmentByToolCall(
  db: DbHandle,
  organizationId: string,
  toolCallId: string,
  index: number,
): AgentAttachment | null {
  const rows = db
    .prepare(
      `SELECT * FROM agent_attachments
         WHERE organization_id = ? AND source_tool_call_id = ?
         ORDER BY created_at ASC, id ASC`,
    )
    .all(organizationId, toolCallId) as Row[];
  const row = rows[index];
  return row ? rowToAgentAttachment(row) : null;
}

/**
 * Pin an attachment to a message so it survives the LRU cleanup.
 * Returns the updated row. Idempotent — re-pinning to the same
 * message id is a no-op write.
 */
export function pinAgentAttachmentToMessage(
  db: DbHandle,
  organizationId: string,
  id: string,
  messageId: string,
): AgentAttachment | null {
  db.prepare(
    `UPDATE agent_attachments
       SET pinned_to_message_id = ?
       WHERE organization_id = ? AND id = ?`,
  ).run(messageId, organizationId, id);
  return getAgentAttachment(db, organizationId, id);
}

export function listAgentAttachmentsForRun(
  db: DbHandle,
  organizationId: string,
  runId: string,
): AgentAttachment[] {
  const rows = db
    .prepare(
      `SELECT * FROM agent_attachments
         WHERE organization_id = ? AND run_id = ?
         ORDER BY created_at ASC`,
    )
    .all(organizationId, runId) as Row[];
  return rows.map(rowToAgentAttachment);
}

/**
 * The LRU cleanup query. Returns the unpinned rows older than the
 * cutoff so the caller can delete the files from disk + then the rows.
 * Two-step delete (files first, then rows) keeps the invariant: the
 * row exists only when the file exists. A crash between the two
 * leaves a row pointing at a missing file, which is the same shape
 * as a transient FS failure — recoverable.
 */
export function listExpiredUnpinnedAgentAttachments(
  db: DbHandle,
  organizationId: string,
  createdBefore: string,
): AgentAttachment[] {
  const rows = db
    .prepare(
      `SELECT * FROM agent_attachments
         WHERE organization_id = ?
           AND pinned_to_message_id IS NULL
           AND created_at < ?`,
    )
    .all(organizationId, createdBefore) as Row[];
  return rows.map(rowToAgentAttachment);
}

export function deleteAgentAttachment(
  db: DbHandle,
  organizationId: string,
  id: string,
): void {
  db.prepare(
    `DELETE FROM agent_attachments WHERE organization_id = ? AND id = ?`,
  ).run(organizationId, id);
}

/**
 * Sum byte_size across all rows for an org. Used by the quota check
 * before accepting a new capture — when the result + the new file's
 * bytes would exceed the configured quota, the cleanup runs first and
 * the capture is dropped if it still wouldn't fit.
 */
export function sumAgentAttachmentBytes(
  db: DbHandle,
  organizationId: string,
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(byte_size), 0) AS total
         FROM agent_attachments WHERE organization_id = ?`,
    )
    .get(organizationId) as { total: number } | undefined;
  return row ? Number(row.total) : 0;
}
