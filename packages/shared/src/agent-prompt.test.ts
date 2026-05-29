import { describe, expect, it } from 'vitest';
import { SHARED_AGENT_SYSTEM_PROMPT, buildTeamHierarchySection } from './agent-prompt.js';

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
          rate_limit: { max_session_tokens: 100_000 },
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
          rate_limit: { max_session_tokens: 100_000 },
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
          rate_limit: { max_session_tokens: 100_000 },
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

describe('SHARED_AGENT_SYSTEM_PROMPT', () => {
  it('treats compacted summaries as owned continuity, not a fresh slate', () => {
    expect(SHARED_AGENT_SYSTEM_PROMPT).toContain('Treat compacted summaries and memory.recall database entries as your own working memory across turns and threads.');
    expect(SHARED_AGENT_SYSTEM_PROMPT).toContain('Each run continues from the session\'s continuity:');
    expect(SHARED_AGENT_SYSTEM_PROMPT).not.toContain('fresh context window');
  });
});
