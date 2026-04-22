import { describe, expect, it } from 'vitest';
import {
  GovernancePolicy,
  buildToolCatalog,
  clearAgent,
  emptyGovernancePolicy,
  evaluatePolicy,
  matchRule,
  removeAgentRule,
  removePlatformRule,
  setAgentRule,
  setPlatformRule,
} from './governance-policy.js';

describe('governance policy schema', () => {
  it('parses an empty policy object', () => {
    const parsed = GovernancePolicy.parse({});
    expect(parsed.version).toBe(1);
    expect(parsed.platform.always_deny).toEqual([]);
    expect(parsed.platform.default_require_approval).toEqual([]);
    expect(parsed.agents).toEqual({});
  });

  it('parses a fully-formed policy round-trip', () => {
    const input = {
      version: 1 as const,
      platform: {
        always_deny: [{ mcp_id: 'shell', tool_name: 'exec', state: 'deny' as const }],
        default_require_approval: [
          { mcp_id: '*', tool_name: 'write*', state: 'require_approval' as const },
        ],
      },
      agents: {
        'designer-1': [
          {
            mcp_id: 'figma',
            tool_name: 'get_file',
            state: 'allow' as const,
            reason: 'read-only UX',
          },
        ],
      },
    };
    const parsed = GovernancePolicy.parse(input);
    expect(parsed.agents['designer-1']).toHaveLength(1);
    expect(parsed.agents['designer-1']?.[0]?.state).toBe('allow');
  });

  it('rejects unknown states', () => {
    expect(() =>
      GovernancePolicy.parse({
        agents: { a: [{ mcp_id: 'x', tool_name: 'y', state: 'wat' }] },
      }),
    ).toThrow();
  });
});

describe('matchRule', () => {
  it('exact mcp+tool matches', () => {
    expect(
      matchRule(
        { mcp_id: 'fs', tool_name: 'read', state: 'allow' },
        'fs',
        'read',
      ),
    ).toBe(true);
  });

  it('wildcard mcp matches any mcp', () => {
    expect(
      matchRule({ mcp_id: '*', tool_name: 'delete', state: 'deny' }, 'fs', 'delete'),
    ).toBe(true);
  });

  it('wildcard tool matches any tool on that mcp', () => {
    expect(
      matchRule({ mcp_id: 'shell', tool_name: '*', state: 'deny' }, 'shell', 'exec'),
    ).toBe(true);
  });

  it('prefix glob matches tool prefix', () => {
    expect(
      matchRule({ mcp_id: 'fs', tool_name: 'write*', state: 'deny' }, 'fs', 'write_file'),
    ).toBe(true);
    expect(
      matchRule({ mcp_id: 'fs', tool_name: 'write*', state: 'deny' }, 'fs', 'read'),
    ).toBe(false);
  });

  it('different mcp does not match', () => {
    expect(
      matchRule({ mcp_id: 'fs', tool_name: 'read', state: 'allow' }, 'shell', 'read'),
    ).toBe(false);
  });
});

describe('evaluatePolicy precedence', () => {
  it('platform always_deny beats agent allow', () => {
    let p = emptyGovernancePolicy();
    p = setPlatformRule(p, 'always_deny', {
      mcp_id: 'shell',
      tool_name: 'exec',
      state: 'deny',
    });
    p = setAgentRule(p, 'admin', {
      mcp_id: 'shell',
      tool_name: 'exec',
      state: 'allow',
    });
    const r = evaluatePolicy(p, {
      agentId: 'admin',
      mcpId: 'shell',
      toolName: 'exec',
    });
    expect(r.state).toBe('deny');
    expect(r.source).toBe('platform_deny');
  });

  it('agent rule beats platform default_require_approval', () => {
    let p = emptyGovernancePolicy();
    p = setPlatformRule(p, 'default_require_approval', {
      mcp_id: 'fs',
      tool_name: 'write',
      state: 'require_approval',
    });
    p = setAgentRule(p, 'trusted-bot', {
      mcp_id: 'fs',
      tool_name: 'write',
      state: 'allow',
    });
    const r = evaluatePolicy(p, {
      agentId: 'trusted-bot',
      mcpId: 'fs',
      toolName: 'write',
    });
    expect(r.state).toBe('allow');
    expect(r.source).toBe('agent_rule');
  });

  it('platform default_require_approval applies when no agent rule', () => {
    let p = emptyGovernancePolicy();
    p = setPlatformRule(p, 'default_require_approval', {
      mcp_id: '*',
      tool_name: 'delete',
      state: 'require_approval',
    });
    const r = evaluatePolicy(p, {
      agentId: 'any',
      mcpId: 'fs',
      toolName: 'delete',
    });
    expect(r.state).toBe('require_approval');
    expect(r.source).toBe('platform_require_approval');
  });

  it('exact agent rule beats wildcard agent rule', () => {
    let p = emptyGovernancePolicy();
    p = setAgentRule(p, 'a1', {
      mcp_id: '*',
      tool_name: '*',
      state: 'deny',
    });
    p = setAgentRule(p, 'a1', {
      mcp_id: 'fs',
      tool_name: 'read',
      state: 'allow',
    });
    const read = evaluatePolicy(p, {
      agentId: 'a1',
      mcpId: 'fs',
      toolName: 'read',
    });
    expect(read.state).toBe('allow');
    const other = evaluatePolicy(p, {
      agentId: 'a1',
      mcpId: 'fs',
      toolName: 'write',
    });
    expect(other.state).toBe('deny');
  });

  it('inherit rule falls through to platform default', () => {
    let p = emptyGovernancePolicy();
    p = setPlatformRule(p, 'default_require_approval', {
      mcp_id: 'fs',
      tool_name: 'write',
      state: 'require_approval',
    });
    p = setAgentRule(p, 'a1', {
      mcp_id: 'fs',
      tool_name: 'write',
      state: 'inherit',
    });
    const r = evaluatePolicy(p, {
      agentId: 'a1',
      mcpId: 'fs',
      toolName: 'write',
    });
    expect(r.state).toBe('require_approval');
    expect(r.source).toBe('platform_require_approval');
  });

  it('empty policy returns inherit/default', () => {
    const r = evaluatePolicy(emptyGovernancePolicy(), {
      agentId: 'a',
      mcpId: 'm',
      toolName: 't',
    });
    expect(r.state).toBe('inherit');
    expect(r.source).toBe('default');
  });
});

