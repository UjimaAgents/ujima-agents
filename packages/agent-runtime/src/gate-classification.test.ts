import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDef, TaskDef } from '@ujima/shared';
import {
  emptyGovernancePolicy,
  setAgentRule,
  setRiskDefaults,
  type ToolRiskClass,
} from '@ujima/shared';
import { openDb, type UjimaDb } from '@ujima/context-store';
import { createLocalEventBus, type EventBus } from '@ujima/event-bus';
import { createPermissionMiddleware } from '@ujima/permissions';
import { createMockProvider, textTurn, toolTurn } from '@ujima/llm/legacy';
import { runAgent } from './shell';
import { createLanguageModelFromLegacyProvider } from './legacy-llm-language-model';
import { makeFakeMCPConnection } from './test-helpers';
import type { GateDecision, GateResolver } from './types';

// Runtime enforces the (classification × risk_defaults) decision before
// any MCP callTool happens.

const agent: AgentDef = {
  id: 'worker',
  name: 'Worker',
  persona: 'You do things.',
  model: 'mock',
  mcp: 'fs',
  permissions: {
    allowed_tools: [],
    blocked_tools: [],
    rate_limit: { max_session_tokens: 100_000 },
  },
  communication: { publishes: ['out'], subscribes: [] },
  escalation: { conditions: [], escalate_to: 'human' },
};

const task: TaskDef = {
  task_id: 'task-class',
  prompt: 'do the thing',
  orchestrator_mode: 'manual',
  execution_mode: 'concurrent',
};

const stubTools = [
  { name: 'get_thing', description: 'Returns a thing', inputSchema: { type: 'object' } },
  { name: 'update_thing', description: 'Updates a thing', inputSchema: { type: 'object' } },
  { name: 'delete_thing', description: 'Permanently deletes', inputSchema: { type: 'object' } },
];

function classMap(map: Record<string, ToolRiskClass>) {
  return (_mcpId: string, toolName: string): ToolRiskClass | 'unknown' | undefined =>
    map[toolName];
}

