import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { MessageMentionSchema, type MessageMention } from '@ujima/shared';
import { now, rowString, optionalRowString } from './common.js';

type Row = Record<string, unknown>;

export function replaceMessageMentions(
  db: DbHandle,
  messageId: string,
  mentions: MessageMention[],
): MessageMention[] {
  db.prepare('DELETE FROM message_mentions WHERE message_id = ?').run(messageId);
  const insert = db.prepare(
    `INSERT INTO message_mentions (id, message_id, member_id, kind, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const saved: MessageMention[] = [];
  for (const mention of mentions) {
    const payload = MessageMentionSchema.parse({
      ...mention,
      createdAt: mention.createdAt ?? now(),
    });
    insert.run(
      payload.id,
      payload.messageId,
      payload.memberId,
      payload.kind,
      payload.createdAt ?? now(),
    );
    saved.push(payload);
  }

  return saved;
}

export function listMessageMentions(
  db: DbHandle,
  messageId: string,
): MessageMention[] {
  const rows = db
    .prepare('SELECT * FROM message_mentions WHERE message_id = ? ORDER BY created_at ASC, id ASC')
    .all(messageId) as Row[];

  return rows.map(rowToMessageMention);
}

export function deleteMessageMentions(
  db: DbHandle,
  messageId: string,
): void {
  db.prepare('DELETE FROM message_mentions WHERE message_id = ?').run(messageId);
}

function rowToMessageMention(row: Row): MessageMention {
  return MessageMentionSchema.parse({
    id: rowString(row, 'id'),
    messageId: rowString(row, 'message_id'),
    memberId: rowString(row, 'member_id'),
    kind: rowString(row, 'kind'),
    createdAt: optionalRowString(row, 'created_at'),
  });
}
