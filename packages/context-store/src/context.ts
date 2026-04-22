import type { Database as DbHandle } from 'better-sqlite3';
import { EventEmitter } from 'node:events';
import { nowMs } from './db';

export interface ContextEntry<T = unknown> {
  key: string;
  value: T;
  updatedAt: number;
}

export interface ContextStore {
  put(key: string, value: unknown): Promise<void>;
  get<T = unknown>(key: string): Promise<T | undefined>;
  list(prefix: string): Promise<ContextEntry[]>;
  delete(key: string): Promise<void>;
  subscribe(prefix: string, handler: (entry: ContextEntry) => void | Promise<void>): () => void;
  __flush(): void;
}

export interface ContextStoreDeps {
  db: DbHandle;
  pollingIntervalMs?: number;
}

export function createContextStore(deps: ContextStoreDeps): ContextStore {
  const { db } = deps;
  const pollingIntervalMs = deps.pollingIntervalMs ?? 250;

  const putStmt = db.prepare(
    'INSERT INTO context_entries (key, value, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
  );
  const getStmt = db.prepare('SELECT value FROM context_entries WHERE key = ?');
  const listStmt = db.prepare(
    'SELECT key, value, updated_at FROM context_entries WHERE key LIKE ? ORDER BY key',
  );
  const deleteStmt = db.prepare('DELETE FROM context_entries WHERE key = ?');
  const sinceStmt = db.prepare(
    'SELECT key, value, updated_at FROM context_entries WHERE key LIKE ? AND updated_at > ? ORDER BY updated_at',
  );

  const inProcEmitter = new EventEmitter();
  inProcEmitter.setMaxListeners(500);

  const pollers = new Map<string, { timer: NodeJS.Timeout; lastSeen: number }>();

  function emit(entry: ContextEntry): void {
    inProcEmitter.emit('entry', entry);
  }

  function parseRow(row: { key: string; value: string; updated_at: number }): ContextEntry {
    return { key: row.key, value: JSON.parse(row.value), updatedAt: row.updated_at };
  }

  return {
    async put(key, value) {
      const serialized = JSON.stringify(value);
      const ts = nowMs();
      putStmt.run(key, serialized, ts);
      emit({ key, value, updatedAt: ts });
    },

    async get<T = unknown>(key: string): Promise<T | undefined> {
      const row = getStmt.get(key) as { value: string } | undefined;
      return row ? (JSON.parse(row.value) as T) : undefined;
    },

    async list(prefix) {
      const rows = listStmt.all(`${prefix}%`) as { key: string; value: string; updated_at: number }[];
      return rows.map(parseRow);
    },

    async delete(key) {
      deleteStmt.run(key);
    },

    subscribe(prefix, handler) {
      const likePattern = `${prefix}%`;
      const inProcHandler = (entry: ContextEntry): void => {
        if (entry.key.startsWith(prefix)) {
          void handler(entry);
        }
      };
      inProcEmitter.on('entry', inProcHandler);

      const state = { timer: null as NodeJS.Timeout | null, lastSeen: nowMs() };
      const tick = (): void => {
        const rows = sinceStmt.all(likePattern, state.lastSeen) as {
          key: string;
          value: string;
          updated_at: number;
        }[];
        for (const row of rows) {
          state.lastSeen = Math.max(state.lastSeen, row.updated_at);
          void handler(parseRow(row));
        }
      };
      state.timer = setInterval(tick, pollingIntervalMs);
      state.timer.unref();
      pollers.set(prefix + Math.random(), state as { timer: NodeJS.Timeout; lastSeen: number });

      return () => {
        inProcEmitter.off('entry', inProcHandler);
        if (state.timer) clearInterval(state.timer);
      };
    },

    __flush() {
      for (const [, p] of pollers) {
        if (p.timer) clearInterval(p.timer);
      }
      pollers.clear();
      inProcEmitter.removeAllListeners();
    },
  };
}
