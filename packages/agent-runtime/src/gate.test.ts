import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDef, TaskDef, UjimaEvent } from '@ujima/shared';
import { emptyGovernancePolicy, setAgentRule } from '@ujima/shared';
import { openDb, type UjimaDb } from '@ujima/context-store';
import { createLocalEventBus, type EventBus } from '@ujima/event-bus';
import { createPermissionMiddleware } from '@ujima/permissions';
import { createMockProvider, textTurn, toolTurn } from '@ujima/llm/legacy';
import { runAgent } from './shell';
import { createLanguageModelFromLegacyProvider } from './legacy-llm-language-model';
import { makeFakeMCPConnection } from './test-helpers';
import type { GateDecision, GateRequest, GateResolver } from './types';

const agent: AgentDef = {
  id: 'writer',
  name: 'Writer',
  persona: 'You write docs.',
  model: 'mock',
  mcp: 'fs',
  permissions: {
    allowed_tools: ['write_file'],
    blocked_tools: [],
    rate_limit: { calls_per_minute: 30, max_session_tokens: 100_000 },
  },
  communication: { publishes: ['docs'], subscribes: [] },
  escalation: { conditions: [], escalate_to: 'human' },
};

const task: TaskDef = {
  task_id: 'task-gate',
  prompt: 'Save notes',
  orchestrator_mode: 'manual',
  execution_mode: 'concurrent',
};

function approvalPolicy() {
  return setAgentRule(emptyGovernancePolicy(), 'writer', {
    mcp_id: 'fs',
    tool_name: 'write_file',
    state: 'require_approval',
  });
}

function inputPolicy() {
  return setAgentRule(emptyGovernancePolicy(), 'writer', {
    mcp_id: 'fs',
    tool_name: 'write_file',
    state: 'require_input',
  });
}

function fsWriteTool(): { name: string; description: string; inputSchema: Record<string, unknown> }[] {
  return [
    {
      name: 'write_file',
      description: 'Write a file',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          body: { type: 'string' },
        },
      },
    },
  ];
}

describe('runToolLoop — gate pause/resume', () => {
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

  it('pauses on require_approval, invokes MCP on approve', async () => {
    const onCall = vi.fn();
    const _provider = createMockProvider({
      script: [
        toolTurn('t1', 'write_file', { path: '/x.md', body: 'hi' }),
        textTurn('saved'),
      ],
    });
    const mcp = makeFakeMCPConnection({ id: 'fs', tools: fsWriteTool(), onCall });
    const permissions = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: approvalPolicy(),
    });

    const seen: GateRequest[] = [];
    const resolver: GateResolver = {
      async awaitDecision(req) {
        seen.push(req);
        return { kind: 'approve', decidedBy: 'tester' } satisfies GateDecision;
      },
    };

    const events: UjimaEvent[] = [];
    bus.subscribe('docs', (e) => {
      events.push(e);
    });

    const handle = runAgent({
      agent,
      task,
      sessionId: 's1',
      spawnReason: 'initial',
      model: createLanguageModelFromLegacyProvider(_provider, 'mock'),
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
    expect(result.finalText).toContain('saved');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.toolName).toBe('write_file');
    expect(seen[0]?.code).toBe('requires_approval');
    expect(onCall).toHaveBeenCalledTimes(1);

    expect(events.some((e) => e.type === 'policy_gate_triggered')).toBe(true);
    const resolved = events.find((e) => e.type === 'policy_gate_resolved');
    expect(resolved?.payload).toMatchObject({ outcome: 'approve', decided_by: 'tester' });
  });

  it('rejects without calling MCP; LLM sees rejection tool_result', async () => {
    const onCall = vi.fn();
    const _provider = createMockProvider({
      script: [
        toolTurn('t1', 'write_file', { path: '/x.md' }),
        textTurn('ok, stopped'),
      ],
    });
    const mcp = makeFakeMCPConnection({ id: 'fs', tools: fsWriteTool(), onCall });
    const permissions = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: approvalPolicy(),
    });

    const resolver: GateResolver = {
      async awaitDecision(): Promise<GateDecision> {
        return { kind: 'reject', reason: 'looks risky' };
      },
    };

    const handle = runAgent({
      agent,
      task,
      sessionId: 's1',
      spawnReason: 'initial',
      model: createLanguageModelFromLegacyProvider(_provider, 'mock'),
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
    expect(onCall).not.toHaveBeenCalled();

    const toolCalls = await db.audit.query({ eventType: 'tool_call' });
    const rejected = toolCalls.find((r) => !r.allowed);
    expect(rejected?.block_reason).toContain('gate_rejected');
  });

  it('passes edited args to MCP on require_input approve', async () => {
    let received: unknown;
    const onCall = vi.fn((_ctx, _name, args) => {
      received = args;
    });
    const _provider = createMockProvider({
      script: [
        toolTurn('t1', 'write_file', { path: '/risky.md', body: 'raw' }),
        textTurn('done'),
      ],
    });
    const mcp = makeFakeMCPConnection({ id: 'fs', tools: fsWriteTool(), onCall });
    const permissions = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: inputPolicy(),
    });

    const resolver: GateResolver = {
      async awaitDecision(): Promise<GateDecision> {
        return {
          kind: 'approve',
          args: { path: '/safe.md', body: 'edited' },
          decidedBy: 'human',
        };
      },
    };

    const handle = runAgent({
      agent,
      task,
      sessionId: 's1',
      spawnReason: 'initial',
      model: createLanguageModelFromLegacyProvider(_provider, 'mock'),
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
    expect(received).toEqual({ path: '/safe.md', body: 'edited' });
    expect(onCall).toHaveBeenCalledTimes(1);
  });

  it('abort during gate wait exits as killed without calling MCP', async () => {
    const onCall = vi.fn();
    const _provider = createMockProvider({
      script: [toolTurn('t1', 'write_file', { path: '/x.md' }), textTurn('done')],
    });
    const mcp = makeFakeMCPConnection({ id: 'fs', tools: fsWriteTool(), onCall });
    const permissions = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: approvalPolicy(),
    });

    const resolver: GateResolver = {
      awaitDecision() {
        return new Promise<GateDecision>(() => {
          /* never resolves */
        });
      },
    };

    const handle = runAgent({
      agent,
      task,
      sessionId: 's1',
      spawnReason: 'initial',
      model: createLanguageModelFromLegacyProvider(_provider, 'mock'),
      mcp,
      permissions,
      eventBus: bus,
      context: db.context,
      audit: db.audit,
      agentState: db.agentState,
      gateResolver: resolver,
    });

    setTimeout(() => handle.kill(), 20);
    const result = await handle.result;
    // Kill during a human gate should never reach MCP; AI SDK may surface this as
    // `killed` (LoopExit) or a wrapped `error` depending on streamText internals.
    expect(result.exitReason === 'killed' || result.exitReason === 'error').toBe(true);
    expect(onCall).not.toHaveBeenCalled();
  });
});
