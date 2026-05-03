import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDef, TaskDef, TeamDef, UjimaEvent } from '@ujima/shared';
import { openDb, type UjimaDb } from '@ujima/context-store';
import { createLocalEventBus, type EventBus } from '@ujima/event-bus';
import { createPermissionMiddleware } from '@ujima/permissions';
import { createMockProvider, textTurn, toolTurn, type LLMProvider } from '@ujima/llm/legacy';
import { runTask, topoSortWaves } from './run-task';
import { ORCHESTRATOR_EVENT_CHANNEL } from './types';
import { makeFakeMCPConnection } from './test-helpers';

function getOrThrow<K, V>(map: Map<K, V>, key: K): V {
  const v = map.get(key);
  if (v === undefined) throw new Error(`missing key: ${String(key)}`);
  return v;
}

const srDesigner: AgentDef = {
  id: 'sr-designer',
  name: 'Sr Designer',
  persona: 'Senior Designer.',
  model: 'mock',
  mcp: 'figma',
  permissions: {
    allowed_tools: ['create_frame'],
    blocked_tools: [],
    rate_limit: { calls_per_minute: 30, max_session_tokens: 100_000 },
  },
  communication: { publishes: ['design:frames'], subscribes: [] },
  escalation: { conditions: [], escalate_to: 'human' },
};

const jrDesigner: AgentDef = {
  id: 'jr-designer',
  name: 'Jr Designer',
  persona: 'Junior Designer.',
  model: 'mock',
  mcp: 'figma',
  permissions: {
    allowed_tools: ['inspect_frame'],
    blocked_tools: [],
    rate_limit: { calls_per_minute: 30, max_session_tokens: 100_000 },
  },
  communication: { publishes: ['design:frames'], subscribes: ['design:frames'] },
  escalation: { conditions: ['requires approval'], escalate_to: 'sr-designer' },
};

const dbAgent: AgentDef = {
  id: 'db-agent',
  name: 'DB Agent',
  persona: 'Database analyst.',
  model: 'mock',
  mcp: 'sqlite',
  permissions: {
    allowed_tools: ['query'],
    blocked_tools: [],
    rate_limit: { calls_per_minute: 30, max_session_tokens: 100_000 },
  },
  communication: { publishes: ['data:schema'], subscribes: [] },
  escalation: { conditions: [], escalate_to: 'human' },
};

const team: TeamDef = {
  team_id: 'design-team',
  name: 'Design Team',
  agents: ['sr-designer', 'jr-designer'],
};

const task: TaskDef = {
  task_id: 'task-profile',
  prompt: 'Design a user profile card',
  team_id: 'design-team',
  orchestrator_mode: 'manual',
  execution_mode: 'concurrent',
};

