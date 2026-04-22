import { describe, expect, it } from 'vitest';
import type { AgentDef } from '@ujima/shared';
import { matchesEscalation } from './escalation';

function mkAgent(conditions: string[]): AgentDef {
  return {
    id: 'a',
    name: 'A',
    persona: '',
    model: 'mock',
    mcp: 'fake',
    permissions: {
      allowed_tools: [],
      blocked_tools: [],
      rate_limit: { calls_per_minute: 10, max_session_tokens: 1000 },
    },
    communication: { publishes: [], subscribes: [] },
    escalation: { conditions, escalate_to: 'human' },
  };
}

describe('matchesEscalation', () => {
  it('returns no match when no conditions are defined', () => {
    expect(matchesEscalation(mkAgent([]), 'I finished the task')).toEqual({ matched: false });
  });

  it('matches a keyword condition case-insensitively', () => {
    const res = matchesEscalation(mkAgent(['requires approval']), 'This change REQUIRES APPROVAL from a senior.');
    expect(res.matched).toBe(true);
    expect(res.condition).toBe('requires approval');
  });

  it('supports regex conditions delimited with slashes', () => {
    const res = matchesEscalation(mkAgent(['/schema\\s+change/']), 'Proposing a schema change');
    expect(res.matched).toBe(true);
  });

  it('does not match unrelated text', () => {
    expect(matchesEscalation(mkAgent(['destructive']), 'all good')).toEqual({ matched: false });
  });
});
