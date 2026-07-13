import {beforeEach, describe, expect, it} from 'vitest';
import {
  WorkflowGraphSchema,
  type WorkflowDefinition,
  type WorkflowGraph,
  type WorkflowNodeRun,
  type WorkflowRun,
} from '@ujima/shared';
import {
  WorkflowEngineService,
  type NotifyInitiatorInput,
  type RaiseApprovalInput,
  type SpawnAgentNodeInput,
  type StartGoalInput,
  type StatOutputInput,
  type WorkflowEffects,
  type WorkflowEngineStore,
} from './workflow-engine.js';

// --- Fakes ----------------------------------------------------------------

class FakeStore implements WorkflowEngineStore {
  runs = new Map<string, WorkflowRun>();
  nodeRuns = new Map<string, WorkflowNodeRun>();
  defs = new Map<string, WorkflowDefinition>();
  defsByName = new Map<string, WorkflowDefinition>();

  transaction<T>(fn: () => T): T {
    return fn();
  }
  getWorkflowDefinition(_org: string, id: string) {
    return this.defs.get(id) ?? null;
  }
  getWorkflowDefinitionByName(_org: string, name: string) {
    return this.defsByName.get(name) ?? null;
  }
  saveWorkflowRun(run: WorkflowRun) {
    this.runs.set(run.id, run);
    return run;
  }
  getWorkflowRun(org: string, id: string) {
    const r = this.runs.get(id);
    return r && r.organizationId === org ? r : null;
  }
  listWorkflowRunsByStatus(org: string, statuses: string[]) {
    return [...this.runs.values()].filter(
      (r) => r.organizationId === org && statuses.includes(r.status),
    );
  }
  saveWorkflowNodeRun(nr: WorkflowNodeRun) {
    this.nodeRuns.set(nr.id, nr);
    return nr;
  }
  getWorkflowNodeRun(runId: string, id: string) {
    const nr = this.nodeRuns.get(id);
    return nr && nr.workflowRunId === runId ? nr : null;
  }
  listWorkflowNodeRuns(runId: string) {
    return [...this.nodeRuns.values()].filter((nr) => nr.workflowRunId === runId);
  }
}

function makeEffects(opts?: {statOutput?: (i: StatOutputInput) => {sha256: string; sizeBytes: number} | null}) {
  const spawns: SpawnAgentNodeInput[] = [];
  const goals: StartGoalInput[] = [];
  const approvals: RaiseApprovalInput[] = [];
  const notifications: NotifyInitiatorInput[] = [];
  const effects: WorkflowEffects = {
    async spawnAgentNode(input) {
      spawns.push(input);
      return {childRunId: `child-${input.nodeRunId}`};
    },
    async raiseApproval(input) {
      approvals.push(input);
      return {approvalRequestId: `appr-${input.nodeRunId}`};
    },
    async startGoal(input) {
      goals.push(input);
      return {goalId: 'goal-1'};
    },
    async statOutput(input) {
      return opts?.statOutput ? opts.statOutput(input) : {sha256: 'sha', sizeBytes: 100};
    },
    async notifyInitiator(input) {
      notifications.push(input);
    },
  };
  return {effects, spawns, goals, approvals, notifications};
}

// --- Graph builders -------------------------------------------------------

function agent(id: string, prompt = '', outputPath?: string) {
  return {id, kind: 'agent', position: {x: 0, y: 0}, config: {agentId: id, prompt, outputPath}};
}
function edge(source: string, target: string, port = 'main') {
  return {id: `${source}->${target}:${port}`, source, sourcePort: port, target, targetPort: port};
}
const trigger = {id: 't', kind: 'trigger', position: {x: 0, y: 0}, config: {source: 'mention'}};

function graph(nodes: unknown[], edges: unknown[]): WorkflowGraph {
  return WorkflowGraphSchema.parse({nodes, edges});
}

const START = {
  organizationId: 'org1',
  input: 'Add user auth',
  initiatedBy: 'u1',
  channelId: 'c1',
  threadId: 'th1',
};

// --- Tests ----------------------------------------------------------------

