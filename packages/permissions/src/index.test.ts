import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDef } from '@ujima/shared';
import {
  emptyGovernancePolicy,
  setAgentRule,
  setPlatformRule,
  setRiskDefaults,
} from '@ujima/shared';
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
      rate_limit: { max_session_tokens: 1000 },
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
          rate_limit: { max_session_tokens: 1000 },
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
        rate_limit: { max_session_tokens: 1000 },
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

});

describe('permission middleware — classification + risk_defaults', () => {
  let db: UjimaDb;

  beforeEach(() => {
    db = openDb({ dbPath: ':memory:' });
  });
  afterEach(async () => {
    await db.close();
  });

  const ctx = { mcp: { id: 'fs' }, taskId: 't1', sessionId: 's1' } as const;

  it('read tool with risk_defaults.read=allow executes without an explicit allow rule', async () => {
    const policy = setRiskDefaults(emptyGovernancePolicy(), { read: 'allow' });
    const mw = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: policy,
      classificationLookup: () => 'read',
    });
    const d = await mw.check({
      agent: agent({
        permissions: {
          allowed_tools: [],
          blocked_tools: ['get_file'], // would normally block — admin allow wins
          rate_limit: { max_session_tokens: 1000 },
        },
      }),
      ...ctx,
      toolName: 'get_file',
      args: {},
    });
    expect(d.allowed).toBe(true);
  });

  it('destructive tool defaults to require_approval when risk_defaults.destructive=require_approval', async () => {
    const policy = setRiskDefaults(emptyGovernancePolicy(), {
      destructive: 'require_approval',
    });
    const mw = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: policy,
      classificationLookup: () => 'destructive',
    });
    const d = await mw.check({
      agent: agent(),
      ...ctx,
      toolName: 'delete_file',
      args: {},
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe('requires_approval');
      expect(d.gate).toBe('approval');
    }
  });

  it('explicit agent rule still beats risk_default', async () => {
    let policy = emptyGovernancePolicy();
    policy = setRiskDefaults(policy, { destructive: 'deny' });
    policy = setAgentRule(policy, 'agent-1', {
      mcp_id: 'fs',
      tool_name: 'delete_file',
      state: 'allow',
    });
    const mw = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: policy,
      classificationLookup: () => 'destructive',
    });
    const d = await mw.check({
      agent: agent(),
      ...ctx,
      toolName: 'delete_file',
      args: {},
    });
    expect(d.allowed).toBe(true);
  });

});
