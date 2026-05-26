import type { AuditRecord } from './types.js';

export interface AuditFilter {
  agents?: string[];
  tools?: string[];
  types?: string[];
  allowed?: boolean;
  sinceMs?: number;
  search?: string;
}

export const EMPTY_AUDIT_FILTER: AuditFilter = {};

export function filterAuditRecords(records: AuditRecord[], filter: AuditFilter): AuditRecord[] {
  const agents = filter.agents?.length ? new Set(filter.agents) : undefined;
  const tools = filter.tools?.length ? new Set(filter.tools) : undefined;
  const types = filter.types?.length ? new Set(filter.types) : undefined;
  const search = filter.search?.trim().toLowerCase();
  const since = filter.sinceMs;

  return records.filter((r) => {
    if (agents && !agents.has(r.agent_id)) return false;
    if (tools && !(r.tool_name ? tools.has(r.tool_name) : false)) return false;
    if (types && !types.has(r.event_type)) return false;
    if (filter.allowed !== undefined && r.allowed !== filter.allowed) return false;
    if (since !== undefined) {
      const ts = Date.parse(r.created_at);
      if (Number.isNaN(ts) || ts < since) return false;
    }
    if (search) {
      const hay = [
        r.event_id,
        r.event_type,
        r.agent_id,
        r.task_id,
        r.tool_name ?? '',
        r.block_reason ?? '',
        stringify(r.tool_input),
        stringify(r.tool_output),
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

export function uniqueAuditAgents(records: AuditRecord[]): string[] {
  return [...new Set(records.map((r) => r.agent_id))].sort();
}

export function uniqueAuditTools(records: AuditRecord[]): string[] {
  return [...new Set(records.map((r) => r.tool_name).filter((n): n is string => !!n))].sort();
}

export function uniqueAuditTypes(records: AuditRecord[]): string[] {
  return [...new Set(records.map((r) => r.event_type))].sort();
}

export function auditToJson(records: AuditRecord[]): string {
  return JSON.stringify(records, null, 2);
}

const CSV_COLUMNS: (keyof AuditRecord)[] = [
  'created_at',
  'event_id',
  'event_type',
  'agent_id',
  'task_id',
  'session_id',
  'tool_name',
  'allowed',
  'block_reason',
  'tokens_used',
  'duration_ms',
];

export function auditToCsv(records: AuditRecord[]): string {
  const rows = [CSV_COLUMNS.join(',')];
  for (const r of records) {
    const row = r as unknown as Record<string, unknown>;
    rows.push(CSV_COLUMNS.map((c) => csvCell(row[c as string])).join(','));
  }
  return rows.join('\n');
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  const s = typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : stringify(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export interface RateSample {
  at: string;
  calls: number;
  tokens: number;
}

export interface RateSeries {
  agentId: string;
  samples: RateSample[];
}

export function callsInLastMinute(samples: RateSample[], nowMs: number = Date.now()): number {
  const cutoff = nowMs - 60_000;
  return samples.reduce((n, s) => (Date.parse(s.at) >= cutoff ? n + s.calls : n), 0);
}

export function bucketSamples(
  samples: RateSample[],
  options: { bucketMs: number; buckets: number; endMs?: number } = { bucketMs: 5_000, buckets: 24 },
): number[] {
  const { bucketMs, buckets } = options;
  const end = options.endMs ?? Date.now();
  const start = end - bucketMs * buckets;
  const out = new Array(buckets).fill(0);
  for (const s of samples) {
    const ts = Date.parse(s.at);
    if (Number.isNaN(ts) || ts < start || ts >= end) continue;
    const idx = Math.floor((ts - start) / bucketMs);
    if (idx >= 0 && idx < buckets) out[idx] += s.calls;
  }
  return out;
}

export interface SessionSummary {
  session_id: string;
  startedAt: string;
  endedAt?: string;
  status: 'running' | 'ended' | 'killed';
  agent_ids: string[];
  task_ids: string[];
  tool_calls: number;
  blocked_calls: number;
}

export function summarizeSession(input: {
  session_id: string;
  startedAt: string;
  endedAt?: string;
  status: SessionSummary['status'];
  agent_ids: string[];
  task_ids: string[];
  audit: AuditRecord[];
}): SessionSummary {
  return {
    session_id: input.session_id,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    status: input.status,
    agent_ids: input.agent_ids,
    task_ids: input.task_ids,
    tool_calls: input.audit.filter((r) => r.event_type === 'tool_call').length,
    blocked_calls: input.audit.filter((r) => !r.allowed).length,
  };
}

function stringify(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
