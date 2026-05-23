import { describe, expect, it } from 'vitest';
import {
  auditToCsv,
  auditToJson,
  bucketSamples,
  callsInLastMinute,
  filterAuditRecords,
  summarizeSession,
  uniqueAuditAgents,
  uniqueAuditTools,
  uniqueAuditTypes,
  type AuditFilter,
} from './governance';
import type { AuditRecord } from './types';

function rec(partial: Partial<AuditRecord>): AuditRecord {
  return {
    event_id: 'e1',
    event_type: 'tool_call',
    agent_id: 'a1',
    task_id: 't1',
    session_id: 's1',
    allowed: true,
    created_at: new Date(0).toISOString(),
    ...partial,
  };
}

describe('filterAuditRecords', () => {
  const records: AuditRecord[] = [
    rec({ event_id: 'e1', agent_id: 'a1', tool_name: 'get_file', event_type: 'tool_call' }),
    rec({ event_id: 'e2', agent_id: 'a1', tool_name: 'delete_node', event_type: 'tool_call', allowed: false, block_reason: 'destructive' }),
    rec({ event_id: 'e3', agent_id: 'a2', tool_name: 'get_file', event_type: 'permission_check' }),
    rec({ event_id: 'e4', agent_id: 'a2', event_type: 'spawn' }),
  ];

  it('filters by agent', () => {
    const out = filterAuditRecords(records, { agents: ['a1'] });
    expect(out.map((r) => r.event_id)).toEqual(['e1', 'e2']);
  });

  it('filters by tool', () => {
    const out = filterAuditRecords(records, { tools: ['get_file'] });
    expect(out.map((r) => r.event_id)).toEqual(['e1', 'e3']);
  });

  it('filters by event type', () => {
    const out = filterAuditRecords(records, { types: ['spawn'] });
    expect(out.map((r) => r.event_id)).toEqual(['e4']);
  });

  it('filters by allowed=false (blocked only)', () => {
    const out = filterAuditRecords(records, { allowed: false });
    expect(out.map((r) => r.event_id)).toEqual(['e2']);
  });

  it('search hits block_reason', () => {
    const filter: AuditFilter = { search: 'destructive' };
    expect(filterAuditRecords(records, filter).map((r) => r.event_id)).toEqual(['e2']);
  });
});

describe('audit unique helpers', () => {
  const records: AuditRecord[] = [
    rec({ agent_id: 'a1', tool_name: 'x', event_type: 'tool_call' }),
    rec({ agent_id: 'a2', tool_name: 'y', event_type: 'permission_check' }),
    rec({ agent_id: 'a1', event_type: 'spawn' }),
  ];

  it('returns unique sorted agents/tools/types', () => {
    expect(uniqueAuditAgents(records)).toEqual(['a1', 'a2']);
    expect(uniqueAuditTools(records)).toEqual(['x', 'y']);
    expect(uniqueAuditTypes(records)).toEqual(['permission_check', 'spawn', 'tool_call']);
  });
});

describe('audit export', () => {
  const records: AuditRecord[] = [
    rec({ event_id: 'e1', tool_name: 'get_file', tokens_used: 12 }),
    rec({ event_id: 'e2', allowed: false, block_reason: 'has "quotes", and comma' }),
  ];

  it('auditToJson round-trips', () => {
    const parsed = JSON.parse(auditToJson(records)) as AuditRecord[];
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.event_id).toBe('e1');
  });

  it('auditToCsv escapes quotes + commas', () => {
    const csv = auditToCsv(records);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('event_id');
    expect(lines[0]).toContain('block_reason');
    expect(lines[2]).toContain('"has ""quotes"", and comma"');
  });
});

describe('activity aggregation', () => {
  it('sums calls within 60s window', () => {
    const now = Date.now();
    const samples = [
      { at: new Date(now - 30_000).toISOString(), calls: 2, tokens: 0 },
      { at: new Date(now - 45_000).toISOString(), calls: 3, tokens: 0 },
      { at: new Date(now - 120_000).toISOString(), calls: 100, tokens: 0 },
    ];
    expect(callsInLastMinute(samples, now)).toBe(5);
  });

  it('bucketSamples distributes by timestamp', () => {
    const end = 100_000;
    const samples = [
      { at: new Date(end - 2_500).toISOString(), calls: 1, tokens: 0 },
      { at: new Date(end - 2_000).toISOString(), calls: 2, tokens: 0 },
      { at: new Date(end - 7_500).toISOString(), calls: 3, tokens: 0 },
    ];
    const buckets = bucketSamples(samples, { bucketMs: 5_000, buckets: 4, endMs: end });
    expect(buckets).toHaveLength(4);
    expect(buckets[3]).toBe(3); // 0-5s back
    expect(buckets[2]).toBe(3); // 5-10s back
  });
});

describe('summarizeSession', () => {
  it('counts tool calls and blocked calls', () => {
    const audit: AuditRecord[] = [
      rec({ event_type: 'tool_call', allowed: true }),
      rec({ event_type: 'tool_call', allowed: false }),
      rec({ event_type: 'spawn', allowed: true }),
    ];
    const s = summarizeSession({
      session_id: 's1',
      startedAt: new Date(0).toISOString(),
      status: 'ended',
      agent_ids: ['a1'],
      task_ids: ['t1'],
      audit,
    });
    expect(s.tool_calls).toBe(2);
    expect(s.blocked_calls).toBe(1);
  });
});