describe('orchestrator runTask — manual mode + concurrent execution', () => {
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

  it('spawns every team agent concurrently and synthesizes a completed run', async () => {
    const mcp = makeFakeMCPConnection({
      id: 'figma',
      tools: [
        { name: 'create_frame', description: '', inputSchema: { type: 'object', properties: {} } },
        { name: 'inspect_frame', description: '', inputSchema: { type: 'object', properties: {} } },
      ],
    });
    const permissions = createPermissionMiddleware({ audit: db.audit, agentState: db.agentState });

    const orchestratorEvents: UjimaEvent[] = [];
    bus.subscribe(ORCHESTRATOR_EVENT_CHANNEL, (e) => {
      orchestratorEvents.push(e);
    });

    const providers = new Map<string, LLMProvider>([
      [
        'sr-designer',
        ((...args) => ({} as any))({
          script: [toolTurn('s1', 'create_frame', { name: 'card' }), textTurn('ok')],
        }),
      ],
      [
        'jr-designer',
        ((...args) => ({} as any))({
          script: [toolTurn('j1', 'inspect_frame', { id: 'card' }), textTurn('reviewed')],
        }),
      ],
    ]);

    const handle = runTask(
      {
        resolveAgent: (id) => (id === 'sr-designer' ? srDesigner : id === 'jr-designer' ? jrDesigner : undefined),
        getMCPConnection: () => mcp,
        getModel: (agent: any): any => getOrThrow(providers, agent.id),
        eventBus: bus,
        context: db.context,
        audit: db.audit,
        permissions,
        agentState: db.agentState,
        approvals: db.approvals,
        taskState: db.taskState,
      },
      { task, team, sessionId: 'sess-1' },
    );

    expect(handle.agentIds()).toEqual([]); // resolved asynchronously inside execute

    const result = await handle.result;
    expect(result.status).toBe('completed');
    expect(result.agentResults).toHaveLength(2);
    expect(result.agentResults.every((r) => r.exitReason === 'completed')).toBe(true);
    expect(result.approvalsPending).toBe(0);
    expect(result.output.agents.map((a) => a.agentId).sort()).toEqual([
      'jr-designer',
      'sr-designer',
    ]);

    const taskStarted = orchestratorEvents.find((e) => e.type === 'task_started');
    const taskCompleted = orchestratorEvents.find((e) => e.type === 'task_completed');
    expect(taskStarted).toBeDefined();
    expect(taskCompleted).toBeDefined();

    const taskRec = await db.taskState.get('task-profile');
    expect(taskRec?.status).toBe('complete');

    expect(handle.agentIds().sort()).toEqual(['jr-designer', 'sr-designer']);
  });

  it('fails fast when the team references an unknown agent', async () => {
    const mcp = makeFakeMCPConnection({ id: 'figma' });
    const permissions = createPermissionMiddleware({ audit: db.audit });

    const handle = runTask(
      {
        resolveAgent: (id) => (id === 'sr-designer' ? srDesigner : undefined),
        getMCPConnection: () => mcp,
        getModel: () => ((...args) => ({} as any))({ script: [textTurn('ok')] }),
        eventBus: bus,
        context: db.context,
        audit: db.audit,
        permissions,
        agentState: db.agentState,
        approvals: db.approvals,
      },
      { task, team, sessionId: 'sess-missing' },
    );

    const result = await handle.result;
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/unknown agents in team: jr-designer/);
  });

  it('groups agents by MCP across teams with multiple MCPs', async () => {
    const figma = makeFakeMCPConnection({ id: 'figma' });
    const sqlite = makeFakeMCPConnection({ id: 'sqlite' });
    const mcpCalls: Record<string, number> = {};
    const mcpByAgent = (id: string): typeof figma => {
      mcpCalls[id] = (mcpCalls[id] ?? 0) + 1;
      return id === 'sqlite' ? sqlite : figma;
    };
    const permissions = createPermissionMiddleware({ audit: db.audit });

    const handle = runTask(
      {
        resolveAgent: (id) =>
          id === 'sr-designer' ? srDesigner : id === 'db-agent' ? dbAgent : undefined,
        getMCPConnection: (mcpId) => mcpByAgent(mcpId),
        getModel: () => ((...args) => ({} as any))({ script: [textTurn('done')] }),
        eventBus: bus,
        context: db.context,
        audit: db.audit,
        permissions,
        agentState: db.agentState,
        approvals: db.approvals,
      },
      {
        task: { ...task, team_id: 'mixed' },
        team: { team_id: 'mixed', name: 'Mixed', agents: ['sr-designer', 'db-agent'] },
        sessionId: 'sess-mixed',
      },
    );

    const result = await handle.result;
    expect(result.status).toBe('completed');
    expect(mcpCalls.figma).toBe(1);
    expect(mcpCalls.sqlite).toBe(1);
  });

  it('killAgent aborts only the targeted agent; the rest complete', async () => {
    const mcp = makeFakeMCPConnection({ id: 'figma' });
    const permissions = createPermissionMiddleware({ audit: db.audit });

    const slowProvider: LLMProvider = {
      id: 'mock',
      async *stream({ abortSignal }) {
        await new Promise<void>((_, reject) => {
          if (abortSignal?.aborted) {
            reject(new Error('aborted'));
            return;
          }
          abortSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
        yield { type: 'finish', reason: 'end_turn' };
      },
    };

    const providers = new Map<string, LLMProvider>([
      ['sr-designer', ({} as any)],
      ['jr-designer', ((...args) => ({} as any))({ script: [textTurn('fast-done')] })],
    ]);

    const handle = runTask(
      {
        resolveAgent: (id) => (id === 'sr-designer' ? srDesigner : id === 'jr-designer' ? jrDesigner : undefined),
        getMCPConnection: () => mcp,
        getModel: (agent: any): any => getOrThrow(providers, agent.id),
        eventBus: bus,
        context: db.context,
        audit: db.audit,
        permissions,
        agentState: db.agentState,
        approvals: db.approvals,
      },
      { task, team, sessionId: 'sess-kill-one' },
    );

    setTimeout(() => handle.killAgent('sr-designer'), 15);

    const result = await handle.result;
    expect(result.status).toBe('failed');
    const sr = result.agentResults.find((r) => r.agentId === 'sr-designer');
    const jr = result.agentResults.find((r) => r.agentId === 'jr-designer');
    expect(sr?.exitReason).toBe('error');
    expect(jr?.exitReason).toBe('completed');
  });

  it('killSession aborts the whole run and marks it paused', async () => {
    const mcp = makeFakeMCPConnection({ id: 'figma' });
    const permissions = createPermissionMiddleware({ audit: db.audit });

    const slowProvider: LLMProvider = {
      id: 'mock',
      async *stream({ abortSignal }) {
        await new Promise<void>((_, reject) => {
          if (abortSignal?.aborted) {
            reject(new Error('aborted'));
            return;
          }
          abortSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
        yield { type: 'finish', reason: 'end_turn' };
      },
    };

    const handle = runTask(
      {
        resolveAgent: (id) => (id === 'sr-designer' ? srDesigner : id === 'jr-designer' ? jrDesigner : undefined),
        getMCPConnection: () => mcp,
        getModel: () => ({} as any),
        eventBus: bus,
        context: db.context,
        audit: db.audit,
        permissions,
        agentState: db.agentState,
        approvals: db.approvals,
      },
      { task, team, sessionId: 'sess-kill-all' },
    );

    setTimeout(() => handle.killSession(), 15);
    const result = await handle.result;
    expect(result.status).toBe('paused');
    expect(result.agentResults.every((r) => r.exitReason === 'error')).toBe(true);
  });

  it('fails the run when MCP connection cannot be acquired', async () => {
    const permissions = createPermissionMiddleware({ audit: db.audit });
    const handle = runTask(
      {
        resolveAgent: (id) => (id === 'sr-designer' ? srDesigner : id === 'jr-designer' ? jrDesigner : undefined),
        getMCPConnection: async () => {
          throw new Error('MCP spawn failed: ENOENT');
        },
        getModel: () => ((...args) => ({} as any))({ script: [textTurn('ok')] }),
        eventBus: bus,
        context: db.context,
        audit: db.audit,
        permissions,
        agentState: db.agentState,
        approvals: db.approvals,
      },
      { task, team, sessionId: 'sess-mcp-fail' },
    );
    const result = await handle.result;
    expect(result.status).toBe('failed');
    // all agents should have failed (never started)
    expect(result.agentResults.every((r) => r.exitReason !== 'completed')).toBe(true);
  });

  it('provider that throws marks only that agent failed, others complete', async () => {
    const mcp = makeFakeMCPConnection({ id: 'figma' });
    const permissions = createPermissionMiddleware({ audit: db.audit });

    const crashingProvider: LLMProvider = {
      id: 'mock',
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error('LLM provider exploded');
      },
    };

    const providers = new Map<string, LLMProvider>([
      ['sr-designer', crashingProvider],
      ['jr-designer', ((...args) => ({} as any))({ script: [textTurn('jr ok')] })],
    ]);

    const handle = runTask(
      {
        resolveAgent: (id) => (id === 'sr-designer' ? srDesigner : id === 'jr-designer' ? jrDesigner : undefined),
        getMCPConnection: () => mcp,
        getModel: (agent: any): any => getOrThrow(providers, agent.id),
        eventBus: bus,
        context: db.context,
        audit: db.audit,
        permissions,
        agentState: db.agentState,
        approvals: db.approvals,
      },
      { task, team, sessionId: 'sess-provider-crash' },
    );

    const result = await handle.result;
    expect(result.status).toBe('failed');
    const sr = result.agentResults.find((r) => r.agentId === 'sr-designer');
    const jr = result.agentResults.find((r) => r.agentId === 'jr-designer');
    expect(sr?.exitReason).toBe('error');
    expect(jr?.exitReason).toBe('completed');
  });

  it('empty team fails fast with a descriptive error', async () => {
    const permissions = createPermissionMiddleware({ audit: db.audit });
    const handle = runTask(
      {
        resolveAgent: () => undefined,
        getMCPConnection: () => makeFakeMCPConnection({}),
        getModel: () => ((...args) => ({} as any))({ script: [textTurn('ok')] }),
        eventBus: bus,
        context: db.context,
        audit: db.audit,
        permissions,
        agentState: db.agentState,
        approvals: db.approvals,
      },
      {
        task: { ...task, team_id: 'empty' },
        team: { team_id: 'empty', name: 'Empty', agents: [] },
        sessionId: 'sess-empty',
      },
    );
    const result = await handle.result;
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/team has no agents/);
  });

  it('auto mode routes through the planner and only spawns selected agents', async () => {
    const mcp = makeFakeMCPConnection({
      id: 'figma',
      tools: [
        { name: 'create_frame', description: '', inputSchema: { type: 'object', properties: {} } },
        { name: 'inspect_frame', description: '', inputSchema: { type: 'object', properties: {} } },
      ],
    });
    const permissions = createPermissionMiddleware({ audit: db.audit, agentState: db.agentState });

    const plannerProvider = ((...args) => ({} as any))({
      script: [
        textTurn(
          JSON.stringify({
            assignments: [
              { agentId: 'sr-designer', subprompt: 'Create the frame.', reason: 'has create_frame' },
            ],
          }),
        ),
      ],
    });
    const srProvider = ((...args) => ({} as any))({
      script: [toolTurn('s1', 'create_frame', { name: 'card' }), textTurn('done')],
    });
    const jrProvider = ((...args) => ({} as any))({
      script: [textTurn('should not run')],
    });

    const providerByAgent = new Map<string, LLMProvider>([
      ['sr-designer', srProvider],
      ['jr-designer', jrProvider],
    ]);
    let plannerCalls = 0;
    const getModel = (agent: AgentDef): LLMProvider => {
      if (plannerCalls === 0) {
        plannerCalls++;
        return plannerProvider;
      }
      return getOrThrow(providerByAgent, agent.id);
    };

    const handle = runTask(
      {
        resolveAgent: (id) => (id === 'sr-designer' ? srDesigner : id === 'jr-designer' ? jrDesigner : undefined),
        getMCPConnection: () => mcp,
        getModel: (() => ({} as any)) as any,
        eventBus: bus,
        context: db.context,
        audit: db.audit,
        permissions,
        agentState: db.agentState,
        approvals: db.approvals,
      },
      { task: { ...task, orchestrator_mode: 'auto' }, team, sessionId: 'sess-auto' },
    );

    const result = await handle.result;
    expect(result.status).toBe('completed');
    expect(result.agentResults.map((r) => r.agentId)).toEqual(['sr-designer']);
    expect(result.agentResults[0]?.toolCalls).toBe(1);
  });

  it('auto mode with dependsOn runs agents in waves and passes predecessor output', async () => {
    const mcp = makeFakeMCPConnection({
      id: 'figma',
      tools: [
        { name: 'create_frame', description: '', inputSchema: { type: 'object', properties: {} } },
        { name: 'inspect_frame', description: '', inputSchema: { type: 'object', properties: {} } },
      ],
    });
    const permissions = createPermissionMiddleware({ audit: db.audit, agentState: db.agentState });

    const plannerProvider = ((...args) => ({} as any))({
      script: [
        textTurn(
          JSON.stringify({
            assignments: [
              { agentId: 'sr-designer', subprompt: 'Create the card layout.', reason: 'has create_frame' },
              { agentId: 'jr-designer', subprompt: 'Review the card.', reason: 'has inspect_frame', dependsOn: ['sr-designer'] },
            ],
          }),
        ),
      ],
    });

    const srFinishedAt: number[] = [];
    const jrStartedAt: number[] = [];
    let jrReceivedPrompt = '';

    const srProvider = ((...args) => ({} as any))({
      script: [toolTurn('s1', 'create_frame', { name: 'card' }), textTurn('Frame created at /designs/card.fig')],
    });
    const jrProvider: LLMProvider = {
      id: 'mock',
      async *stream({ messages }) {
        jrStartedAt.push(Date.now());
        const userMsg = messages.find((m) => m.role === 'user');
        if (userMsg && typeof userMsg.content === 'string') jrReceivedPrompt = userMsg.content;
        yield { type: 'text', text: 'Looks good!' };
        yield { type: 'finish', reason: 'end_turn' };
      },
    };

    const providerByAgent = new Map<string, LLMProvider>([
      ['sr-designer', srProvider],
      ['jr-designer', jrProvider],
    ]);
    let plannerCalls = 0;
    const getModel = (agent: AgentDef): LLMProvider => {
      if (plannerCalls === 0) {
        plannerCalls++;
        return plannerProvider;
      }
      const p = providerByAgent.get(agent.id);
      if (!p) throw new Error(`no provider for ${agent.id}`);
      if (agent.id === 'sr-designer') {
        const orig = p;
        return {
          id: 'mock',
          async *stream(input) {
            yield* orig.stream(input);
            srFinishedAt.push(Date.now());
          },
        };
      }
      return p;
    };

    const handle = runTask(
      {
        resolveAgent: (id) => (id === 'sr-designer' ? srDesigner : id === 'jr-designer' ? jrDesigner : undefined),
        getMCPConnection: () => mcp,
        getModel: (() => ({} as any)) as any,
        eventBus: bus,
        context: db.context,
        audit: db.audit,
        permissions,
        agentState: db.agentState,
        approvals: db.approvals,
      },
      { task: { ...task, orchestrator_mode: 'auto' }, team, sessionId: 'sess-deps' },
    );

    const result = await handle.result;
    expect(result.status).toBe('completed');
    expect(result.agentResults).toHaveLength(2);
    expect(result.agentResults.map((r) => r.agentId).sort()).toEqual(['jr-designer', 'sr-designer']);

    // jr-designer should have received sr-designer's output in its prompt
    expect(jrReceivedPrompt).toContain('[Output from sr-designer]');
    expect(jrReceivedPrompt).toContain('Frame created at /designs/card.fig');
    expect(jrReceivedPrompt).toContain('Review the card.');
  });

  it('rejects slim execution mode until wiring lands', () => {
    const permissions = createPermissionMiddleware({ audit: db.audit });
    expect(() =>
      runTask(
        {
          resolveAgent: (id) => (id === 'sr-designer' ? srDesigner : undefined),
          getMCPConnection: () => makeFakeMCPConnection({}),
          getModel: () => ((...args) => ({} as any))({ script: [textTurn('ok')] }),
          eventBus: bus,
          context: db.context,
          audit: db.audit,
          permissions,
          agentState: db.agentState,
          approvals: db.approvals,
        },
        { task: { ...task, execution_mode: 'slim' }, team, sessionId: 'sess-slim' },
      ),
    ).toThrow(/only 'concurrent' execution/);
  });

  it('converts review_required into an approval record and approval_requested event', async () => {
    const mcp = makeFakeMCPConnection({ id: 'figma' });
    const permissions = createPermissionMiddleware({ audit: db.audit });

    const orchestratorEvents: UjimaEvent[] = [];
    bus.subscribe(ORCHESTRATOR_EVENT_CHANNEL, (e) => {
      orchestratorEvents.push(e);
    });

    const providers = new Map<string, LLMProvider>([
      [
        'sr-designer',
        ((...args) => ({} as any))({ script: [textTurn('all done for Sr')] }),
      ],
      [
        'jr-designer',
        ((...args) => ({} as any))({
          script: [textTurn('This frame requires approval from senior before shipping.')],
        }),
      ],
    ]);

    const handle = runTask(
      {
        resolveAgent: (id) => (id === 'sr-designer' ? srDesigner : id === 'jr-designer' ? jrDesigner : undefined),
        getMCPConnection: () => mcp,
        getModel: (agent: any): any => getOrThrow(providers, agent.id),
        eventBus: bus,
        context: db.context,
        audit: db.audit,
        permissions,
        agentState: db.agentState,
        approvals: db.approvals,
      },
      { task, team, sessionId: 'sess-approval' },
    );

    const result = await handle.result;
    expect(result.status).toBe('completed');
    expect(result.approvalsPending).toBe(1);

    const pending = await db.approvals.listByTask('task-profile', 'pending_approval');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.proposed_by).toBe('jr-designer');

    const approvalEvent = orchestratorEvents.find((e) => e.type === 'approval_requested');
    expect(approvalEvent).toBeDefined();
    expect((approvalEvent?.payload as { agent_id?: string })?.agent_id).toBe('jr-designer');
  });
});

