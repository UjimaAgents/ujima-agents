import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDef, TaskDef } from '@ujima/shared';
import { emptyGovernancePolicy, setAgentRule } from '@ujima/shared';
import { openDb, type UjimaDb } from '@ujima/context-store';
import { createLocalEventBus, type EventBus } from '@ujima/event-bus';
import { createPermissionMiddleware } from '@ujima/permissions';
import { createMockProvider, textTurn, toolTurn } from '@ujima/llm/legacy';
import { runAgent } from './shell';
import { createLanguageModelFromLegacyProvider, makeFakeMCPConnection } from './test-helpers';

const agent: AgentDef = {
  id: 'writer',
  name: 'Writer',
  persona: 'You write docs.',
  model: 'mock',
  mcp: 'fs',
  permissions: {
    allowed_tools: ['write_file'],
    blocked_tools: [],
    rate_limit: { max_session_tokens: 100_000 },
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

  it('blocks tool call when require_approval is triggered, returning block to LLM', async () => {
    const onCall = vi.fn();
    const _provider = createMockProvider({
      script: [
        toolTurn('t1', 'write_file', { path: '/x.md', body: 'hi' }),
        textTurn('permission denied, stopped'),
      ],
    });
    const mcp = makeFakeMCPConnection({ id: 'fs', tools: fsWriteTool(), onCall });
    const permissions = createPermissionMiddleware({
      audit: db.audit,
      governancePolicy: approvalPolicy(),
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
    });

    const result = await handle.result;
    expect(result.exitReason).toBe('completed');
    expect(result.finalText).toContain('permission denied');
    expect(onCall).not.toHaveBeenCalled();

    const toolCalls = await db.audit.query({ eventType: 'tool_call' });
    const rejected = toolCalls.find((r) => !r.allowed);
    expect(rejected?.block_reason).toContain('requires human approval before running');
  });
});
