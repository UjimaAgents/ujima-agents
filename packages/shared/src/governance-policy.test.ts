import { describe, expect, it } from 'vitest';
import {
  GovernancePolicy,
  buildToolCatalog,
  clearAgent,
  emptyGovernancePolicy,
  emptyRiskDefaults,
  evaluatePolicy,
  matchRule,
  removeAgentRule,
  removePlatformRule,
  setAgentRule,
  setPlatformRule,
  setRiskDefaults,
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

  it('back-compat: omitted classification still returns inherit when defaults are all inherit', () => {
    const r = evaluatePolicy(emptyGovernancePolicy(), {
      agentId: 'a',
      mcpId: 'm',
      toolName: 't',
    });
    // emptyGovernancePolicy() has risk_defaults = inherit for every class,
    // so adding classification handling must not change historical behaviour.
    expect(r.state).toBe('inherit');
  });
});

describe('evaluatePolicy: risk_defaults', () => {
  it('risk_defaults fires after agent rules and platform default', () => {
    let p = emptyGovernancePolicy();
    p = setRiskDefaults(p, { read: 'allow', write: 'require_approval', destructive: 'deny' });
    expect(
      evaluatePolicy(p, {
        agentId: 'a',
        mcpId: 'fs',
        toolName: 'read_file',
        classification: 'read',
      }).state,
    ).toBe('allow');
    expect(
      evaluatePolicy(p, {
        agentId: 'a',
        mcpId: 'fs',
        toolName: 'write_file',
        classification: 'write',
      }).state,
    ).toBe('require_approval');
    expect(
      evaluatePolicy(p, {
        agentId: 'a',
        mcpId: 'fs',
        toolName: 'delete_file',
        classification: 'destructive',
      }).state,
    ).toBe('deny');
  });

  it('agent rule beats risk_default', () => {
    let p = emptyGovernancePolicy();
    p = setRiskDefaults(p, { destructive: 'deny' });
    p = setAgentRule(p, 'trusted', {
      mcp_id: 'fs',
      tool_name: 'delete_file',
      state: 'allow',
    });
    const r = evaluatePolicy(p, {
      agentId: 'trusted',
      mcpId: 'fs',
      toolName: 'delete_file',
      classification: 'destructive',
    });
    expect(r.state).toBe('allow');
    expect(r.source).toBe('agent_rule');
  });

  it('platform require_approval beats risk_default', () => {
    let p = emptyGovernancePolicy();
    p = setRiskDefaults(p, { read: 'allow' });
    p = setPlatformRule(p, 'default_require_approval', {
      mcp_id: 'fs',
      tool_name: 'read_file',
      state: 'require_approval',
    });
    const r = evaluatePolicy(p, {
      agentId: 'a',
      mcpId: 'fs',
      toolName: 'read_file',
      classification: 'read',
    });
    expect(r.state).toBe('require_approval');
    expect(r.source).toBe('platform_require_approval');
  });

  // risk_defaults only applies when `classificationLookup` returns
  // something — including the literal 'unknown'. Built-in tools
  // (channel.*, self.*, view, ls, …) are never classified and surface
  // as `undefined`; treating them as the `unknown` bucket would block
  // standups when admins set `risk_defaults.unknown=require_approval`,
  // even though those built-ins have their own enforcement path.
  it('missing classification on a non-MCP tool falls through (inherit)', () => {
    let p = emptyGovernancePolicy();
    p = setRiskDefaults(p, { unknown: 'require_approval' });
    const r = evaluatePolicy(p, { agentId: 'a', mcpId: 'channels', toolName: 'channel.pass' });
    expect(r.state).toBe('inherit');
    expect(r.source).toBe('default');
  });

  it('explicit classification=unknown also uses the unknown bucket', () => {
    let p = emptyGovernancePolicy();
    p = setRiskDefaults(p, { unknown: 'deny' });
    const r = evaluatePolicy(p, {
      agentId: 'a',
      mcpId: 'm',
      toolName: 't',
      classification: 'unknown',
    });
    expect(r.state).toBe('deny');
  });

  it('class with inherit falls through to legacy', () => {
    const p = emptyGovernancePolicy();
    const r = evaluatePolicy(p, {
      agentId: 'a',
      mcpId: 'm',
      toolName: 't',
      classification: 'read',
    });
    expect(r.state).toBe('inherit');
    expect(r.source).toBe('default');
  });

  it('PolicyEvaluation carries the classification through', () => {
    let p = emptyGovernancePolicy();
    p = setRiskDefaults(p, { destructive: 'deny' });
    const r = evaluatePolicy(p, {
      agentId: 'a',
      mcpId: 'm',
      toolName: 't',
      classification: 'destructive',
    });
    expect(r.classification).toBe('destructive');
  });
});

describe('setRiskDefaults', () => {
  it('merges partial updates', () => {
    let p = emptyGovernancePolicy();
    p = setRiskDefaults(p, { read: 'allow' });
    expect(p.risk_defaults.read).toBe('allow');
    expect(p.risk_defaults.write).toBe('inherit');
    p = setRiskDefaults(p, { write: 'require_approval' });
    expect(p.risk_defaults.read).toBe('allow');
    expect(p.risk_defaults.write).toBe('require_approval');
  });

  it('emptyRiskDefaults returns inherit for every class', () => {
    const d = emptyRiskDefaults();
    expect(d.read).toBe('inherit');
    expect(d.write).toBe('inherit');
    expect(d.destructive).toBe('inherit');
    expect(d.unknown).toBe('inherit');
  });
});

describe('GovernancePolicy schema with risk_defaults', () => {
  it('parses a policy with risk_defaults declared', () => {
    const parsed = GovernancePolicy.parse({
      risk_defaults: { read: 'allow', destructive: 'deny' },
    });
    expect(parsed.risk_defaults.read).toBe('allow');
    expect(parsed.risk_defaults.write).toBe('inherit');
    expect(parsed.risk_defaults.destructive).toBe('deny');
    expect(parsed.risk_defaults.unknown).toBe('inherit');
  });

  it('back-compat: parses an old policy without risk_defaults', () => {
    const parsed = GovernancePolicy.parse({
      version: 1,
      platform: { always_deny: [], default_require_approval: [] },
      agents: {},
    });
    expect(parsed.risk_defaults.read).toBe('inherit');
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
