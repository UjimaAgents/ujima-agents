import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDef, TaskDef, UjimaEvent } from '@ujima/shared';
import { openDb, type UjimaDb } from '@ujima/context-store';
import { createLocalEventBus, type EventBus } from '@ujima/event-bus';
import { createPermissionMiddleware } from '@ujima/permissions';
import { createMockProvider, textTurn, toolTurn } from '@ujima/llm/legacy';
import { runAgent } from './shell';
import { hydrate } from './hydrate';
import { createLanguageModelFromLegacyProvider } from './legacy-llm-language-model';
import { makeFakeMCPConnection } from './test-helpers';

const baseAgent: AgentDef = {
  id: 'sr-designer',
  name: 'Sr Designer',
  persona: 'You ship beautiful Figma frames.',
  model: 'mock',
  mcp: 'figma',
  permissions: {
    allowed_tools: ['echo'],
    blocked_tools: ['delete_file'],
    rate_limit: { max_session_tokens: 100_000 },
  },
  communication: { publishes: ['design:frames'], subscribes: [] },
  escalation: { conditions: ['requires approval'], escalate_to: 'human' },
};

const task: TaskDef = {
  task_id: 'task-demo',
  prompt: 'Design a user profile card',
  orchestrator_mode: 'manual',
  execution_mode: 'concurrent',
};

describe('runAgent — single-agent end-to-end', () => {
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

  it('runs a tool loop, logs audit entries, and publishes agent_exited', async () => {
    const _provider = createMockProvider({
      script: [toolTurn('call_1', 'echo', { msg: 'hi' }, 'calling echo'), textTurn('all done')],
    });
    const mcp = makeFakeMCPConnection({ id: 'figma' });
    const permissions = createPermissionMiddleware({ audit: db.audit, agentState: db.agentState });

    const events: UjimaEvent[] = [];
    bus.subscribe('design:frames', (e) => {
      events.push(e);
    });

    const handle = runAgent({
      agent: baseAgent,
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
      heartbeatIntervalMs: 1000,
    });

    const result = await handle.result;
    expect(result.exitReason).toBe('completed');
    expect(result.toolCalls).toBe(1);
    expect(result.finalText).toContain('all done');

    const toolCalls = await db.audit.query({ eventType: 'tool_call' });
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.tool_name).toBe('echo');
    const spawns = await db.audit.query({ eventType: 'spawn' });
    expect(spawns).toHaveLength(1);
    const exits = await db.audit.query({ eventType: 'exit' });
    expect(exits).toHaveLength(1);

    expect(events.some((e) => e.type === 'agent_exited')).toBe(true);
    const output = await db.context.get('task:task-demo:agent:sr-designer:output');
    expect(output).toMatchObject({ exitReason: 'completed', toolCalls: 1 });
  });

  it('blocks disallowed tools and feeds the denial back to the LLM', async () => {
    const onCall = vi.fn();
    const _provider = createMockProvider({
      script: [toolTurn('c1', 'delete_file', { path: '/etc' }), textTurn('ok I stopped')],
      onCall,
    });
    const mcp = makeFakeMCPConnection({
      id: 'figma',
      tools: [
        {
          name: 'echo',
          description: 'echo a message',
          inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
        },
        {
          name: 'delete_file',
          description: 'delete a file',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ],
    });
    const permissions = createPermissionMiddleware({ audit: db.audit });

    const handle = runAgent({
      agent: baseAgent,
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
    });
    const result = await handle.result;
    expect(result.exitReason).toBe('completed');
    expect(result.toolCalls).toBe(1);

    const permChecks = await db.audit.query({ eventType: 'permission_check' });
    expect(permChecks.some((r) => !r.allowed)).toBe(true);
    const toolCalls = await db.audit.query({ eventType: 'tool_call' });
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.allowed).toBe(false);
  });

  it('keeps task text out of the cacheable system prompt', async () => {
    const first = await hydrate({
      agent: baseAgent,
      task: { ...task, task_id: 'task-a', prompt: 'Design a user profile card' },
      sessionId: 's1',
      context: db.context,
      eventBus: bus,
    });
    const second = await hydrate({
      agent: baseAgent,
      task: { ...task, task_id: 'task-b', prompt: 'Create the card layout.' },
      sessionId: 's1',
      context: db.context,
      eventBus: bus,
    });

    expect(first.systemPrompt).toBe(second.systemPrompt);
    expect(first.systemPrompt).not.toContain('Design a user profile card');
    expect(first.taskPrompt).toContain('Design a user profile card');
    expect(second.taskPrompt).toContain('Create the card layout.');
  });

});
