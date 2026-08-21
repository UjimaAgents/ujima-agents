import { describe, expect, it, vi } from 'vitest';
import type { WorkflowDefinition } from '@ujima/shared';
import {
  workflowAdvanceTool,
  workflowListTool,
  workflowRunTool,
  workflowTransitionTool,
  workflowViewTool,
} from './workflow.js';
import type { ToolExecutionContext } from './types.js';

function def(name: string, nodeCount: number): WorkflowDefinition {
  return {
    id: `def-${name}`,
    organizationId: 'org1',
    name,
    description: `${name} desc`,
    nodes: Array.from({ length: nodeCount }, (_, i) => ({
      id: `n${i}`,
      kind: 'agent' as const,
      position: { x: 0, y: 0 },
      config: { agentId: 'a', prompt: '', requiresApproval: false },
    })),
    edges: [],
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function ctx(overrides: {
  input?: unknown;
  runId?: string;
  repo?: Partial<ToolExecutionContext['repo']>;
  workflowEngine?: ToolExecutionContext['workflowEngine'];
}): ToolExecutionContext {
  return {
    invocation: {
      organizationId: 'org1',
      memberId: 'm1',
      threadId: 'th1',
      runId: overrides.runId,
      input: overrides.input ?? {},
    },
    repo: {
      getThread: () => ({ channelId: 'c1' }),
      ...overrides.repo,
    },
    workflowEngine: overrides.workflowEngine,
  } as unknown as ToolExecutionContext;
}

describe('workflow.list', () => {
  it('returns name/description/node_count', async () => {
    const result = (await workflowListTool.execute(
      ctx({ repo: { listWorkflowDefinitions: () => [def('build', 3), def('review', 2)] } }),
    )) as { workflows: { name: string; node_count: number }[] };
    expect(result.workflows).toEqual([
      { name: 'build', description: 'build desc', node_count: 3 },
      { name: 'review', description: 'review desc', node_count: 2 },
    ]);
  });
});

describe('workflow.view', () => {
  it('returns the graph when found', async () => {
    const result = (await workflowViewTool.execute(
      ctx({ input: { name: 'build' }, repo: { getWorkflowDefinitionByName: () => def('build', 2) } }),
    )) as { ok: boolean; graph: { nodes: unknown[] } };
    expect(result.ok).toBe(true);
    expect(result.graph.nodes).toHaveLength(2);
  });

  it('errors when not found', async () => {
    const result = (await workflowViewTool.execute(
      ctx({ input: { name: 'missing' }, repo: { getWorkflowDefinitionByName: () => null } }),
    )) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
  });
});

describe('workflow.advance', () => {
  it('delegates the envelope to the engine (no repo write in the tool)', async () => {
    const advance = vi.fn().mockResolvedValue({ ok: true });
    const save = vi.fn();
    const result = (await workflowAdvanceTool.execute(
      ctx({
        runId: 'run-123',
        input: { summary: 'BRD done', json: { tasks: 3 } },
        repo: { saveWorkflowNodeRun: save },
        workflowEngine: { startRun: vi.fn(), transition: vi.fn(), advance },
      }),
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(advance).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org1',
        runId: 'run-123',
        summary: 'BRD done',
        json: { tasks: 3 },
      }),
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('errors when the run is not a workflow node run', async () => {
    const advance = vi.fn().mockResolvedValue({ ok: false, error: 'this run is not a workflow node run' });
    const result = (await workflowAdvanceTool.execute(
      ctx({
        runId: 'run-x',
        input: { summary: 's' },
        workflowEngine: { startRun: vi.fn(), transition: vi.fn(), advance },
      }),
    )) as { ok: boolean };
    expect(result.ok).toBe(false);
  });

  it('errors when the engine is not wired', async () => {
    const result = (await workflowAdvanceTool.execute(
      ctx({ runId: 'run-x', input: { summary: 's' } }),
    )) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not available/);
  });
});

describe('workflow.run', () => {
  it('starts a run via the engine', async () => {
    const startRun = vi.fn().mockResolvedValue({ workflowRunId: 'wr-9' });
    const result = (await workflowRunTool.execute(
      ctx({ input: { name: 'build', input: 'Add auth' }, workflowEngine: { startRun, transition: vi.fn(), advance: vi.fn() } }),
    )) as { ok: boolean; workflow_run_id: string };
    expect(result.ok).toBe(true);
    expect(result.workflow_run_id).toBe('wr-9');
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({ definitionName: 'build', input: 'Add auth', channelId: 'c1', threadId: 'th1' }),
    );
  });

  it('errors when the engine is not wired', async () => {
    const result = (await workflowRunTool.execute(ctx({ input: { name: 'build', input: '' } }))) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not available/);
  });
});

describe('workflow.transition', () => {
  it('delegates to the engine', async () => {
    const transition = vi.fn().mockResolvedValue({ ok: true, idempotent: false });
    const result = (await workflowTransitionTool.execute(
      ctx({
        input: { run_id: 'wr1', action: 'approve', idempotency_key: 'k1' },
        workflowEngine: { startRun: vi.fn(), transition, advance: vi.fn() },
      }),
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({ workflowRunId: 'wr1', action: 'approve', idempotencyKey: 'k1' }),
    );
  });
});
