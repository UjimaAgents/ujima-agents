import { describe, expect, it } from 'vitest';
import { UJIMA_VERSION, AgentDef } from './index';

describe('@ujima/shared smoke', () => {
  it('exports a version string', () => {
    expect(UJIMA_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('validates an AgentDef', () => {
    const parsed = AgentDef.parse({
      id: 'agent-1',
      name: 'Test Agent',
      persona: 'You are a test agent.',
      model: 'vscode-lm',
      mcp: 'filesystem',
      permissions: { allowed_tools: ['read'], blocked_tools: [] },
    });
    expect(parsed.id).toBe('agent-1');
    expect(parsed.permissions.rate_limit.max_session_tokens).toBe(100_000);
  });
});
