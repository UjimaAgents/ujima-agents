import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkflowGraphSchema, type WorkflowGraph, type WorkflowNodeRun, type WorkflowRun } from '@ujima/shared';
import { WorkflowEngineService } from './workflow-engine.js';
import { LiveWorkflowEffects } from './workflow-effects-live.js';

// In-memory fake covering the union of methods the engine + adapter touch.
class FakeRepo {
  runs = new Map<string, WorkflowRun>();
  nodeRuns = new Map<string, WorkflowNodeRun>();
  messages: { content: string; threadId: string }[] = [];
  goalStarts: { title: string; tasks: unknown[] }[] = [];

  transaction<T>(fn: () => T): T {
    return fn();
  }
  getWorkflowDefinition() {
    return null;
  }
  getWorkflowDefinitionByName() {
    return null;
  }
  saveWorkflowRun(run: WorkflowRun) {
    this.runs.set(run.id, run);
    return run;
  }
  getWorkflowRun(_org: string, id: string) {
    return this.runs.get(id) ?? null;
  }
  listWorkflowRunsByStatus(_org: string, statuses: string[]) {
    return [...this.runs.values()].filter((r) => statuses.includes(r.status));
  }
  saveWorkflowNodeRun(nr: WorkflowNodeRun) {
    this.nodeRuns.set(nr.id, nr);
    return nr;
  }
  getWorkflowNodeRun(_runId: string, id: string) {
    return this.nodeRuns.get(id) ?? null;
  }
  getWorkflowNodeRunByChildRun(childRunId: string) {
    return [...this.nodeRuns.values()].find((nr) => nr.childRunId === childRunId) ?? null;
  }
  listWorkflowNodeRuns(runId: string) {
    return [...this.nodeRuns.values()].filter((nr) => nr.workflowRunId === runId);
  }
  listMembers() {
    return [{ id: 'eng', kind: 'agent', retiredAt: undefined }];
  }
  getRun(_org: string, runId: string) {
    return { id: runId, status: 'completed' };
  }
}

describe('LiveWorkflowEffects (integration)', () => {
  let tmp: string;
  let repo: FakeRepo;
  let engine: WorkflowEngineService;
  let spawned: { runId?: string; threadId: string }[];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'wf-'));
    repo = new FakeRepo();
    spawned = [];
    const effects = new LiveWorkflowEffects({
      repo: repo as never,
      conversations: {
        publishMessage: ((msg: { content: string; threadId: string }) => {
          repo.messages.push({ content: msg.content, threadId: msg.threadId });
          return msg;
        }) as never,
      },
      goals: {
        start: ((input: { title: string; tasks: unknown[] }) => {
          repo.goalStarts.push({ title: input.title, tasks: input.tasks });
          return { goal: { id: 'goal-1' }, tasks: [] };
        }) as never,
      },
      spirits: {
        createRun: async (input) => {
          spawned.push({ runId: input.runId, threadId: input.threadId });
          return { id: input.runId } as never;
        },
      },
      getWorkspaceRoot: () => tmp,
    });
    engine = new WorkflowEngineService(repo as never, effects);
    effects.setEngine(engine);
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  function sop(): WorkflowGraph {
    return WorkflowGraphSchema.parse({
      nodes: [
        { id: 't', kind: 'trigger', position: { x: 0, y: 0 }, config: { source: 'mention' } },
        { id: 'eng', kind: 'agent', position: { x: 1, y: 0 }, config: { agentId: 'eng', prompt: 'Do {{input}}', requiresApproval: false } },
        { id: 'goal', kind: 'goal_handoff', position: { x: 2, y: 0 }, config: { titleTemplate: '{{input}}', tasksFrom: 'json' } },
      ],
      edges: [
        { id: 'e1', source: 't', sourcePort: 'main', target: 'eng', targetPort: 'main' },
        { id: 'e2', source: 'eng', sourcePort: 'main', target: 'goal', targetPort: 'main' },
      ],
    });
  }

  const START = { organizationId: 'org1', input: 'ship auth', initiatedBy: 'u1', channelId: 'c1', threadId: 'th1' };

  /** Simulate the run-completed hook: the agent finished its turn. */
  async function finishAgentRun(runId: string) {
    await engine.onNodeComplete({
      organizationId: 'org1',
      workflowRunId: repo.getWorkflowNodeRunByChildRun(runId)!.workflowRunId,
      nodeRunId: repo.getWorkflowNodeRunByChildRun(runId)!.id,
      failed: false,
    });
  }

  it('runs the SOP end-to-end: prompt posted, output verified, goal handed off', async () => {
    const { workflowRunId } = await engine.startRun({ ...START, inlineGraph: sop(), name: 'build' });

    // spawnAgentNode posted the prompt (+ wake-context) and fired a run.
    expect(spawned).toHaveLength(1);
    expect(repo.messages.some((m) => m.content.includes('Do ship auth') && m.content.includes('workflow.advance'))).toBe(true);

    const engRunId = spawned[0]!.runId!;
    const nodeRun = repo.getWorkflowNodeRunByChildRun(engRunId)!;
    expect(nodeRun.nodeId).toBe('eng');

    // The agent writes its document + stashes an envelope (as workflow.advance would).
    const outPath = nodeRun.outputPath!;
    mkdirSync(dirname(join(tmp, outPath)), { recursive: true });
    writeFileSync(join(tmp, outPath), '# spec\n');
    repo.saveWorkflowNodeRun({ ...nodeRun, summary: 'spec drafted', outputJson: { tasks: [{ title: 'build it', assigneeId: 'eng' }] } });

    await finishAgentRun(engRunId);

    // Output verified (sha captured), goal handed off, run completed.
    const finalNode = repo.getWorkflowNodeRun('', nodeRun.id)!;
    expect(finalNode.status).toBe('completed');
    expect(finalNode.outputSha256).toBeTruthy();
    expect(repo.goalStarts).toHaveLength(1);
    expect(repo.goalStarts[0]!.tasks).toEqual([{ title: 'build it', assigneeId: 'eng' }]);
    expect(repo.getWorkflowRun('org1', workflowRunId)!.status).toBe('completed');
  });

  it('pauses + notifies when the agent writes no output', async () => {
    await engine.startRun({ ...START, inlineGraph: sop(), name: 'build' });
    const engRunId = spawned[0]!.runId!;
    // No file written, no json stashed -> auto-advance verify fails.
    await finishAgentRun(engRunId);

    const run = [...repo.runs.values()][0]!;
    expect(run.status).toBe('paused');
    expect(repo.messages.some((m) => m.content.includes('no output'))).toBe(true);
    expect(repo.goalStarts).toHaveLength(0);
  });

  it('statOutput verifies a real file on disk', async () => {
    await engine.startRun({ ...START, inlineGraph: sop(), name: 'build' });
    const engRunId = spawned[0]!.runId!;
    const nodeRun = repo.getWorkflowNodeRunByChildRun(engRunId)!;
    mkdirSync(dirname(join(tmp, nodeRun.outputPath!)), { recursive: true });
    writeFileSync(join(tmp, nodeRun.outputPath!), 'hello');
    expect(existsSync(join(tmp, nodeRun.outputPath!))).toBe(true);
    await finishAgentRun(engRunId);
    expect(repo.getWorkflowNodeRun('', nodeRun.id)!.outputSizeBytes).toBe(5);
  });
});
