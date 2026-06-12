import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { AttachmentSchema, type Attachment } from '@ujima/shared';
import { rowString } from './common.js';

type Row = Record<string, unknown>;

function rowToAttachment(row: Row): Attachment {
  return AttachmentSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    filename: rowString(row, 'filename'),
    mimeType: rowString(row, 'mime_type'),
    category: rowString(row, 'category'),
    sizeBytes: Number(row.size_bytes),
    storagePath: rowString(row, 'storage_path'),
    uploadedBy: rowString(row, 'uploaded_by'),
    createdAt: rowString(row, 'created_at'),
  });
}

export function saveAttachment(db: DbHandle, attachment: Attachment): Attachment {
  const payload = AttachmentSchema.parse(attachment);

  db.prepare(
    `INSERT INTO attachments (
      id,
      organization_id,
      filename,
      mime_type,
      category,
      size_bytes,
      storage_path,
      uploaded_by,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.filename,
    payload.mimeType,
    payload.category,
    payload.sizeBytes,
    payload.storagePath,
    payload.uploadedBy,
    payload.createdAt,
  );

  return payload;
}

/**
 * Hard-delete a single attachment row. Used by the agent-attachment
 * resolver's rollback path when a later ref in a batch fails after
 * earlier ones already wrote rows (bot Round 1 medium). Returns the
 * number of rows affected so callers can detect double-deletes.
 */
export function deleteAttachment(
  db: DbHandle,
  organizationId: string,
  attachmentId: string,
): number {
  const info = db
    .prepare(`DELETE FROM attachments WHERE organization_id = ? AND id = ?`)
    .run(organizationId, attachmentId);
  return info.changes ?? 0;
}

export function getAttachment(
  db: DbHandle,
  organizationId: string,
  attachmentId: string,
): Attachment | null {
  const row = db
    .prepare('SELECT * FROM attachments WHERE organization_id = ? AND id = ?')
    .get(organizationId, attachmentId) as Row | null;
  return row ? rowToAttachment(row) : null;
}

export function listMessageAttachments(db: DbHandle, messageId: string): Attachment[] {
  return listMessageAttachmentsForMessageIds(db, [messageId]).get(messageId) ?? [];
}

export function listMessageAttachmentsForMessageIds(
  db: DbHandle,
  messageIds: string[],
): Map<string, Attachment[]> {
  if (messageIds.length === 0) {
    return new Map();
  }

  const placeholders = messageIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT
        ma.message_id,
        ma.sort_order,
        a.*
       FROM message_attachments ma
       JOIN attachments a ON a.id = ma.attachment_id
      WHERE ma.message_id IN (${placeholders})
      ORDER BY ma.message_id ASC, ma.sort_order ASC, ma.attachment_id ASC`,
    )
    .all(...messageIds) as Row[];

  const attachmentsByMessageId = new Map<string, Attachment[]>();
  for (const row of rows) {
    const messageId = rowString(row, 'message_id');
    const attachment = rowToAttachment(row);
    const existing = attachmentsByMessageId.get(messageId);
    if (existing) {
      existing.push(attachment);
    } else {
      attachmentsByMessageId.set(messageId, [attachment]);
    }
  }

  return attachmentsByMessageId;
}

export function linkAttachmentsToMessage(
  db: DbHandle,
  messageId: string,
  attachmentIds: string[],
): void {
  if (attachmentIds.length === 0) {
    return;
  }

  const insert = db.prepare(
    `INSERT INTO message_attachments (message_id, attachment_id, sort_order)
     VALUES (?, ?, ?)`,
  );
  attachmentIds.forEach((attachmentId, sortOrder) => {
    insert.run(messageId, attachmentId, sortOrder);
  });
}
