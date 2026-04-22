import type { UjimaEvent } from '@ujima/shared';
import { nowMs, type DbHandle } from './db';

export interface PendingEventRecord {
  id: string;
  channel: string;
  event: UjimaEvent;
  createdAt: number;
  expiresAt: number;
}

export interface PendingEventStore {
  add(channel: string, event: UjimaEvent, ttlMs?: number): Promise<void>;
  listSince(channel: string, sinceMs: number): Promise<PendingEventRecord[]>;
  listByChannel(channel: string): Promise<PendingEventRecord[]>;
  purgeExpired(): Promise<number>;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function createPendingEventStore(db: DbHandle): PendingEventStore {
  const insert = db.prepare(
    `INSERT INTO pending_events (id, channel, event_payload, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const selectSince = db.prepare(
    `SELECT id, channel, event_payload, created_at, expires_at
       FROM pending_events
      WHERE channel = ? AND created_at >= ? AND expires_at > ?
      ORDER BY created_at ASC`,
  );
  const selectByChannel = db.prepare(
    `SELECT id, channel, event_payload, created_at, expires_at
       FROM pending_events
      WHERE channel = ? AND expires_at > ?
      ORDER BY created_at ASC`,
  );
  const purge = db.prepare('DELETE FROM pending_events WHERE expires_at <= ?');

  const parse = (r: RawPendingRow): PendingEventRecord => ({
    id: r.id,
    channel: r.channel,
    event: JSON.parse(r.event_payload) as UjimaEvent,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  });

  return {
    async add(channel, event, ttlMs = DEFAULT_TTL_MS) {
      const now = nowMs();
      const id = `evt_${Math.random().toString(36).slice(2, 10)}_${now}`;
      insert.run(id, channel, JSON.stringify(event), now, now + ttlMs);
    },
    async listSince(channel, sinceMs) {
      const rows = selectSince.all(channel, sinceMs, nowMs()) as RawPendingRow[];
      return rows.map(parse);
    },
    async listByChannel(channel) {
      const rows = selectByChannel.all(channel, nowMs()) as RawPendingRow[];
      return rows.map(parse);
    },
    async purgeExpired() {
      const result = purge.run(nowMs());
      return Number(result.changes ?? 0);
    },
  };
}

interface RawPendingRow {
  id: string;
  channel: string;
  event_payload: string;
  created_at: number;
  expires_at: number;
}
