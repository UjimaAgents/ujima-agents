import { describe, expect, it } from 'vitest';
import {
  auditToJson,
  callsInLastMinute,
  filterAuditRecords,
  summarizeSession,
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