describe('policy mutators', () => {
  it('setAgentRule replaces an existing rule for the same mcp+tool', () => {
    let p = emptyGovernancePolicy();
    p = setAgentRule(p, 'a', {
      mcp_id: 'fs',
      tool_name: 'read',
      state: 'deny',
    });
    p = setAgentRule(p, 'a', {
      mcp_id: 'fs',
      tool_name: 'read',
      state: 'allow',
    });
    expect(p.agents['a']).toHaveLength(1);
    expect(p.agents['a']?.[0]?.state).toBe('allow');
  });

  it('removeAgentRule drops only that rule and clears the agent key when empty', () => {
    let p = emptyGovernancePolicy();
    p = setAgentRule(p, 'a', { mcp_id: 'fs', tool_name: 'r', state: 'deny' });
    p = setAgentRule(p, 'a', { mcp_id: 'fs', tool_name: 'w', state: 'deny' });
    p = removeAgentRule(p, 'a', 'fs', 'r');
    expect(p.agents['a']).toHaveLength(1);
    p = removeAgentRule(p, 'a', 'fs', 'w');
    expect(p.agents['a']).toBeUndefined();
  });

  it('clearAgent wipes all rules for an agent', () => {
    let p = emptyGovernancePolicy();
    p = setAgentRule(p, 'a', { mcp_id: 'fs', tool_name: 'r', state: 'deny' });
    p = setAgentRule(p, 'a', { mcp_id: 'shell', tool_name: 'exec', state: 'deny' });
    p = clearAgent(p, 'a');
    expect(p.agents['a']).toBeUndefined();
  });

  it('removePlatformRule only affects the named bucket', () => {
    let p = emptyGovernancePolicy();
    p = setPlatformRule(p, 'always_deny', {
      mcp_id: 'shell',
      tool_name: 'exec',
      state: 'deny',
    });
    p = setPlatformRule(p, 'default_require_approval', {
      mcp_id: 'shell',
      tool_name: 'exec',
      state: 'require_approval',
    });
    p = removePlatformRule(p, 'always_deny', 'shell', 'exec');
    expect(p.platform.always_deny).toHaveLength(0);
    expect(p.platform.default_require_approval).toHaveLength(1);
  });

  it('mutators are pure — they return a new policy', () => {
    const a = emptyGovernancePolicy();
    const b = setAgentRule(a, 'x', {
      mcp_id: 'fs',
      tool_name: 'read',
      state: 'allow',
    });
    expect(a.agents['x']).toBeUndefined();
    expect(b.agents['x']).toHaveLength(1);
  });
});

describe('buildToolCatalog', () => {
  it('joins agents, mcps and tools into a flat sorted catalog', () => {
    const catalog = buildToolCatalog({
      agents: [
        { id: 'designer-1', mcp: 'figma' },
        { id: 'engineer-1', mcp: 'fs' },
        { id: 'engineer-2', mcp: 'fs' },
      ],
      mcps: [
        {
          id: 'fs',
          name: 'Filesystem',
          tools: [
            { name: 'read_file', description: 'read' },
            { name: 'write_file' },
          ],
          destructiveTools: ['write_file'],
        },
        {
          id: 'figma',
          name: 'Figma',
          tools: [{ name: 'get_file' }],
        },
      ],
    });
    expect(catalog.map((e) => `${e.mcp_id}:${e.tool_name}`)).toEqual([
      'figma:get_file',
      'fs:read_file',
      'fs:write_file',
    ]);
    const write = catalog.find((e) => e.tool_name === 'write_file');
    expect(write?.destructive).toBe(true);
    expect(write?.agents).toEqual(['engineer-1', 'engineer-2']);
  });
});
