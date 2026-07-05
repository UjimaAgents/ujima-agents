import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import type { WakeReason } from '@ujima/shared';
import { randomUUID } from 'node:crypto';
import { optionalRowString, rowString } from './common.js';

type Row = Record<string, unknown>;

export interface WakeIntentInput {
  organizationId: string;
  threadId: string;
  channelId?: string;
  memberId: string;
  messageId: string;
  messageCreatedAt: string;
  byMemberId: string;
  reason: string;
  wakeReason: WakeReason;
}

export interface WakeIntent extends WakeIntentInput {
  id: string;
  status: 'pending' | 'dispatched' | 'dropped';
  createdAt: string;
  dispatchedAt?: string;
  droppedAt?: string;
}

function rowToWakeIntent(row: Row): WakeIntent {
  return {
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    threadId: rowString(row, 'thread_id'),
    channelId: optionalRowString(row, 'channel_id'),
    memberId: rowString(row, 'member_id'),
    messageId: rowString(row, 'message_id'),
    messageCreatedAt: rowString(row, 'message_created_at'),
    byMemberId: rowString(row, 'by_member_id'),
    reason: rowString(row, 'reason'),
    wakeReason: rowString(row, 'wake_reason') as WakeReason,
    status: rowString(row, 'status') as WakeIntent['status'],
    createdAt: rowString(row, 'created_at'),
    dispatchedAt: optionalRowString(row, 'dispatched_at'),
    droppedAt: optionalRowString(row, 'dropped_at'),
  };
}

export function enqueueWakeIntent(db: DbHandle, input: WakeIntentInput): WakeIntent {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT OR IGNORE INTO wake_intents (
      id, organization_id, thread_id, channel_id, member_id, message_id,
      message_created_at, by_member_id, reason, wake_reason, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(
    id,
    input.organizationId,
    input.threadId,
    input.channelId ?? null,
    input.memberId,
    input.messageId,
    input.messageCreatedAt,
    input.byMemberId,
    input.reason,
    input.wakeReason,
    now,
  );

  const row = db.prepare(
    `SELECT * FROM wake_intents
     WHERE organization_id = ? AND member_id = ? AND message_id = ?`,
  ).get(input.organizationId, input.memberId, input.messageId) as Row | null;
  if (!row) throw new Error('wake intent insert failed');
  return rowToWakeIntent(row);
}

export function listPendingWakeIntents(
  db: DbHandle,
  organizationId: string,
  threadId: string,
): WakeIntent[] {
  const rows = db.prepare(
    `SELECT * FROM wake_intents
     WHERE organization_id = ? AND thread_id = ? AND status = 'pending'
     ORDER BY message_created_at ASC, message_id ASC, created_at ASC, id ASC`,
  ).all(organizationId, threadId) as Row[];
  return rows.map(rowToWakeIntent);
}

export function markWakeIntentDispatched(
  db: DbHandle,
  organizationId: string,
  intentId: string,
): void {
  db.prepare(
    `UPDATE wake_intents
       SET status = 'dispatched', dispatched_at = ?
     WHERE organization_id = ? AND id = ? AND status = 'pending'`,
  ).run(new Date().toISOString(), organizationId, intentId);
}

export function markWakeIntentDropped(
  db: DbHandle,
  organizationId: string,
  intentId: string,
): void {
  db.prepare(
    `UPDATE wake_intents
       SET status = 'dropped', dropped_at = ?
     WHERE organization_id = ? AND id = ? AND status = 'pending'`,
  ).run(new Date().toISOString(), organizationId, intentId);
}

export function clearPendingWakeIntents(
  db: DbHandle,
  organizationId: string,
  threadId: string,
): void {
  db.prepare(
    `UPDATE wake_intents
       SET status = 'dropped', dropped_at = ?
     WHERE organization_id = ? AND thread_id = ? AND status = 'pending'`,
  ).run(new Date().toISOString(), organizationId, threadId);
}

export function hasPendingWakeIntent(
  db: DbHandle,
  organizationId: string,
  memberId: string,
  threadId: string,
  messageId: string,
): boolean {
  const row = db.prepare(
    `SELECT id FROM wake_intents
     WHERE organization_id = ? AND member_id = ? AND thread_id = ? AND message_id = ? AND status = 'pending'
     LIMIT 1`,
  ).get(organizationId, memberId, threadId, messageId) as Row | null;
  return row != null;
}