describe('runtime enforces classification + risk_defaults', () => {
  let db: UjimaDb;
  let bus: EventBus;

  beforeEach(() => {
    db = openDb({ dbPath: ':memory:' });
    bus = createLocalEventBus({ audit: db.audit, pendingEvents: db.pendingEvents });
  });

  afterEach(async () => {
    await bus.close();
    await db.close();
  });

  it('read tool with read=allow executes without a gate', async () => {
    const onCall = vi.fn();
    const provider = createMockProvider({
      script: [toolTurn('t1', 'get_thing', {}), textTurn('done')],
    });
    const mcp = makeFakeMCPConnection({ id: 'fs', tools: stubTools, onCall });
    const policy = setRiskDefaults(emptyGovernancePolicy(), {
      read: 'allow',
      destructive: 'require_approval',
    });

    const permissions = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: policy,
      classificationLookup: classMap({
        get_thing: 'read',
        update_thing: 'write',
        delete_thing: 'destructive',
      }),
    });

    const seenGates: unknown[] = [];
    const resolver: GateResolver = {
      async awaitDecision(req) {
        seenGates.push(req);
        return { kind: 'approve', decidedBy: 'tester' } satisfies GateDecision;
      },
    };

    const handle = runAgent({
      agent,
      task,
      sessionId: 's1',
      spawnReason: 'initial',
      model: createLanguageModelFromLegacyProvider(provider, 'mock'),
      mcp,
      permissions,
      eventBus: bus,
      context: db.context,
      audit: db.audit,
      agentState: db.agentState,
      gateResolver: resolver,
    });

    const result = await handle.result;
    expect(result.exitReason).toBe('completed');
    expect(onCall).toHaveBeenCalledTimes(1);
    expect(seenGates).toHaveLength(0);
  });

  it('destructive tool pops a gate even with no explicit rule', async () => {
    const onCall = vi.fn();
    const provider = createMockProvider({
      script: [toolTurn('t1', 'delete_thing', {}), textTurn('done')],
    });
    const mcp = makeFakeMCPConnection({ id: 'fs', tools: stubTools, onCall });
    const policy = setRiskDefaults(emptyGovernancePolicy(), {
      destructive: 'require_approval',
    });

    const permissions = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: policy,
      classificationLookup: classMap({
        delete_thing: 'destructive',
      }),
    });

    const seenGates: { toolName: string; code: string }[] = [];
    const resolver: GateResolver = {
      async awaitDecision(req) {
        seenGates.push({ toolName: req.toolName, code: req.code });
        return { kind: 'approve', decidedBy: 'tester' } satisfies GateDecision;
      },
    };

    const handle = runAgent({
      agent,
      task,
      sessionId: 's1',
      spawnReason: 'initial',
      model: createLanguageModelFromLegacyProvider(provider, 'mock'),
      mcp,
      permissions,
      eventBus: bus,
      context: db.context,
      audit: db.audit,
      agentState: db.agentState,
      gateResolver: resolver,
    });

    const result = await handle.result;
    expect(result.exitReason).toBe('completed');
    expect(seenGates).toHaveLength(1);
    expect(seenGates[0]).toEqual({ toolName: 'delete_thing', code: 'requires_approval' });
    // Approval was granted → MCP was called.
    expect(onCall).toHaveBeenCalledTimes(1);
  });

  it('destructive=deny blocks without gate and without calling MCP', async () => {
    const onCall = vi.fn();
    const provider = createMockProvider({
      script: [toolTurn('t1', 'delete_thing', {}), textTurn('blocked, stopping')],
    });
    const mcp = makeFakeMCPConnection({ id: 'fs', tools: stubTools, onCall });
    const policy = setRiskDefaults(emptyGovernancePolicy(), {
      destructive: 'deny',
    });

    const permissions = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: policy,
      classificationLookup: classMap({
        delete_thing: 'destructive',
      }),
    });

    const seenGates: unknown[] = [];
    const resolver: GateResolver = {
      async awaitDecision(req) {
        seenGates.push(req);
        return { kind: 'reject', reason: 'denied' };
      },
    };

    const handle = runAgent({
      agent,
      task,
      sessionId: 's1',
      spawnReason: 'initial',
      model: createLanguageModelFromLegacyProvider(provider, 'mock'),
      mcp,
      permissions,
      eventBus: bus,
      context: db.context,
      audit: db.audit,
      agentState: db.agentState,
      gateResolver: resolver,
    });

    const result = await handle.result;
    expect(result.exitReason).toBe('completed');
    // Deny path: no gate is requested, no MCP call happens.
    expect(seenGates).toHaveLength(0);
    expect(onCall).not.toHaveBeenCalled();
  });

  it('agent rule overrides risk_default — explicit allow lets a destructive tool through', async () => {
    const onCall = vi.fn();
    const provider = createMockProvider({
      script: [toolTurn('t1', 'delete_thing', {}), textTurn('done')],
    });
    const mcp = makeFakeMCPConnection({ id: 'fs', tools: stubTools, onCall });
    let policy = emptyGovernancePolicy();
    policy = setRiskDefaults(policy, { destructive: 'deny' });
    policy = setAgentRule(policy, 'worker', {
      mcp_id: 'fs',
      tool_name: 'delete_thing',
      state: 'allow',
    });

    const permissions = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: policy,
      classificationLookup: classMap({ delete_thing: 'destructive' }),
    });

    const seenGates: unknown[] = [];
    const resolver: GateResolver = {
      async awaitDecision(req) {
        seenGates.push(req);
        return { kind: 'approve', decidedBy: 'tester' };
      },
    };

    const handle = runAgent({
      agent,
      task,
      sessionId: 's1',
      spawnReason: 'initial',
      model: createLanguageModelFromLegacyProvider(provider, 'mock'),
      mcp,
      permissions,
      eventBus: bus,
      context: db.context,
      audit: db.audit,
      agentState: db.agentState,
      gateResolver: resolver,
    });

    const result = await handle.result;
    expect(result.exitReason).toBe('completed');
    expect(seenGates).toHaveLength(0);
    expect(onCall).toHaveBeenCalledTimes(1);
  });

  it('back-compat: no classification lookup + default policy keeps the legacy behaviour', async () => {
    // Without a classificationLookup and with default `inherit` risk_defaults,
    // an agent with no allowed_tools list (i.e. permissive) executes
    // every tool as before. This guarantees pre-classification behaviour
    // is preserved when the feature is not wired.
    const onCall = vi.fn();
    const provider = createMockProvider({
      script: [toolTurn('t1', 'get_thing', {}), textTurn('ok')],
    });
    const mcp = makeFakeMCPConnection({ id: 'fs', tools: stubTools, onCall });
    const permissions = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: emptyGovernancePolicy(),
    });

    const handle = runAgent({
      agent,
      task,
      sessionId: 's1',
      spawnReason: 'initial',
      model: createLanguageModelFromLegacyProvider(provider, 'mock'),
      mcp,
      permissions,
      eventBus: bus,
      context: db.context,
      audit: db.audit,
      agentState: db.agentState,
    });

    const result = await handle.result;
    expect(result.exitReason).toBe('completed');
    expect(onCall).toHaveBeenCalledTimes(1);
  });
});