describe('WorkflowEngineService', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  it('runs a linear SOP: trigger -> agent -> goal_handoff', async () => {
    const {effects, spawns, goals} = makeEffects();
    const engine = new WorkflowEngineService(store, effects);
    const g = graph(
      [
        trigger,
        agent('pm', 'Write a BRD for {{input}}'),
        {id: 'goal', kind: 'goal_handoff', position: {x: 0, y: 0}, config: {titleTemplate: '{{input}}', tasksFrom: 'json'}},
      ],
      [edge('t', 'pm'), edge('pm', 'goal')],
    );

    const {workflowRunId} = await engine.startRun({...START, inlineGraph: g, name: 'build'});

    expect(spawns).toHaveLength(1);
    expect(spawns[0]!.agentId).toBe('pm');
    expect(spawns[0]!.prompt).toBe('Write a BRD for Add user auth');
    expect(store.getWorkflowRun('org1', workflowRunId)!.status).toBe('running');

    await engine.onNodeComplete({
      organizationId: 'org1',
      workflowRunId,
      nodeRunId: spawns[0]!.nodeRunId,
      summary: 'BRD drafted',
      json: {tasks: [{title: 'Build auth'}]},
    });

    expect(goals).toHaveLength(1);
    expect(goals[0]!.title).toBe('Add user auth');
    expect(goals[0]!.tasks).toEqual([{title: 'Build auth'}]);
    expect(store.getWorkflowRun('org1', workflowRunId)!.status).toBe('completed');
  });

  it('passes the envelope downstream via tokens', async () => {
    const {effects, spawns} = makeEffects();
    const engine = new WorkflowEngineService(store, effects);
    const g = graph(
      [
        trigger,
        agent('pm', 'Write BRD for {{input}}'),
        agent('eng', 'Read {{nodes.pm.output}} — summary: {{nodes.pm.summary}}'),
        {id: 'goal', kind: 'goal_handoff', position: {x: 0, y: 0}, config: {titleTemplate: 't', tasksFrom: 'json'}},
      ],
      [edge('t', 'pm'), edge('pm', 'eng'), edge('eng', 'goal')],
    );
    const {workflowRunId} = await engine.startRun({...START, inlineGraph: g, name: 'build'});

    await engine.onNodeComplete({
      organizationId: 'org1',
      workflowRunId,
      nodeRunId: spawns[0]!.nodeRunId,
      summary: 'PM SUMMARY',
    });

    expect(spawns).toHaveLength(2);
    expect(spawns[1]!.agentId).toBe('eng');
    expect(spawns[1]!.prompt).toContain(`workflows/${workflowRunId}/pm.md`);
    expect(spawns[1]!.prompt).toContain('PM SUMMARY');
  });

  it('fans out to all main successors when a node completes', async () => {
    const {effects, spawns} = makeEffects();
    const engine = new WorkflowEngineService(store, effects);
    const g = graph(
      [trigger, agent('a'), agent('b'), agent('c')],
      [edge('t', 'a'), edge('a', 'b'), edge('a', 'c')],
    );
    const {workflowRunId} = await engine.startRun({...START, inlineGraph: g, name: 'fan'});

    expect(spawns.map((s) => s.agentId)).toEqual(['a']);
    await engine.onNodeComplete({organizationId: 'org1', workflowRunId, nodeRunId: spawns[0]!.nodeRunId, summary: 'a done'});
    expect(spawns.map((s) => s.agentId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('merges: a node with two predecessors waits for both', async () => {
    const {effects, spawns} = makeEffects();
    const engine = new WorkflowEngineService(store, effects);
    const g = graph(
      [trigger, agent('a'), agent('b'), agent('c')],
      [edge('t', 'a'), edge('t', 'b'), edge('a', 'c'), edge('b', 'c')],
    );
    const {workflowRunId} = await engine.startRun({...START, inlineGraph: g, name: 'merge'});
    expect(spawns.map((s) => s.agentId).sort()).toEqual(['a', 'b']);

    const aRun = spawns.find((s) => s.agentId === 'a')!;
    const bRun = spawns.find((s) => s.agentId === 'b')!;

    await engine.onNodeComplete({organizationId: 'org1', workflowRunId, nodeRunId: aRun.nodeRunId, summary: 'a'});
    expect(spawns.some((s) => s.agentId === 'c')).toBe(false); // still waiting for b

    await engine.onNodeComplete({organizationId: 'org1', workflowRunId, nodeRunId: bRun.nodeRunId, summary: 'b'});
    expect(spawns.some((s) => s.agentId === 'c')).toBe(true); // both done -> c dispatched
  });

  it('pauses at an approval node and resumes on approve', async () => {
    const {effects, spawns, approvals} = makeEffects();
    const engine = new WorkflowEngineService(store, effects);
    const g = graph(
      [
        trigger,
        agent('pm'),
        {id: 'gate', kind: 'approval', position: {x: 0, y: 0}, config: {}},
        agent('eng'),
      ],
      [edge('t', 'pm'), edge('pm', 'gate'), edge('gate', 'eng')],
    );
    const {workflowRunId} = await engine.startRun({...START, inlineGraph: g, name: 'gated'});

    await engine.onNodeComplete({organizationId: 'org1', workflowRunId, nodeRunId: spawns[0]!.nodeRunId, summary: 'PM done'});
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.summaryOfPriorStep).toBe('PM done');
    expect(store.getWorkflowRun('org1', workflowRunId)!.status).toBe('awaiting_approval');
    expect(spawns.some((s) => s.agentId === 'eng')).toBe(false);

    const res = await engine.transition({organizationId: 'org1', workflowRunId, action: 'approve', idempotencyKey: 'k1'});
    expect(res.ok).toBe(true);
    expect(spawns.some((s) => s.agentId === 'eng')).toBe(true);
    expect(store.getWorkflowRun('org1', workflowRunId)!.status).toBe('running');
  });

  it('transitions are idempotent by key (double approve does not double-dispatch)', async () => {
    const {effects, spawns} = makeEffects();
    const engine = new WorkflowEngineService(store, effects);
    const g = graph(
      [trigger, agent('pm'), {id: 'gate', kind: 'approval', position: {x: 0, y: 0}, config: {}}, agent('eng')],
      [edge('t', 'pm'), edge('pm', 'gate'), edge('gate', 'eng')],
    );
    const {workflowRunId} = await engine.startRun({...START, inlineGraph: g, name: 'gated'});
    await engine.onNodeComplete({organizationId: 'org1', workflowRunId, nodeRunId: spawns[0]!.nodeRunId, summary: 'x'});

    await engine.transition({organizationId: 'org1', workflowRunId, action: 'approve', idempotencyKey: 'k1'});
    const afterFirst = spawns.length;
    const second = await engine.transition({organizationId: 'org1', workflowRunId, action: 'approve', idempotencyKey: 'k1'});
    expect(second.idempotent).toBe(true);
    expect(spawns.length).toBe(afterFirst);
  });

  it('fails + pauses when an agent produces no output (auto-advance verify)', async () => {
    const {effects, spawns, notifications} = makeEffects({statOutput: () => null});
    const engine = new WorkflowEngineService(store, effects);
    const g = graph(
      [trigger, agent('pm'), {id: 'goal', kind: 'goal_handoff', position: {x: 0, y: 0}, config: {titleTemplate: 't', tasksFrom: 'json'}}],
      [edge('t', 'pm'), edge('pm', 'goal')],
    );
    const {workflowRunId} = await engine.startRun({...START, inlineGraph: g, name: 'x'});

    await engine.onNodeComplete({organizationId: 'org1', workflowRunId, nodeRunId: spawns[0]!.nodeRunId, summary: 'no file'});
    expect(store.getWorkflowRun('org1', workflowRunId)!.status).toBe('paused');
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.reason).toContain('no output');
  });

  it('retry respawns the failed node as a new attempt', async () => {
    let calls = 0;
    const {effects, spawns} = makeEffects({
      statOutput: () => (calls++ === 0 ? null : {sha256: 'sha', sizeBytes: 5}),
    });
    const engine = new WorkflowEngineService(store, effects);
    const g = graph(
      [trigger, agent('pm'), {id: 'goal', kind: 'goal_handoff', position: {x: 0, y: 0}, config: {titleTemplate: 't', tasksFrom: 'json'}}],
      [edge('t', 'pm'), edge('pm', 'goal')],
    );
    const {workflowRunId} = await engine.startRun({...START, inlineGraph: g, name: 'x'});

    await engine.onNodeComplete({organizationId: 'org1', workflowRunId, nodeRunId: spawns[0]!.nodeRunId, summary: 'fail'});
    expect(store.getWorkflowRun('org1', workflowRunId)!.status).toBe('paused');

    await engine.transition({organizationId: 'org1', workflowRunId, action: 'retry', idempotencyKey: 'r1'});
    expect(spawns).toHaveLength(2); // pm respawned
    await engine.onNodeComplete({organizationId: 'org1', workflowRunId, nodeRunId: spawns[1]!.nodeRunId, summary: 'ok'});
    expect(store.getWorkflowRun('org1', workflowRunId)!.status).toBe('completed');
  });

  it('skip marks the failed node skipped and advances', async () => {
    const {effects, spawns, goals} = makeEffects({statOutput: () => null});
    const engine = new WorkflowEngineService(store, effects);
    const g = graph(
      [trigger, agent('pm'), {id: 'goal', kind: 'goal_handoff', position: {x: 0, y: 0}, config: {titleTemplate: 't', tasksFrom: 'json'}}],
      [edge('t', 'pm'), edge('pm', 'goal')],
    );
    const {workflowRunId} = await engine.startRun({...START, inlineGraph: g, name: 'x'});
    await engine.onNodeComplete({organizationId: 'org1', workflowRunId, nodeRunId: spawns[0]!.nodeRunId, summary: 'fail'});

    await engine.transition({organizationId: 'org1', workflowRunId, action: 'skip', idempotencyKey: 's1'});
    expect(goals).toHaveLength(1);
    expect(store.getWorkflowRun('org1', workflowRunId)!.status).toBe('completed');
  });

  it('rejects an invalid graph at startRun', async () => {
    const {effects} = makeEffects();
    const engine = new WorkflowEngineService(store, effects);
    // two triggers -> invalid
    const bad = graph(
      [trigger, {id: 't2', kind: 'trigger', position: {x: 0, y: 0}, config: {source: 'manual'}}, agent('pm')],
      [edge('t', 'pm')],
    );
    await expect(engine.startRun({...START, inlineGraph: bad, name: 'bad'})).rejects.toThrow(/Invalid workflow graph/);
  });
});
