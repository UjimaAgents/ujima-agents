import { describe, expect, it } from 'vitest';
import { buildTeamHierarchySection } from './agent-prompt.js';

describe('buildTeamHierarchySection', () => {
  it('keeps mid-level managers in the rendered hierarchy', () => {
    const section = buildTeamHierarchySection([
      {
        id: 'ceo',
        name: 'CEO',
        persona: 'Leads the company.',
        model: 'm',
        mcp: 'mcp',
        permissions: {
          allowed_tools: [],
          blocked_tools: [],
          rate_limit: { calls_per_minute: 30, max_session_tokens: 100_000 },
        },
        communication: { publishes: [], subscribes: [] },
        escalation: { conditions: [], escalate_to: 'human' },
      },
      {
        id: 'lead',
        name: 'Lead',
        persona: 'Manages the team.',
        model: 'm',
        mcp: 'mcp',
        reports_to: 'ceo',
        permissions: {
          allowed_tools: [],
          blocked_tools: [],
          rate_limit: { calls_per_minute: 30, max_session_tokens: 100_000 },
        },
        communication: { publishes: [], subscribes: [] },
        escalation: { conditions: [], escalate_to: 'human' },
      },
      {
        id: 'ic',
        name: 'IC',
        persona: 'Builds things.',
        model: 'm',
        mcp: 'mcp',
        reports_to: 'lead',
        permissions: {
          allowed_tools: [],
          blocked_tools: [],
          rate_limit: { calls_per_minute: 30, max_session_tokens: 100_000 },
        },
        communication: { publishes: [], subscribes: [] },
        escalation: { conditions: [], escalate_to: 'human' },
      },
    ]);

    expect(section).toContain('**CEO**');
    expect(section).toContain('**Lead**');
    expect(section).toContain('**IC**');
    expect(section.indexOf('**CEO**')).toBeLessThan(section.indexOf('**Lead**'));
    expect(section.indexOf('**Lead**')).toBeLessThan(section.indexOf('**IC**'));
  });
});
