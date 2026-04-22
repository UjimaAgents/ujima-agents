import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDef, TaskDef, UjimaEvent } from '@ujima/shared';
import { openDb, type UjimaDb } from '@ujima/context-store';
import { createLocalEventBus, type EventBus } from '@ujima/event-bus';
import { createPermissionMiddleware } from '@ujima/permissions';
import {
  createMockProvider,
  textTurn,
  toolTurn,
  type LLMMessage,
  type LLMProvider,
} from '@ujima/llm';
import { runConcurrent } from './concurrent';
import { makeFakeMCPConnection } from './test-helpers';

const srAgent: AgentDef = {
  id: 'sr-designer',
  name: 'Sr Designer',
  persona: 'You publish frames for review.',
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

const jrAgent: AgentDef = {
  id: 'jr-designer',
  name: 'Jr Designer',
  persona: 'You review Sr frames and annotate them.',
  model: 'mock',
  mcp: 'figma',
  permissions: {
    allowed_tools: ['inspect_frame'],
    blocked_tools: [],
    rate_limit: { calls_per_minute: 30, max_session_tokens: 100_000 },
  },
  communication: { publishes: ['review:frames'], subscribes: ['design:frames'] },
  escalation: { conditions: [], escalate_to: 'human' },
};

const task: TaskDef = {
  task_id: 'task-demo',
  prompt: 'Design and review a user profile card',
  orchestrator_mode: 'manual',
  execution_mode: 'concurrent',
};

describe('runConcurrent — Sr + Jr on shared MCP', () => {
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

  it('runs two agents in parallel, shares a single MCP, and surfaces peer work to Jr mid-task', async () => {
    const mcpCalls: { agentId: string; toolName: string }[] = [];
    const srFinished = new Promise<void>((resolve) => {
      bus.subscribe('design:frames', (e) => {
        if (e.type === 'agent_exited' && e.publisher === 'sr-designer') resolve();
      });
    });

    const mcp = makeFakeMCPConnection({
      id: 'figma',
      tools: [
        { name: 'create_frame', description: 'Create a Figma frame', inputSchema: { type: 'object', properties: {} } },
        { name: 'inspect_frame', description: 'Inspect a frame', inputSchema: { type: 'object', properties: {} } },
      ],
      onCall: async (ctx, toolName, args) => {
        mcpCalls.push({ agentId: ctx.agentId, toolName });
        if (toolName === 'create_frame') {
          await db.context.put(`task:${ctx.taskId}:design:frames:frame-1`, {
            name: (args as { name?: string }).name ?? 'profile-card',
            author: ctx.agentId,
          });
        }
        return { ok: true };
      },
    });

    const srProvider = createMockProvider({
      script: [
        toolTurn('s1', 'create_frame', { name: 'profile-card' }, 'shipping frame'),
        textTurn('frame published'),
      ],
    });

    let jrIter2Messages: LLMMessage[] | undefined;
    const jrProvider: LLMProvider = {
      id: 'mock',
      async *stream(input) {
        const assistantTurns = input.messages.filter((m) => m.role === 'assistant').length;
        if (assistantTurns === 0) {
          await srFinished;
          yield { type: 'tool_call', id: 'j1', name: 'inspect_frame', arguments: { frame: 'initial' } };
          yield { type: 'finish', reason: 'tool_use' };
          return;
        }
        jrIter2Messages = input.messages;
        yield { type: 'text', text: 'Reviewed Sr published frame.' };
        yield { type: 'finish', reason: 'end_turn' };
      },
    };

    const permissions = createPermissionMiddleware({ audit: db.audit, agentState: db.agentState });

    const busEvents: UjimaEvent[] = [];
    bus.subscribe('design:frames', (e) => {
      busEvents.push(e);
    });
    bus.subscribe('review:frames', (e) => {
      busEvents.push(e);
    });

    const handle = runConcurrent({
      members: [
        {
          agent: srAgent,
          task,
          sessionId: 'sess-1',
          spawnReason: 'initial',
          provider: srProvider,
          mcp,
          permissions,
          eventBus: bus,
          context: db.context,
          audit: db.audit,
          agentState: db.agentState,
          heartbeatIntervalMs: 1000,
        },
        {
          agent: jrAgent,
          task,
          sessionId: 'sess-1',
          spawnReason: 'initial',
          provider: jrProvider,
          mcp,
          permissions,
          eventBus: bus,
          context: db.context,
          audit: db.audit,
          agentState: db.agentState,
          heartbeatIntervalMs: 1000,
        },
      ],
    });

    expect(handle.handles).toHaveLength(2);
    const results = await handle.results;
    const [srResult, jrResult] = results;
    if (!srResult || !jrResult) throw new Error('expected two results');

    expect(srResult.exitReason).toBe('completed');
    expect(jrResult.exitReason).toBe('completed');
    expect(srResult.toolCalls).toBe(1);
    expect(jrResult.toolCalls).toBe(1);

    expect(mcpCalls).toEqual(
      expect.arrayContaining([
        { agentId: 'sr-designer', toolName: 'create_frame' },
        { agentId: 'jr-designer', toolName: 'inspect_frame' },
      ]),
    );

    const toolAudit = await db.audit.query({ eventType: 'tool_call' });
    const agentsInAudit = new Set(toolAudit.map((r) => r.agent_id));
    expect(agentsInAudit.has('sr-designer')).toBe(true);
    expect(agentsInAudit.has('jr-designer')).toBe(true);

    const srOutput = await db.context.get('task:task-demo:agent:sr-designer:output');
    const jrOutput = await db.context.get('task:task-demo:agent:jr-designer:output');
    expect(srOutput).toMatchObject({ exitReason: 'completed' });
    expect(jrOutput).toMatchObject({ exitReason: 'completed' });

    const srExitEvents = busEvents.filter(
      (e) => e.type === 'agent_exited' && e.publisher === 'sr-designer',
    );
    expect(srExitEvents).toHaveLength(1);

    expect(jrIter2Messages).toBeDefined();
    const peerNote = jrIter2Messages?.find(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[ujima] Peer activity'),
    );
    expect(peerNote).toBeDefined();
    expect(typeof peerNote?.content === 'string' && peerNote.content).toMatch(/sr-designer/);
  });

  it('killAll aborts every member mid-flight', async () => {
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

    const handle = runConcurrent({
      members: [
        {
          agent: srAgent,
          task,
          sessionId: 'sess-kill',
          spawnReason: 'initial',
          provider: slowProvider,
          mcp,
          permissions,
          eventBus: bus,
          context: db.context,
          audit: db.audit,
          agentState: db.agentState,
        },
        {
          agent: jrAgent,
          task,
          sessionId: 'sess-kill',
          spawnReason: 'initial',
          provider: slowProvider,
          mcp,
          permissions,
          eventBus: bus,
          context: db.context,
          audit: db.audit,
          agentState: db.agentState,
        },
      ],
    });

    setTimeout(() => handle.killAll(), 10);
    const results = await handle.results;
    const [a, b] = results;
    if (!a || !b) throw new Error('expected two results');
    expect(a.exitReason).toBe('error');
    expect(b.exitReason).toBe('error');
    expect(handle.handles.every((h) => !h.isRunning())).toBe(true);
  });
});
