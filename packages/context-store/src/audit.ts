import type { Database as DbHandle } from 'better-sqlite3';
import type { AuditRecord } from '@ujima/shared';
import { nowMs } from './db';

export type AuditEventType = AuditRecord['event_type'];

export interface AuditWriteInput {
  event_id: string;
  event_type: AuditEventType;
  agent_id: string;
  task_id: string;
  session_id: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  allowed: boolean;
  block_reason?: string;
  tokens_used?: number;
  duration_ms?: number;
}

export interface AuditQuery {
  agentId?: string;
  taskId?: string;
  sessionId?: string;
  eventType?: AuditEventType;
  since?: number;
  until?: number;
  limit?: number;
}

export interface AuditLog {
  write(input: AuditWriteInput): Promise<void>;
  query(q: AuditQuery): Promise<AuditRecord[]>;
  count(q: AuditQuery): Promise<number>;
}

export function createAuditLog(db: DbHandle): AuditLog {
  const insert = db.prepare(
    `INSERT INTO task_audit_events (
       id, event_id, event_type, agent_id, task_id, session_id,
       tool_name, tool_input, tool_output, allowed, block_reason,
       tokens_used, duration_ms, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  function buildWhere(q: AuditQuery): { sql: string; params: (string | number)[] } {
    const conds: string[] = [];
    const params: (string | number)[] = [];
    if (q.agentId) {
      conds.push('agent_id = ?');
      params.push(q.agentId);
    }
    if (q.taskId) {
      conds.push('task_id = ?');
      params.push(q.taskId);
    }
    if (q.sessionId) {
      conds.push('session_id = ?');
      params.push(q.sessionId);
    }
    if (q.eventType) {
      conds.push('event_type = ?');
      params.push(q.eventType);
    }
    if (q.since !== undefined) {
      conds.push('created_at >= ?');
      params.push(q.since);
    }
    if (q.until !== undefined) {
      conds.push('created_at <= ?');
      params.push(q.until);
    }
    return { sql: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
  }

  return {
    async write(input) {
      const id = `aud_${Math.random().toString(36).slice(2, 10)}_${nowMs()}`;
      insert.run(
        id,
        input.event_id,
        input.event_type,
        input.agent_id,
        input.task_id,
        input.session_id,
        input.tool_name ?? null,
        input.tool_input !== undefined ? JSON.stringify(input.tool_input) : null,
        input.tool_output !== undefined ? JSON.stringify(input.tool_output) : null,
        input.allowed ? 1 : 0,
        input.block_reason ?? null,
        input.tokens_used ?? null,
        input.duration_ms ?? null,
        nowMs(),
      );
    },

    async query(q) {
      const { sql: where, params } = buildWhere(q);
      const limit = q.limit ?? 1000;
      const rows = db
        .prepare(
          `SELECT event_id, event_type, agent_id, task_id, session_id, tool_name, tool_input, tool_output,
                  allowed, block_reason, tokens_used, duration_ms, created_at
             FROM task_audit_events ${where} ORDER BY created_at DESC LIMIT ?`,
        )
        .all(...params, limit) as RawAuditRow[];
      return rows.map(parseRow);
    },

    async count(q) {
      const { sql: where, params } = buildWhere(q);
      const row = db
        .prepare(`SELECT COUNT(*) AS c FROM task_audit_events ${where}`)
        .get(...params) as { c: number };
      return row.c;
    },
  };
}

interface RawAuditRow {
  event_id: string;
  event_type: string;
  agent_id: string;
  task_id: string;
  session_id: string;
  tool_name: string | null;
  tool_input: string | null;
  tool_output: string | null;
  allowed: number;
  block_reason: string | null;
  tokens_used: number | null;
  duration_ms: number | null;
  created_at: number;
}

function parseRow(r: RawAuditRow): AuditRecord {
  return {
    event_id: r.event_id,
    event_type: r.event_type as AuditEventType,
    agent_id: r.agent_id,
    task_id: r.task_id,
    session_id: r.session_id,
    tool_name: r.tool_name ?? undefined,
    tool_input: r.tool_input ? JSON.parse(r.tool_input) : undefined,
    tool_output: r.tool_output ? JSON.parse(r.tool_output) : undefined,
    allowed: r.allowed === 1,
    block_reason: r.block_reason ?? undefined,
    tokens_used: r.tokens_used ?? undefined,
    duration_ms: r.duration_ms ?? undefined,
    created_at: new Date(r.created_at).toISOString(),
  };
}