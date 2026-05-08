import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { now } from './common.js';

type Row = Record<string, unknown>;

export interface ConversationReadRecord {
  organization_id: string;
  member_id: string;
  thread_id: string;
  last_read_at: string;
}

export function saveConversationRead(
  db: DbHandle,
  input: {
    organizationId: string;
    memberId: string;
    threadId: string;
    lastReadAt?: string;
  },
): ConversationReadRecord {
  const lastReadAt = input.lastReadAt ?? now();
  db.prepare(
    `INSERT INTO conversation_reads (organization_id, member_id, thread_id, last_read_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(organization_id, member_id, thread_id) DO UPDATE SET
       last_read_at = excluded.last_read_at`,
  ).run(input.organizationId, input.memberId, input.threadId, lastReadAt);
  return {
    organization_id: input.organizationId,
    member_id: input.memberId,
    thread_id: input.threadId,
    last_read_at: lastReadAt,
  };
}

export function getConversationRead(
  db: DbHandle,
  organizationId: string,
  memberId: string,
  threadId: string,
): ConversationReadRecord | null {
  const row = db
    .prepare(
      'SELECT * FROM conversation_reads WHERE organization_id = ? AND member_id = ? AND thread_id = ?',
    )
    .get(organizationId, memberId, threadId) as Row | null;
  if (!row) return null;
  return {
    organization_id: String(row.organization_id),
    member_id: String(row.member_id),
    thread_id: String(row.thread_id),
    last_read_at: String(row.last_read_at),
  };
}
