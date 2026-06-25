import { describe, expect, it } from 'vitest';
import {
  GovernancePolicy,
  buildToolCatalog,
  emptyGovernancePolicy,
  evaluatePolicy,
  matchRule,
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

  // risk_defaults only applies when `classificationLookup` returns
  // something — including the literal 'unknown'. Built-in tools
  // (channel.*, self.*, view, ls, …) are never classified and surface
  // as `undefined`; treating them as the `unknown` bucket would block
  // standups when admins set `risk_defaults.unknown=require_approval`,
  // even though those built-ins have their own enforcement path.
});

describe('evaluatePolicy: platform.always_allow', () => {
  it('auto-allows matched tools over default_require_approval and risk_defaults', () => {
    let p = emptyGovernancePolicy();
    p = setRiskDefaults(p, { write: 'require_approval' });
    p = setPlatformRule(p, 'always_allow', {
      mcp_id: 'd542',
      tool_name: 'browser_*',
      state: 'allow',
    });
    const r = evaluatePolicy(p, {
      agentId: 'a',
      mcpId: 'd542',
      toolName: 'browser_click',
      classification: 'write',
    });
    expect(r.state).toBe('allow');
    expect(r.source).toBe('platform_allow');
  });

  it('always_deny still beats always_allow (kill-switch wins)', () => {
    let p = emptyGovernancePolicy();
    p = setPlatformRule(p, 'always_allow', { mcp_id: '*', tool_name: 'browser_*', state: 'allow' });
    p = setPlatformRule(p, 'always_deny', { mcp_id: 'd542', tool_name: 'browser_run_code', state: 'deny' });
    const r = evaluatePolicy(p, {
      agentId: 'a',
      mcpId: 'd542',
      toolName: 'browser_run_code',
    });
    expect(r.state).toBe('deny');
    expect(r.source).toBe('platform_deny');
  });

  it('a more-specific require_approval beats a broad always_allow wildcard', () => {
    let p = emptyGovernancePolicy();
    p = setPlatformRule(p, 'always_allow', { mcp_id: '*', tool_name: 'browser_*', state: 'allow' });
    p = setPlatformRule(p, 'default_require_approval', {
      mcp_id: 'd542',
      tool_name: 'browser_run_code',
      state: 'require_approval',
    });
    const r = evaluatePolicy(p, { agentId: 'a', mcpId: 'd542', toolName: 'browser_run_code' });
    expect(r.state).toBe('require_approval');
    expect(r.source).toBe('platform_require_approval');
  });

  it('a more-specific always_allow beats a broad require_approval (allowlist exception)', () => {
    let p = emptyGovernancePolicy();
    p = setPlatformRule(p, 'default_require_approval', { mcp_id: '*', tool_name: '*', state: 'require_approval' });
    p = setPlatformRule(p, 'always_allow', {
      mcp_id: 'd542',
      tool_name: 'browser_snapshot',
      state: 'allow',
    });
    const r = evaluatePolicy(p, { agentId: 'a', mcpId: 'd542', toolName: 'browser_snapshot' });
    expect(r.state).toBe('allow');
    expect(r.source).toBe('platform_allow');
  });

  it('returns the matched rule so callers can tell an exact pin from a wildcard', () => {
    let p = emptyGovernancePolicy();
    p = setPlatformRule(p, 'always_allow', { mcp_id: 'd542', tool_name: 'browser_*', state: 'allow' });
    // Wildcard match: returned rule.tool_name is the family pattern, not the tool.
    const wild = evaluatePolicy(p, { agentId: 'a', mcpId: 'd542', toolName: 'browser_click' });
    expect(wild.rule?.tool_name).toBe('browser_*');
    // Exact match: returned rule.tool_name equals the tool.
    p = setPlatformRule(p, 'always_allow', { mcp_id: 'd542', tool_name: 'browser_click', state: 'allow' });
    const exact = evaluatePolicy(p, { agentId: 'a', mcpId: 'd542', toolName: 'browser_click' });
    expect(exact.rule?.tool_name).toBe('browser_click');
  });

  it('equal-specificity overlap resolves to require_approval (safer wins)', () => {
    let p = emptyGovernancePolicy();
    p = setPlatformRule(p, 'always_allow', { mcp_id: 'd542', tool_name: 'browser_*', state: 'allow' });
    p = setPlatformRule(p, 'default_require_approval', { mcp_id: 'd542', tool_name: 'browser_*', state: 'require_approval' });
    const r = evaluatePolicy(p, { agentId: 'a', mcpId: 'd542', toolName: 'browser_click' });
    expect(r.state).toBe('require_approval');
  });

  it('an explicit agent rule overrides an org-wide always_allow', () => {
    let p = emptyGovernancePolicy();
    p = setPlatformRule(p, 'always_allow', { mcp_id: '*', tool_name: 'browser_*', state: 'allow' });
    p = setAgentRule(p, 'restricted', {
      mcp_id: 'd542',
      tool_name: 'browser_navigate',
      state: 'require_approval',
    });
    const r = evaluatePolicy(p, {
      agentId: 'restricted',
      mcpId: 'd542',
      toolName: 'browser_navigate',
    });
    expect(r.state).toBe('require_approval');
    expect(r.source).toBe('agent_rule');
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

});

describe('GovernancePolicy schema with risk_defaults', () => {
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
