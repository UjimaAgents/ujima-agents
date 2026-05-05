import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDef } from '@ujima/shared';
import { emptyGovernancePolicy, setAgentRule, setPlatformRule } from '@ujima/shared';
import { openDb, type UjimaDb } from '@ujima/context-store';
import { createPermissionMiddleware, type PermissionMiddleware } from './index';

function agent(overrides: Partial<AgentDef> = {}): AgentDef {
  return {
    id: 'agent-1',
    name: 'Test',
    persona: 'test',
    model: 'vscode-lm',
    mcp: 'fs',
    permissions: {
      allowed_tools: [],
      blocked_tools: [],
      rate_limit: { calls_per_minute: 30, max_session_tokens: 1000 },
    },
    communication: { publishes: [], subscribes: [] },
    escalation: { conditions: [], escalate_to: 'human' },
    ...overrides,
  } as AgentDef;
}

describe('permission middleware', () => {
  let db: UjimaDb;
  let mw: PermissionMiddleware;

  beforeEach(() => {
    db = openDb({ dbPath: ':memory:' });
    mw = createPermissionMiddleware({ audit: db.audit, agentState: db.agentState });
  });

  afterEach(async () => {
    await db.close();
  });

  const ctx = { mcp: { id: 'fs' }, taskId: 't1', sessionId: 's1' } as const;

  it('allows when no policies block', async () => {
    const d = await mw.check({ agent: agent(), ...ctx, toolName: 'read', args: { path: 'x' } });
    expect(d.allowed).toBe(true);
  });

  it('blocks when tool is in agent blocked_tools', async () => {
    const d = await mw.check({
      agent: agent({
        permissions: {
          allowed_tools: [],
          blocked_tools: ['write'],
          rate_limit: { calls_per_minute: 30, max_session_tokens: 1000 },
        },
      }),
      ...ctx,
      toolName: 'write',
      args: {},
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('blocked_tool');
  });

  it('flags destructive patterns as approval required', async () => {
    const d = await mw.check({
      agent: agent(),
      ...ctx,
      toolName: 'exec',
      args: { cmd: 'rm -rf /' },
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe('destructive_pattern');
      expect(d.gate).toBe('approval');
    }
  });

  it('MCP policy blocks tool even if agent allows', async () => {
    const mw2 = createPermissionMiddleware({
      audit: db.audit,
      agentState: db.agentState,
      mcpPolicies: { fs: { blocked_tools: ['delete'] } },
    });
    const d = await mw2.check({ agent: agent(), ...ctx, toolName: 'delete', args: {} });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('blocked_tool');
  });

  it('session override pause blocks everything', async () => {
    mw.setSessionOverride('agent-1', { paused: true });
    const d = await mw.check({ agent: agent(), ...ctx, toolName: 'read', args: {} });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('session_override');
    mw.clearSessionOverride('agent-1');
    const d2 = await mw.check({ agent: agent(), ...ctx, toolName: 'read', args: {} });
    expect(d2.allowed).toBe(true);
  });

  it('rate-limits when exceeding calls_per_minute', async () => {
    const a = agent({
      permissions: {
        allowed_tools: [],
        blocked_tools: [],
        rate_limit: { calls_per_minute: 2, max_session_tokens: 1000 },
      },
    });
    const first = await mw.check({ agent: a, ...ctx, toolName: 'read', args: {} });
    const second = await mw.check({ agent: a, ...ctx, toolName: 'read', args: {} });
    const third = await mw.check({ agent: a, ...ctx, toolName: 'read', args: {} });
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    if (!third.allowed) expect(third.code).toBe('rate_limited');
  });

  it('enforces token cap from agent state', async () => {
    const a = agent({
      permissions: {
        allowed_tools: [],
        blocked_tools: [],
        rate_limit: { calls_per_minute: 30, max_session_tokens: 100 },
      },
    });
    await mw.recordUsage('agent-1', 150);
    const d = await mw.check({ agent: a, ...ctx, toolName: 'read', args: {} });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('token_cap_exceeded');
  });

  it('platform default blocked tools take precedence', async () => {
    const mw2 = createPermissionMiddleware({
      audit: db.audit,
      agentState: db.agentState,
      platformDefaults: { blocked_tools: ['shell.exec'], destructive_patterns: [] },
    });
    const d = await mw2.check({ agent: agent(), ...ctx, toolName: 'shell.exec', args: {} });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('blocked_tool');
  });

  it('writes an audit row for every check', async () => {
    await mw.check({ agent: agent(), ...ctx, toolName: 'read', args: {} });
    const rows = await db.audit.query({ taskId: 't1', eventType: 'permission_check' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.allowed).toBe(true);
  });

  it('rate limit window rolls over after 60s — old calls no longer count', async () => {
    let time = 1_000_000;
    const mwClock = createPermissionMiddleware({
      audit: db.audit,
      agentState: db.agentState,
      now: () => time,
    });
    const a = agent({
      permissions: {
        allowed_tools: [],
        blocked_tools: [],
        rate_limit: { calls_per_minute: 2, max_session_tokens: 1000 },
      },
    });
    expect((await mwClock.check({ agent: a, ...ctx, toolName: 'r', args: {} })).allowed).toBe(true);
    expect((await mwClock.check({ agent: a, ...ctx, toolName: 'r', args: {} })).allowed).toBe(true);
    expect((await mwClock.check({ agent: a, ...ctx, toolName: 'r', args: {} })).allowed).toBe(false);
    time += 61_000;
    expect((await mwClock.check({ agent: a, ...ctx, toolName: 'r', args: {} })).allowed).toBe(true);
  });

  it('session override blocked_tools denies only the listed tool', async () => {
    mw.setSessionOverride('agent-1', { blocked_tools: ['write'] });
    const deny = await mw.check({ agent: agent(), ...ctx, toolName: 'write', args: {} });
    expect(deny.allowed).toBe(false);
    if (!deny.allowed) expect(deny.code).toBe('session_override');
    const allow = await mw.check({ agent: agent(), ...ctx, toolName: 'read', args: {} });
    expect(allow.allowed).toBe(true);
  });

  it('MCP allowed_tools allowlist rejects tools not on the list', async () => {
    const mw2 = createPermissionMiddleware({
      audit: db.audit,
      agentState: db.agentState,
      mcpPolicies: { fs: { allowed_tools: ['read'] } },
    });
    const d = await mw2.check({ agent: agent(), ...ctx, toolName: 'write', args: {} });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('not_allowed_tool');
  });

  it('agent allowed_tools with empty array means no allowlist (all pass)', async () => {
    const d = await mw.check({
      agent: agent({
        permissions: {
          allowed_tools: [],
          blocked_tools: [],
          rate_limit: { calls_per_minute: 30, max_session_tokens: 1000 },
        },
      }),
      ...ctx,
      toolName: 'anything',
      args: {},
    });
    expect(d.allowed).toBe(true);
  });

  it('destructive pattern matches sql DROP TABLE case-insensitively', async () => {
    const d = await mw.check({
      agent: agent(),
      ...ctx,
      toolName: 'query',
      args: { sql: 'drop table users' },
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('destructive_pattern');
  });

  it('audit row records block_reason when denied', async () => {
    await mw.check({
      agent: agent({
        permissions: {
          allowed_tools: [],
          blocked_tools: ['exec'],
          rate_limit: { calls_per_minute: 30, max_session_tokens: 1000 },
        },
      }),
      ...ctx,
      toolName: 'exec',
      args: {},
    });
    const rows = await db.audit.query({ taskId: 't1', eventType: 'permission_check' });
    expect(rows[0]?.allowed).toBe(false);
    expect(rows[0]?.block_reason).toMatch(/blocked for agent/);
  });
});

describe('permission middleware — governance policy layer', () => {
  let db: UjimaDb;

  beforeEach(() => {
    db = openDb({ dbPath: ':memory:' });
  });
  afterEach(async () => {
    await db.close();
  });

  const ctx = { mcp: { id: 'fs' }, taskId: 't1', sessionId: 's1' } as const;

  it('platform always_deny blocks the tool regardless of agent def', async () => {
    let policy = emptyGovernancePolicy();
    policy = setPlatformRule(policy, 'always_deny', {
      mcp_id: 'fs',
      tool_name: 'delete',
      state: 'deny',
      reason: 'kill-switch',
    });
    const mw = createPermissionMiddleware({
      audit: db.audit,
      agentState: db.agentState,
      governancePolicy: policy,
    });
    const d = await mw.check({ agent: agent(), ...ctx, toolName: 'delete', args: {} });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe('blocked_tool');
      expect(d.reason).toBe('kill-switch');
    }
  });

  it('agent deny rule in policy returns policy_deny code', async () => {
    let policy = emptyGovernancePolicy();
    policy = setAgentRule(policy, 'agent-1', {
      mcp_id: 'fs',
      tool_name: 'write',
      state: 'deny',
      reason: 'read-only agent',
    });
    const mw = createPermissionMiddleware({
      audit: db.audit,
      agentState: db.agentState,
      governancePolicy: policy,
    });
    const d = await mw.check({ agent: agent(), ...ctx, toolName: 'write', args: {} });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe('policy_deny');
      expect(d.reason).toBe('read-only agent');
      expect(d.rule?.mcp_id).toBe('fs');
    }
  });

  it('require_approval returns requires_approval code with gate="approval"', async () => {
    let policy = emptyGovernancePolicy();
    policy = setAgentRule(policy, 'agent-1', {
      mcp_id: 'fs',
      tool_name: 'write',
      state: 'require_approval',
    });
    const mw = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: policy,
    });
    const d = await mw.check({ agent: agent(), ...ctx, toolName: 'write', args: {} });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe('requires_approval');
      expect(d.gate).toBe('approval');
    }
  });

  it('require_input returns requires_input code with gate="input"', async () => {
    let policy = emptyGovernancePolicy();
    policy = setAgentRule(policy, 'agent-1', {
      mcp_id: 'fs',
      tool_name: 'write',
      state: 'require_input',
    });
    const mw = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: policy,
    });
    const d = await mw.check({ agent: agent(), ...ctx, toolName: 'write', args: {} });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe('requires_input');
      expect(d.gate).toBe('input');
    }
  });

  it('policy allow overrides agent.permissions.blocked_tools', async () => {
    let policy = emptyGovernancePolicy();
    policy = setAgentRule(policy, 'agent-1', {
      mcp_id: 'fs',
      tool_name: 'write',
      state: 'allow',
      reason: 'explicit admin override',
    });
    const mw = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: policy,
    });
    const a = agent({
      permissions: {
        allowed_tools: [],
        blocked_tools: ['write'],
        rate_limit: { calls_per_minute: 30, max_session_tokens: 1000 },
      },
    });
    const d = await mw.check({ agent: a, ...ctx, toolName: 'write', args: {} });
    expect(d.allowed).toBe(true);
  });

  it('policy allow does NOT bypass safety rails (destructive patterns)', async () => {
    let policy = emptyGovernancePolicy();
    policy = setAgentRule(policy, 'agent-1', {
      mcp_id: 'fs',
      tool_name: 'exec',
      state: 'allow',
    });
    const mw = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: policy,
    });
    const d = await mw.check({
      agent: agent(),
      ...ctx,
      toolName: 'exec',
      args: { cmd: 'rm -rf /' },
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('destructive_pattern');
  });

  it('policy allow does NOT bypass rate limits', async () => {
    let policy = emptyGovernancePolicy();
    policy = setAgentRule(policy, 'agent-1', {
      mcp_id: 'fs',
      tool_name: 'read',
      state: 'allow',
    });
    const mw = createPermissionMiddleware({
      audit: db.audit,
      agentState: db.agentState,
      governancePolicy: policy,
    });
    const a = agent({
      permissions: {
        allowed_tools: [],
        blocked_tools: [],
        rate_limit: { calls_per_minute: 1, max_session_tokens: 1000 },
      },
    });
    const first = await mw.check({ agent: a, ...ctx, toolName: 'read', args: {} });
    const second = await mw.check({ agent: a, ...ctx, toolName: 'read', args: {} });
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    if (!second.allowed) expect(second.code).toBe('rate_limited');
  });

  it('inherit state falls through to legacy checks', async () => {
    let policy = emptyGovernancePolicy();
    policy = setAgentRule(policy, 'agent-1', {
      mcp_id: 'fs',
      tool_name: 'write',
      state: 'inherit',
    });
    const mw = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: policy,
    });
    const a = agent({
      permissions: {
        allowed_tools: [],
        blocked_tools: ['write'],
        rate_limit: { calls_per_minute: 30, max_session_tokens: 1000 },
      },
    });
    const d = await mw.check({ agent: a, ...ctx, toolName: 'write', args: {} });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('blocked_tool');
  });

  it('session override pause still beats governance allow', async () => {
    let policy = emptyGovernancePolicy();
    policy = setAgentRule(policy, 'agent-1', {
      mcp_id: 'fs',
      tool_name: 'read',
      state: 'allow',
    });
    const mw = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: policy,
    });
    mw.setSessionOverride('agent-1', { paused: true });
    const d = await mw.check({ agent: agent(), ...ctx, toolName: 'read', args: {} });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('session_override');
  });

  it('setGovernancePolicy updates policy at runtime', async () => {
    const mw = createPermissionMiddleware({ audit: db.audit });
    const d1 = await mw.check({ agent: agent(), ...ctx, toolName: 'read', args: {} });
    expect(d1.allowed).toBe(true);
    let policy = emptyGovernancePolicy();
    policy = setAgentRule(policy, 'agent-1', {
      mcp_id: 'fs',
      tool_name: 'read',
      state: 'deny',
    });
    mw.setGovernancePolicy(policy);
    const d2 = await mw.check({ agent: agent(), ...ctx, toolName: 'read', args: {} });
    expect(d2.allowed).toBe(false);
  });

  it('policy function resolver is called per check (dynamic policy)', async () => {
    let current = emptyGovernancePolicy();
    const mw = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: () => current,
    });
    const d1 = await mw.check({ agent: agent(), ...ctx, toolName: 'read', args: {} });
    expect(d1.allowed).toBe(true);
    current = setAgentRule(current, 'agent-1', {
      mcp_id: 'fs',
      tool_name: 'read',
      state: 'deny',
    });
    const d2 = await mw.check({ agent: agent(), ...ctx, toolName: 'read', args: {} });
    expect(d2.allowed).toBe(false);
    if (!d2.allowed) expect(d2.code).toBe('policy_deny');
  });

  it('require_approval writes an audit row with the policy reason', async () => {
    let policy = emptyGovernancePolicy();
    policy = setAgentRule(policy, 'agent-1', {
      mcp_id: 'fs',
      tool_name: 'write',
      state: 'require_approval',
      reason: 'senior review required',
    });
    const mw = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: policy,
    });
    await mw.check({ agent: agent(), ...ctx, toolName: 'write', args: {} });
    const rows = await db.audit.query({ taskId: 't1', eventType: 'permission_check' });
    expect(rows[0]?.allowed).toBe(false);
    expect(rows[0]?.block_reason).toBe('senior review required');
  });
});
