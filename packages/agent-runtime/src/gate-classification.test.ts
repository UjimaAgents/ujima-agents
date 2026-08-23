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
import { createLanguageModelFromLegacyProvider, makeFakeMCPConnection } from './test-helpers';

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

  it('destructive tool gets blocked when require_approval is triggered without a resolver', async () => {
    const onCall = vi.fn();
    const provider = createMockProvider({
      script: [toolTurn('t1', 'delete_thing', {}), textTurn('denied, stopped')],
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
    expect(result.finalText).toContain('denied');
    // Approval required -> not granted -> MCP not called.
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