describe('topoSortWaves', () => {
  it('puts agents with no deps in wave 0', () => {
    const waves = topoSortWaves([
      { agentId: 'a', subprompt: 'do A' },
      { agentId: 'b', subprompt: 'do B' },
    ]);
    expect(waves).toEqual([['a', 'b']]);
  });

  it('separates dependent agents into later waves', () => {
    const waves = topoSortWaves([
      { agentId: 'a', subprompt: 'do A' },
      { agentId: 'b', subprompt: 'do B', dependsOn: ['a'] },
      { agentId: 'c', subprompt: 'do C', dependsOn: ['b'] },
    ]);
    expect(waves).toEqual([['a'], ['b'], ['c']]);
  });

  it('groups parallel agents in the same wave', () => {
    const waves = topoSortWaves([
      { agentId: 'a', subprompt: 'search' },
      { agentId: 'b', subprompt: 'search too' },
      { agentId: 'c', subprompt: 'combine', dependsOn: ['a', 'b'] },
    ]);
    expect(waves).toEqual([['a', 'b'], ['c']]);
  });

  it('handles mixed parallel + dependent waves (build-a-site pattern)', () => {
    const waves = topoSortWaves([
      { agentId: 'designer', subprompt: 'Design the UI' },
      { agentId: 'db-engineer', subprompt: 'Build DB schema' },
      { agentId: 'frontend', subprompt: 'Build React app', dependsOn: ['designer'] },
      { agentId: 'backend', subprompt: 'Build the API', dependsOn: ['designer', 'db-engineer'] },
    ]);
    expect(waves).toEqual([
      ['designer', 'db-engineer'],
      ['frontend', 'backend'],
    ]);
  });

  it('breaks circular dependencies by forcing remaining into one wave', () => {
    const waves = topoSortWaves([
      { agentId: 'a', subprompt: 'x', dependsOn: ['b'] },
      { agentId: 'b', subprompt: 'y', dependsOn: ['a'] },
    ]);
    expect(waves).toHaveLength(1);
    expect(waves[0]?.sort()).toEqual(['a', 'b']);
  });

  it('returns empty array for empty assignments', () => {
    expect(topoSortWaves([])).toEqual([]);
  });
});
