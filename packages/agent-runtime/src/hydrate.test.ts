import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDef, TaskDef } from '@ujima/shared';
import { openDb, type UjimaDb } from '@ujima/context-store';
import { createLocalEventBus, type EventBus } from '@ujima/event-bus';
import { hydrate } from './hydrate';

const agent: AgentDef = {
  id: 'jr-designer',
  name: 'Jr Designer',
  persona: 'You design UI components.',
  model: 'mock',
  mcp: 'figma',
  permissions: {
    allowed_tools: [],
    blocked_tools: [],
    rate_limit: { max_session_tokens: 100_000 },
  },
  communication: {
    publishes: ['design:frames'],
    subscribes: ['design:tokens'],
  },
  escalation: { conditions: [], escalate_to: 'human' },
};

const task: TaskDef = {
  task_id: 't1',
  prompt: 'Build a user profile card',
  orchestrator_mode: 'manual',
  execution_mode: 'concurrent',
};

describe('hydrate', () => {
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

  it('produces a system prompt containing persona, task, and recent events', async () => {
    await bus.publish('design:tokens', {
      event_id: 'e1',
      type: 'tokens.ready',
      publisher: 'sr-designer',
      timestamp: new Date().toISOString(),
      task_id: 't1',
      session_id: 's1',
      payload: { palette: 'spring-2026' },
    });

    const bundle = await hydrate({ agent, task, context: db.context, eventBus: bus });

    expect(bundle.persona).toContain('design UI components');
    expect(bundle.taskPrompt).toBe('Build a user profile card');
    expect(bundle.events).toHaveLength(1);
    expect(bundle.systemPrompt).toContain('Jr Designer');
    expect(bundle.systemPrompt).toContain('Build a user profile card');
    expect(bundle.systemPrompt).toContain('tokens.ready');
  });

  it('pulls peer outputs for subscribed channels', async () => {
    await db.context.put('task:t1:design:tokens:palette', { name: 'spring-2026' });
    const bundle = await hydrate({ agent, task, context: db.context, eventBus: bus });
    expect(bundle.peerOutputs).toHaveLength(1);
    expect(bundle.peerOutputs[0]?.key).toBe('task:t1:design:tokens:palette');
    expect(bundle.systemPrompt).toContain('Peer outputs');
  });
});
