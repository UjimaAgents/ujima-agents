import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { rowString } from './common.js';

export interface NotificationChannelRow {
  id: string;
  organizationId: string;
  provider: 'telegram' | 'whatsapp' | 'webhook';
  configJson: string;
  enabled: boolean;
  notifyMessages: boolean;
  notifyApprovals: boolean;
  createdAt: string;
  updatedAt: string;
}

function rowToChannel(row: Record<string, unknown>): NotificationChannelRow {
  return {
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    provider: rowString(row, 'provider') as NotificationChannelRow['provider'],
    configJson: rowString(row, 'config_json'),
    enabled: Number(row.enabled) === 1,
    notifyMessages: Number(row.notify_messages) === 1,
    notifyApprovals: Number(row.notify_approvals) === 1,
    createdAt: rowString(row, 'created_at'),
    updatedAt: rowString(row, 'updated_at'),
  };
}

export function listNotificationChannels(db: DbHandle, organizationId: string): NotificationChannelRow[] {
  const rows = db.prepare('SELECT * FROM notification_channels WHERE organization_id = ? ORDER BY created_at ASC').all(organizationId) as Record<string, unknown>[];
  return rows.map(rowToChannel);
}

export function getNotificationChannel(db: DbHandle, organizationId: string, channelId: string): NotificationChannelRow | null {
  const row = db.prepare('SELECT * FROM notification_channels WHERE id = ? AND organization_id = ?').get(channelId, organizationId) as Record<string, unknown> | null;
  return row ? rowToChannel(row) : null;
}

export function saveNotificationChannel(db: DbHandle, channel: NotificationChannelRow): void {
  db.prepare(`INSERT INTO notification_channels (id, organization_id, provider, config_json, enabled, notify_messages, notify_approvals, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, config_json = excluded.config_json, enabled = excluded.enabled, notify_messages = excluded.notify_messages, notify_approvals = excluded.notify_approvals, updated_at = excluded.updated_at`).run(
    channel.id, channel.organizationId, channel.provider, channel.configJson,
    channel.enabled ? 1 : 0, channel.notifyMessages ? 1 : 0, channel.notifyApprovals ? 1 : 0,
    channel.createdAt, channel.updatedAt,
  );
}

export function deleteNotificationChannel(db: DbHandle, organizationId: string, channelId: string): void {
  db.prepare('DELETE FROM notification_channels WHERE id = ? AND organization_id = ?').run(channelId, organizationId);
}
