import { nowMs, type DbHandle } from './db';

export type AgentStatus = 'idle' | 'active' | 'waiting' | 'blocked' | 'killed' | 'exited';
export type TaskStatus = 'running' | 'paused' | 'complete' | 'failed';

export interface AgentStateRecord {
  agent_id: string;
  status: AgentStatus;
  last_action?: string;
  last_heartbeat?: number;
  tokens_used: number;
  calls_made: number;
  updated_at: number;
}

export interface TaskStateRecord {
  task_id: string;
  status: TaskStatus;
  started_at: number;
  ended_at?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentStateStore {
  upsert(agent_id: string, patch: Partial<Omit<AgentStateRecord, 'agent_id' | 'updated_at'>>): Promise<void>;
  heartbeat(agent_id: string): Promise<void>;
  incrementTokens(agent_id: string, n: number): Promise<void>;
  incrementCalls(agent_id: string): Promise<void>;
  get(agent_id: string): Promise<AgentStateRecord | undefined>;
  list(): Promise<AgentStateRecord[]>;
}

export interface TaskStateStore {
  start(task_id: string, metadata?: Record<string, unknown>): Promise<void>;
  setStatus(task_id: string, status: TaskStatus): Promise<void>;
  end(task_id: string, status: 'complete' | 'failed'): Promise<void>;
  get(task_id: string): Promise<TaskStateRecord | undefined>;
}

export function createAgentStateStore(db: DbHandle): AgentStateStore {
  const select = db.prepare('SELECT * FROM agent_state WHERE agent_id = ?');
  const insertRow = db.prepare(
    `INSERT INTO agent_state (agent_id, status, last_action, last_heartbeat, tokens_used, calls_made, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, ?)`,
  );
  const updatePatch = db.prepare(
    `UPDATE agent_state SET
       status = COALESCE(?, status),
       last_action = COALESCE(?, last_action),
       last_heartbeat = COALESCE(?, last_heartbeat),
       updated_at = ?
     WHERE agent_id = ?`,
  );
  const exists = db.prepare('SELECT 1 FROM agent_state WHERE agent_id = ?');
  const updateHeartbeat = db.prepare(
    `INSERT INTO agent_state (agent_id, status, last_heartbeat, tokens_used, calls_made, updated_at)
     VALUES (?, 'active', ?, 0, 0, ?)
     ON CONFLICT(agent_id) DO UPDATE SET last_heartbeat = excluded.last_heartbeat, updated_at = excluded.updated_at`,
  );
  const addTokens = db.prepare(
    `INSERT INTO agent_state (agent_id, status, tokens_used, calls_made, updated_at)
     VALUES (?, 'active', ?, 0, ?)
     ON CONFLICT(agent_id) DO UPDATE SET
       tokens_used = agent_state.tokens_used + excluded.tokens_used,
       updated_at = excluded.updated_at`,
  );
  const addCall = db.prepare(
    `INSERT INTO agent_state (agent_id, status, tokens_used, calls_made, updated_at)
     VALUES (?, 'active', 0, 1, ?)
     ON CONFLICT(agent_id) DO UPDATE SET
       calls_made = agent_state.calls_made + 1,
       updated_at = excluded.updated_at`,
  );
  const listAll = db.prepare('SELECT * FROM agent_state ORDER BY agent_id');

  const parse = (r: RawAgentRow): AgentStateRecord => ({
    agent_id: r.agent_id,
    status: r.status as AgentStatus,
    last_action: r.last_action ?? undefined,
    last_heartbeat: r.last_heartbeat ?? undefined,
    tokens_used: r.tokens_used,
    calls_made: r.calls_made,
    updated_at: r.updated_at,
  });

  return {
    async upsert(agent_id, patch) {
      const ts = nowMs();
      if (exists.get(agent_id)) {
        updatePatch.run(
          patch.status ?? null,
          patch.last_action ?? null,
          patch.last_heartbeat ?? null,
          ts,
          agent_id,
        );
      } else {
        insertRow.run(
          agent_id,
          patch.status ?? 'idle',
          patch.last_action ?? null,
          patch.last_heartbeat ?? null,
          ts,
        );
      }
    },
    async heartbeat(agent_id) {
      const ts = nowMs();
      updateHeartbeat.run(agent_id, ts, ts);
    },
    async incrementTokens(agent_id, n) {
      addTokens.run(agent_id, n, nowMs());
    },
    async incrementCalls(agent_id) {
      addCall.run(agent_id, nowMs());
    },
    async get(agent_id) {
      const row = select.get(agent_id) as RawAgentRow | undefined;
      return row ? parse(row) : undefined;
    },
    async list() {
      const rows = listAll.all() as RawAgentRow[];
      return rows.map(parse);
    },
  };
}

export function createTaskStateStore(db: DbHandle): TaskStateStore {
  const select = db.prepare('SELECT * FROM task_state WHERE task_id = ?');
  const start = db.prepare(
    `INSERT INTO task_state (task_id, status, started_at, metadata) VALUES (?, 'running', ?, ?)`,
  );
  const setStatus = db.prepare('UPDATE task_state SET status = ? WHERE task_id = ?');
  const end = db.prepare('UPDATE task_state SET status = ?, ended_at = ? WHERE task_id = ?');

  const parse = (r: RawTaskRow): TaskStateRecord => ({
    task_id: r.task_id,
    status: r.status as TaskStatus,
    started_at: r.started_at,
    ended_at: r.ended_at ?? undefined,
    metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : undefined,
  });

  return {
    async start(task_id, metadata) {
      start.run(task_id, nowMs(), metadata ? JSON.stringify(metadata) : null);
    },
    async setStatus(task_id, status) {
      setStatus.run(status, task_id);
    },
    async end(task_id, status) {
      end.run(status, nowMs(), task_id);
    },
    async get(task_id) {
      const row = select.get(task_id) as RawTaskRow | undefined;
      return row ? parse(row) : undefined;
    },
  };
}

interface RawAgentRow {
  agent_id: string;
  status: string;
  last_action: string | null;
  last_heartbeat: number | null;
  tokens_used: number;
  calls_made: number;
  updated_at: number;
}

interface RawTaskRow {
  task_id: string;
  status: string;
  started_at: number;
  ended_at: number | null;
  metadata: string | null;
}
