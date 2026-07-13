import {createHash, randomUUID} from 'node:crypto';
import {
  MAIN_FLOW_KINDS,
  WorkflowGraphSchema,
  validateWorkflowGraph,
  type NodeOutput,
  type WorkflowDefinition,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeRun,
  type WorkflowRun,
  type WorkflowTransitionAction,
  type WorkflowValidationIssue,
} from '@ujima/shared';
import {errorMessage} from '../utils/error-message.js';
import {
  buildNodeOutputs,
  buildWorkflowWakeContext,
  defaultAgentOutputPath,
  resolveAttachedSubnodes,
  resolveGoalHandoff,
  resolveTokens,
  type SkillRef,
  type TokenContext,
} from './workflow-node-executors.js';

// ---------------------------------------------------------------------------
// WorkflowEngineService — the deterministic, durable, server-driven stepper.
//
// It owns graph traversal + run state; node *execution* is injected via the
// `WorkflowEffects` port (spawn an agent run, raise an approval, start a goal,
// stat an output file, notify the initiator). This preserves n8n's hard split
// between the execution engine and the nodes, and keeps the state machine
// unit-testable with fakes.
//
// DB rule (matches the repo's `transaction` helper): state mutations run
// synchronously inside a transaction; async side effects (spawning, file I/O,
// notifications) happen *after* the commit.
// ---------------------------------------------------------------------------

/** Subset of the repository the engine needs. The real Repository satisfies it. */
export interface WorkflowEngineStore {
  transaction<T>(fn: () => T): T;
  getWorkflowDefinition(organizationId: string, id: string): WorkflowDefinition | null;
  getWorkflowDefinitionByName(
    organizationId: string,
    name: string,
  ): WorkflowDefinition | null;
  saveWorkflowRun(run: WorkflowRun): WorkflowRun;
  getWorkflowRun(organizationId: string, runId: string): WorkflowRun | null;
  listWorkflowRunsByStatus(organizationId: string, statuses: string[]): WorkflowRun[];
  saveWorkflowNodeRun(nodeRun: WorkflowNodeRun): WorkflowNodeRun;
  getWorkflowNodeRun(workflowRunId: string, id: string): WorkflowNodeRun | null;
  listWorkflowNodeRuns(workflowRunId: string): WorkflowNodeRun[];
}

export interface SpawnAgentNodeInput {
  organizationId: string;
  workflowRunId: string;
  workflowName: string;
  initiatedBy: string;
  nodeRunId: string;
  nodeId: string;
  agentId: string;
  channelId: string;
  threadId: string;
  /** Fully token-resolved prompt. */
  prompt: string;
  /** Wake-context system-prompt suffix (workflow framing + terminator rules). */
  systemPromptSuffix: string;
  /** Attached `ai_tool` sub-node tool ids to add to the run's palette. */
  toolIds: string[];
  /** Attached `ai_skill` sub-nodes to preload into the run. */
  skills: SkillRef[];
  /** Where the agent should write its document. */
  outputPath: string;
}

export interface RaiseApprovalInput {
  organizationId: string;
  workflowRunId: string;
  nodeRunId: string;
  channelId: string;
  threadId: string;
  prompt?: string;
  summaryOfPriorStep?: string;
}

export interface StartGoalInput {
  organizationId: string;
  workflowRunId: string;
  initiatedBy: string;
  channelId: string;
  threadId: string;
  title: string;
  tasks: unknown[];
}

export interface StatOutputInput {
  organizationId: string;
  path: string;
}

export interface PrepareRunThreadInput {
  organizationId: string;
  channelId: string;
  workflowName: string;
  workflowRunId: string;
  initiatedBy: string;
  /** Agents referenced by the graph — added as members of the run thread. */
  agentIds: string[];
}

export interface PostRunCardInput {
  organizationId: string;
  /** Origin channel + thread the run was triggered from (where the card goes). */
  channelId: string;
  originThreadId: string;
  runThreadId: string;
  workflowName: string;
  workflowRunId: string;
}

export interface SpawnApproverAgentInput {
  organizationId: string;
  workflowRunId: string;
  workflowName: string;
  approverAgentId: string;
  channelId: string;
  threadId: string;
  nodeId: string;
  priorSummary?: string;
  priorOutputPath?: string;
}

export interface NotifyInitiatorInput {
  organizationId: string;
  workflowRun: WorkflowRun;
  reason: string;
  nodeId?: string;
  actions?: ('retry' | 'skip' | 'abort')[];
}

/** Side-effect port — the live adapter wires these to Spirit/goal/FS/DM. */
export interface WorkflowEffects {
  spawnAgentNode(input: SpawnAgentNodeInput): Promise<{childRunId: string}>;
  raiseApproval(input: RaiseApprovalInput): Promise<{approvalRequestId: string}>;
  startGoal(input: StartGoalInput): Promise<{goalId: string}>;
  statOutput(input: StatOutputInput): Promise<{sha256: string; sizeBytes: number} | null>;
  notifyInitiator(input: NotifyInitiatorInput): Promise<void>;
  /** The status of a child agent run, for the sweeper's missed-completion recovery. */
  getRunStatus(input: {organizationId: string; runId: string}): Promise<string | null>;
  /** Create the dedicated per-run thread (agents added as members). */
  prepareRunThread(input: PrepareRunThreadInput): Promise<{threadId: string}>;
  /** Post a "run started" card into the origin channel. */
  postRunCard(input: PostRunCardInput): Promise<void>;
  /** Spawn an agent to review + resolve an approval gate via workflow.transition. */
  spawnApproverAgent(input: SpawnApproverAgentInput): Promise<void>;
}

export interface StartRunInput {
  organizationId: string;
  definitionId?: string;
  definitionName?: string;
  inlineGraph?: WorkflowGraph;
  name?: string;
  input: string;
  initiatedBy: string;
  channelId: string;
  threadId: string;
}

export interface NodeCompleteInput {
  organizationId: string;
  workflowRunId: string;
  nodeRunId: string;
  summary?: string;
  json?: unknown;
  /** Override the node's designated output path. */
  outputPath?: string;
  failed?: boolean;
  failureReason?: string;
}

export interface TransitionInput {
  organizationId: string;
  workflowRunId: string;
  action: WorkflowTransitionAction;
  idempotencyKey: string;
  rejectionReason?: string;
}

export interface TransitionResult {
  ok: boolean;
  idempotent?: boolean;
}

export class WorkflowValidationError extends Error {
  constructor(readonly issues: WorkflowValidationIssue[]) {
    super(`Invalid workflow graph: ${issues.map((i) => i.message).join('; ')}`);
    this.name = 'WorkflowValidationError';
  }
}

const ACTIVE_NODE_STATUSES = new Set(['pending', 'running', 'awaiting_approval']);
const TERMINAL_DONE_STATUSES = new Set(['completed', 'skipped']);

export class WorkflowEngineService {
  /** Throttle for stuck-run reminders (in-memory; reset on restart is fine). */
  private readonly lastReminderAt = new Map<string, number>();
  private readonly reminderIntervalMs = 15 * 60 * 1000;

  constructor(
    private readonly store: WorkflowEngineStore,
    private readonly effects: WorkflowEffects,
  ) {}

  // --- Public API ---------------------------------------------------------

  async startRun(input: StartRunInput): Promise<{workflowRunId: string}> {
    const {graph, name, definitionId} = this.loadGraph(input);
    const validation = validateWorkflowGraph(graph);
    if (!validation.ok) throw new WorkflowValidationError(validation.issues);

    const snapshot = JSON.stringify(graph);
    const sha = createHash('sha256').update(snapshot).digest('hex');
    const nowIso = new Date().toISOString();
    const runId = randomUUID();

    // Every agent the run may use (agent nodes + approver agents) — these become
    // members of the dedicated run thread, so "is the agent in the channel?"
    // stops mattering. The run executes in that thread, isolated from the
    // origin channel conversation.
    const agentIds = new Set<string>();
    for (const node of graph.nodes) {
      if (node.kind === 'agent' && node.config.agentId) agentIds.add(node.config.agentId);
      if (node.kind === 'approval' && node.config.approverAgentId) {
        agentIds.add(node.config.approverAgentId);
      }
    }
    const {threadId: runThreadId} = await this.effects.prepareRunThread({
      organizationId: input.organizationId,
      channelId: input.channelId,
      workflowName: name,
      workflowRunId: runId,
      initiatedBy: input.initiatedBy,
      agentIds: [...agentIds],
    });

    const run: WorkflowRun = {
      id: runId,
      organizationId: input.organizationId,
      definitionId: definitionId ?? null,
      name,
      graphSnapshot: snapshot,
      graphSha256: sha,
      input: input.input,
      status: 'running',
      initiatedBy: input.initiatedBy,
      channelId: input.channelId,
      threadId: runThreadId,
      lastTransitionToken: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    this.store.transaction(() => {
      this.store.saveWorkflowRun(run);
      // Seed each trigger node as completed, carrying the input as its output.
      for (const node of graph.nodes) {
        if (node.kind !== 'trigger') continue;
        this.store.saveWorkflowNodeRun({
          id: randomUUID(),
          workflowRunId: runId,
          nodeId: node.id,
          attempt: 1,
          kind: 'trigger',
          agentId: null,
          childRunId: null,
          outputPath: null,
          outputSha256: null,
          outputSizeBytes: null,
          outputJson: input.input,
          summary: input.input,
          approvalRequestId: null,
          status: 'completed',
          failureReason: null,
          startedAt: nowIso,
          completedAt: nowIso,
        });
      }
    });

    await this.effects.postRunCard({
      organizationId: input.organizationId,
      channelId: input.channelId,
      originThreadId: input.threadId,
      runThreadId,
      workflowName: name,
      workflowRunId: runId,
    });

    await this.stepRun(input.organizationId, runId);
    return {workflowRunId: runId};
  }

  /** The heart: dispatch every node whose main-flow predecessors are done. */
  async stepRun(organizationId: string, workflowRunId: string): Promise<void> {
    const run = this.store.getWorkflowRun(organizationId, workflowRunId);
    if (!run || run.status !== 'running') return;

    const graph = this.parseGraph(run);
    const nodeRuns = this.store.listWorkflowNodeRuns(workflowRunId);
    const latest = this.latestByNode(nodeRuns);
    const outputs = buildNodeOutputs(nodeRuns);

    const ready: WorkflowNode[] = [];
    for (const node of graph.nodes) {
      if (!MAIN_FLOW_KINDS.includes(node.kind) || node.kind === 'trigger') continue;
      if (latest.has(node.id)) continue; // already dispatched/handled this node
      const preds = this.mainPredecessors(graph, node.id);
      const allDone = preds.every((p) => {
        const nr = latest.get(p);
        return nr ? TERMINAL_DONE_STATUSES.has(nr.status) : false;
      });
      if (preds.length > 0 && allDone) ready.push(node);
    }

    for (const node of ready) {
      await this.dispatchNode(run, graph, node, outputs, 1);
      const fresh = this.store.getWorkflowRun(organizationId, workflowRunId);
      if (!fresh || fresh.status !== 'running') return; // an approval paused the run
    }

    this.maybeComplete(organizationId, workflowRunId);
  }

  /**
   * Called when an agent node's run finishes (whether or not it explicitly
   * called `workflow.advance`). Captures the envelope, marks the node done,
   * and steps forward. This *is* the auto-advance path.
   */
  async onNodeComplete(input: NodeCompleteInput): Promise<void> {
    const nodeRun = this.store.getWorkflowNodeRun(input.workflowRunId, input.nodeRunId);
    if (!nodeRun) return;
    if (TERMINAL_DONE_STATUSES.has(nodeRun.status)) return; // idempotent
    const nowIso = new Date().toISOString();

    if (input.failed) {
      this.store.transaction(() => {
        this.store.saveWorkflowNodeRun({
          ...nodeRun,
          status: 'failed',
          failureReason: input.failureReason ?? 'agent_run_failed',
          completedAt: nowIso,
        });
        this.setRunStatus(input.organizationId, input.workflowRunId, 'paused');
      });
      await this.notify(input.organizationId, input.workflowRunId, `Step "${nodeRun.nodeId}" failed`, nodeRun.nodeId);
      return;
    }

    const outputPath = input.outputPath ?? nodeRun.outputPath ?? undefined;
    let sha: string | null = null;
    let size: number | null = null;
    if (outputPath) {
      const stat = await this.effects.statOutput({organizationId: input.organizationId, path: outputPath});
      if (stat) {
        sha = stat.sha256;
        size = stat.sizeBytes;
      }
    }

    const producedOutput = sha !== null || input.json !== undefined;
    if (nodeRun.kind === 'agent' && !producedOutput) {
      this.store.transaction(() => {
        this.store.saveWorkflowNodeRun({
          ...nodeRun,
          status: 'failed',
          failureReason: 'output_not_written',
          completedAt: nowIso,
        });
        this.setRunStatus(input.organizationId, input.workflowRunId, 'paused');
      });
      await this.notify(
        input.organizationId,
        input.workflowRunId,
        `Step "${nodeRun.nodeId}" produced no output`,
        nodeRun.nodeId,
      );
      return;
    }

    this.store.transaction(() => {
      this.store.saveWorkflowNodeRun({
        ...nodeRun,
        status: 'completed',
        summary: input.summary ?? nodeRun.summary ?? '(no summary)',
        outputJson: input.json ?? nodeRun.outputJson,
        outputPath: outputPath ?? null,
        outputSha256: sha,
        outputSizeBytes: size,
        completedAt: nowIso,
      });
    });

    const fresh = this.store.getWorkflowRun(input.organizationId, input.workflowRunId);
    if (fresh && fresh.status === 'running') {
      await this.stepRun(input.organizationId, input.workflowRunId);
    }
  }

  /** retry / skip / abort / approve / reject — single idempotent entrypoint. */
  async transition(input: TransitionInput): Promise<TransitionResult> {
    const run = this.store.getWorkflowRun(input.organizationId, input.workflowRunId);
    if (!run) return {ok: false};
    if (run.lastTransitionToken && run.lastTransitionToken === input.idempotencyKey) {
      return {ok: true, idempotent: true};
    }

    const latest = this.latestByNode(this.store.listWorkflowNodeRuns(input.workflowRunId));
    const nowIso = new Date().toISOString();

    switch (input.action) {
      case 'approve': {
        this.store.transaction(() => {
          for (const nr of latest.values()) {
            if (nr.status === 'awaiting_approval') {
              this.store.saveWorkflowNodeRun({
                ...nr,
                status: 'completed',
                summary: nr.summary ?? 'approved',
                completedAt: nowIso,
              });
            }
          }
          this.setRunStatus(input.organizationId, input.workflowRunId, 'running', input.idempotencyKey);
        });
        await this.stepRun(input.organizationId, input.workflowRunId);
        return {ok: true};
      }
      case 'reject': {
        this.store.transaction(() => {
          for (const nr of latest.values()) {
            if (nr.status === 'awaiting_approval') {
              this.store.saveWorkflowNodeRun({
                ...nr,
                status: 'failed',
                failureReason: `rejected: ${input.rejectionReason ?? ''}`,
                completedAt: nowIso,
              });
            }
          }
          this.setRunStatus(input.organizationId, input.workflowRunId, 'paused', input.idempotencyKey);
        });
        await this.notify(
          input.organizationId,
          input.workflowRunId,
          `Approval rejected: ${input.rejectionReason ?? ''}`,
        );
        return {ok: true};
      }
      case 'abort': {
        this.store.transaction(() => {
          this.setRunStatus(input.organizationId, input.workflowRunId, 'failed', input.idempotencyKey);
        });
        return {ok: true};
      }
      case 'retry': {
        const failed = this.latestFailed(latest);
        if (!failed) return {ok: false};
        this.store.transaction(() => {
          this.setRunStatus(input.organizationId, input.workflowRunId, 'running', input.idempotencyKey);
        });
        const runningRun = this.store.getWorkflowRun(input.organizationId, input.workflowRunId);
        if (runningRun) {
          const graph = this.parseGraph(runningRun);
          const node = graph.nodes.find((n) => n.id === failed.nodeId);
          if (node && MAIN_FLOW_KINDS.includes(node.kind)) {
            const outputs = buildNodeOutputs(this.store.listWorkflowNodeRuns(input.workflowRunId));
            await this.dispatchNode(runningRun, graph, node, outputs, failed.attempt + 1);
          }
          await this.stepRun(input.organizationId, input.workflowRunId);
        }
        return {ok: true};
      }
      case 'skip': {
        const failed = this.latestFailed(latest);
        if (!failed) return {ok: false};
        this.store.transaction(() => {
          this.store.saveWorkflowNodeRun({
            ...failed,
            status: 'skipped',
            summary: failed.summary ?? '(skipped)',
            completedAt: nowIso,
          });
          this.setRunStatus(input.organizationId, input.workflowRunId, 'running', input.idempotencyKey);
        });
        await this.stepRun(input.organizationId, input.workflowRunId);
        return {ok: true};
      }
    }
  }

  /** Re-dispatch runs left `running` after a process restart. */
  async recoverInFlight(organizationId: string): Promise<void> {
    const runs = this.store.listWorkflowRunsByStatus(organizationId, ['running']);
    for (const run of runs) {
      await this.stepRun(organizationId, run.id);
    }
  }

  /**
   * Periodic safety sweep (runs on the scheduler tick, like the goal-task
   * sweeper). For each non-terminal run:
   *  - `running`: recover missed node completions (agent run went terminal but
   *    the completion hook never fired — e.g., a crash) and re-dispatch ready
   *    nodes. Idempotent.
   *  - `awaiting_approval` / `paused`: re-notify the initiator, throttled so a
   *    stuck run reminds at most once per `reminderIntervalMs`.
   */
  async sweep(organizationId: string): Promise<void> {
    const runs = this.store.listWorkflowRunsByStatus(organizationId, [
      'running',
      'awaiting_approval',
      'paused',
    ]);
    for (const run of runs) {
      if (run.status === 'running') {
        await this.recoverRun(run);
      } else if (this.shouldRemind(run.id)) {
        this.lastReminderAt.set(run.id, Date.now());
        const reason =
          run.status === 'awaiting_approval'
            ? 'still awaiting approval'
            : 'still paused — retry, skip, or abort';
        await this.effects.notifyInitiator({
          organizationId,
          workflowRun: run,
          reason,
          actions: run.status === 'paused' ? ['retry', 'skip', 'abort'] : undefined,
        });
      }
    }
    // Drop throttle entries for runs that have since gone terminal.
    const activeIds = new Set(runs.map((r) => r.id));
    for (const id of [...this.lastReminderAt.keys()]) {
      if (!activeIds.has(id)) this.lastReminderAt.delete(id);
    }
  }

  private async recoverRun(run: WorkflowRun): Promise<void> {
    const nodeRuns = this.store.listWorkflowNodeRuns(run.id);
    let recovered = false;
    for (const nr of nodeRuns) {
      if (nr.status !== 'running' || !nr.childRunId) continue;
      const childStatus = await this.effects.getRunStatus({
        organizationId: run.organizationId,
        runId: nr.childRunId,
      });
      if (childStatus && ['completed', 'failed', 'cancelled'].includes(childStatus)) {
        // The agent run finished but the completion hook was missed — re-drive it.
        await this.onNodeComplete({
          organizationId: run.organizationId,
          workflowRunId: run.id,
          nodeRunId: nr.id,
          failed: childStatus !== 'completed',
          failureReason: childStatus !== 'completed' ? `agent_run_${childStatus}` : undefined,
        });
        recovered = true;
      }
    }
    if (!recovered) await this.stepRun(run.organizationId, run.id);
  }

  private shouldRemind(runId: string): boolean {
    const last = this.lastReminderAt.get(runId) ?? 0;
    return Date.now() - last >= this.reminderIntervalMs;
  }

  // --- Dispatch -----------------------------------------------------------

  private async dispatchNode(
    run: WorkflowRun,
    graph: WorkflowGraph,
    node: WorkflowNode,
    outputs: Map<string, NodeOutput>,
    attempt: number,
  ): Promise<void> {
    if (node.kind === 'agent') return this.dispatchAgent(run, graph, node, outputs, attempt);
    if (node.kind === 'approval') return this.dispatchApproval(run, graph, node, outputs, attempt);
    if (node.kind === 'goal_handoff') return this.dispatchGoalHandoff(run, node, outputs, attempt);
  }

  private async dispatchAgent(
    run: WorkflowRun,
    graph: WorkflowGraph,
    node: Extract<WorkflowNode, {kind: 'agent'}>,
    outputs: Map<string, NodeOutput>,
    attempt: number,
  ): Promise<void> {
    const nodeRunId = randomUUID();
    const nowIso = new Date().toISOString();
    const base: WorkflowNodeRun = {
      id: nodeRunId,
      workflowRunId: run.id,
      nodeId: node.id,
      attempt,
      kind: 'agent',
      agentId: node.config.agentId,
      childRunId: null,
      outputPath: null,
      outputSha256: null,
      outputSizeBytes: null,
      outputJson: undefined,
      summary: null,
      approvalRequestId: null,
      status: 'pending',
      failureReason: null,
      startedAt: nowIso,
      completedAt: null,
    };
    this.store.transaction(() => this.store.saveWorkflowNodeRun(base));

    const tokenCtx: TokenContext = {input: run.input ?? '', workflowRunId: run.id, outputs};
    const outputPath = resolveTokens(
      node.config.outputPath ?? defaultAgentOutputPath(run.id, node.id),
      tokenCtx,
    );
    const prompt = resolveTokens(node.config.prompt, {...tokenCtx, selfOutput: outputPath});
    const systemPromptSuffix = buildWorkflowWakeContext({
      workflowName: run.name,
      workflowRunId: run.id,
      nodeId: node.id,
      nodeLabel: node.label,
      outputPath,
    });
    const {skills, toolIds} = resolveAttachedSubnodes(graph, node.id);

    try {
      const {childRunId} = await this.effects.spawnAgentNode({
        organizationId: run.organizationId,
        workflowRunId: run.id,
        workflowName: run.name,
        initiatedBy: run.initiatedBy,
        nodeRunId,
        nodeId: node.id,
        agentId: node.config.agentId,
        channelId: run.channelId,
        threadId: run.threadId,
        prompt,
        systemPromptSuffix,
        toolIds,
        skills,
        outputPath,
      });
      this.store.transaction(() =>
        this.store.saveWorkflowNodeRun({...base, status: 'running', childRunId, outputPath}),
      );
    } catch (err) {
      this.store.transaction(() => {
        this.store.saveWorkflowNodeRun({
          ...base,
          status: 'failed',
          failureReason: `spawn_failed: ${errorMessage(err)}`,
          completedAt: new Date().toISOString(),
        });
        this.setRunStatus(run.organizationId, run.id, 'paused');
      });
      await this.notify(run.organizationId, run.id, `Step "${node.id}" failed to start`, node.id);
    }
  }

  private async dispatchApproval(
    run: WorkflowRun,
    graph: WorkflowGraph,
    node: Extract<WorkflowNode, {kind: 'approval'}>,
    outputs: Map<string, NodeOutput>,
    attempt: number,
  ): Promise<void> {
    const nodeRunId = randomUUID();
    const nowIso = new Date().toISOString();
    const base: WorkflowNodeRun = {
      id: nodeRunId,
      workflowRunId: run.id,
      nodeId: node.id,
      attempt,
      kind: 'approval',
      agentId: null,
      childRunId: null,
      outputPath: null,
      outputSha256: null,
      outputSizeBytes: null,
      outputJson: undefined,
      summary: null,
      approvalRequestId: null,
      status: 'awaiting_approval',
      failureReason: null,
      startedAt: nowIso,
      completedAt: null,
    };
    this.store.transaction(() => this.store.saveWorkflowNodeRun(base));

    const priorSummary = this.nearestUpstreamSummary(graph, node.id, outputs);
    const {approvalRequestId} = await this.effects.raiseApproval({
      organizationId: run.organizationId,
      workflowRunId: run.id,
      nodeRunId,
      channelId: run.channelId,
      threadId: run.threadId,
      prompt: node.config.prompt,
      summaryOfPriorStep: priorSummary,
    });
    this.store.transaction(() => {
      this.store.saveWorkflowNodeRun({...base, approvalRequestId});
      this.setRunStatus(run.organizationId, run.id, 'awaiting_approval');
    });

    // Agent-as-approver: a designated agent reviews the upstream output and
    // resolves the gate via workflow.transition (its run is NOT a workflow node
    // run, so it won't advance the graph on completion — only the transition does).
    if (node.config.approverAgentId) {
      const priorOutput = this.nearestUpstreamOutput(graph, node.id, outputs);
      await this.effects.spawnApproverAgent({
        organizationId: run.organizationId,
        workflowRunId: run.id,
        workflowName: run.name,
        approverAgentId: node.config.approverAgentId,
        channelId: run.channelId,
        threadId: run.threadId,
        nodeId: node.id,
        priorSummary,
        priorOutputPath: priorOutput?.output_file ?? undefined,
      });
    }
  }

  private async dispatchGoalHandoff(
    run: WorkflowRun,
    node: Extract<WorkflowNode, {kind: 'goal_handoff'}>,
    outputs: Map<string, NodeOutput>,
    attempt: number,
  ): Promise<void> {
    const nodeRunId = randomUUID();
    const nowIso = new Date().toISOString();
    const base: WorkflowNodeRun = {
      id: nodeRunId,
      workflowRunId: run.id,
      nodeId: node.id,
      attempt,
      kind: 'goal_handoff',
      agentId: null,
      childRunId: null,
      outputPath: null,
      outputSha256: null,
      outputSizeBytes: null,
      outputJson: undefined,
      summary: null,
      approvalRequestId: null,
      status: 'pending',
      failureReason: null,
      startedAt: nowIso,
      completedAt: null,
    };
    this.store.transaction(() => this.store.saveWorkflowNodeRun(base));

    const tokenCtx: TokenContext = {input: run.input ?? '', workflowRunId: run.id, outputs};
    const {title, tasks} = resolveGoalHandoff(node, tokenCtx);

    try {
      const {goalId} = await this.effects.startGoal({
        organizationId: run.organizationId,
        workflowRunId: run.id,
        initiatedBy: run.initiatedBy,
        channelId: run.channelId,
        threadId: run.threadId,
        title,
        tasks,
      });
      this.store.transaction(() =>
        this.store.saveWorkflowNodeRun({
          ...base,
          status: 'completed',
          summary: `Handed off to goal ${goalId}`,
          outputJson: {goalId, title, tasks},
          completedAt: new Date().toISOString(),
        }),
      );
    } catch (err) {
      this.store.transaction(() => {
        this.store.saveWorkflowNodeRun({
          ...base,
          status: 'failed',
          failureReason: `goal_handoff_failed: ${errorMessage(err)}`,
          completedAt: new Date().toISOString(),
        });
        this.setRunStatus(run.organizationId, run.id, 'paused');
      });
      await this.notify(run.organizationId, run.id, `Goal handoff "${node.id}" failed`, node.id);
    }
  }

  // --- Internals ----------------------------------------------------------

  private loadGraph(input: StartRunInput): {
    graph: WorkflowGraph;
    name: string;
    definitionId: string | null;
  } {
    if (input.inlineGraph) {
      return {graph: input.inlineGraph, name: input.name ?? 'workflow', definitionId: null};
    }
    const def = input.definitionId
      ? this.store.getWorkflowDefinition(input.organizationId, input.definitionId)
      : input.definitionName
        ? this.store.getWorkflowDefinitionByName(input.organizationId, input.definitionName)
        : null;
    if (!def) {
      throw new Error(
        `Workflow definition not found (${input.definitionId ?? input.definitionName ?? '?'})`,
      );
    }
    return {
      graph: {nodes: def.nodes, edges: def.edges},
      name: input.name ?? def.name,
      definitionId: def.id,
    };
  }

  private parseGraph(run: WorkflowRun): WorkflowGraph {
    return WorkflowGraphSchema.parse(JSON.parse(run.graphSnapshot));
  }

  private latestByNode(nodeRuns: WorkflowNodeRun[]): Map<string, WorkflowNodeRun> {
    const latest = new Map<string, WorkflowNodeRun>();
    for (const nr of nodeRuns) {
      const prev = latest.get(nr.nodeId);
      if (!prev || nr.attempt >= prev.attempt) latest.set(nr.nodeId, nr);
    }
    return latest;
  }

  private latestFailed(latest: Map<string, WorkflowNodeRun>): WorkflowNodeRun | undefined {
    return [...latest.values()]
      .filter((nr) => nr.status === 'failed')
      .sort((a, b) => a.attempt - b.attempt)
      .pop();
  }

  private mainPredecessors(graph: WorkflowGraph, nodeId: string): string[] {
    return graph.edges
      .filter((e) => e.targetPort === 'main' && e.target === nodeId)
      .map((e) => e.source);
  }

  private nearestUpstreamSummary(
    graph: WorkflowGraph,
    nodeId: string,
    outputs: Map<string, NodeOutput>,
  ): string | undefined {
    for (const pred of this.mainPredecessors(graph, nodeId)) {
      const out = outputs.get(pred);
      if (out?.summary) return out.summary;
    }
    return undefined;
  }

  private nearestUpstreamOutput(
    graph: WorkflowGraph,
    nodeId: string,
    outputs: Map<string, NodeOutput>,
  ): NodeOutput | undefined {
    for (const pred of this.mainPredecessors(graph, nodeId)) {
      const out = outputs.get(pred);
      if (out?.output_file) return out;
    }
    return undefined;
  }

  private maybeComplete(organizationId: string, workflowRunId: string): void {
    const run = this.store.getWorkflowRun(organizationId, workflowRunId);
    if (!run || run.status !== 'running') return;
    const graph = this.parseGraph(run);
    const latest = this.latestByNode(this.store.listWorkflowNodeRuns(workflowRunId));
    const mainNodes = graph.nodes.filter((n) => MAIN_FLOW_KINDS.includes(n.kind));
    const anyActive = [...latest.values()].some((nr) => ACTIVE_NODE_STATUSES.has(nr.status));
    const allTerminal = mainNodes.every((n) => {
      const nr = latest.get(n.id);
      return nr ? TERMINAL_DONE_STATUSES.has(nr.status) : false;
    });
    if (allTerminal && !anyActive) {
      this.setRunStatus(organizationId, workflowRunId, 'completed');
    }
  }

  private setRunStatus(
    organizationId: string,
    workflowRunId: string,
    status: WorkflowRun['status'],
    token?: string,
  ): void {
    const run = this.store.getWorkflowRun(organizationId, workflowRunId);
    if (!run) return;
    this.store.saveWorkflowRun({
      ...run,
      status,
      lastTransitionToken: token ?? run.lastTransitionToken ?? null,
      updatedAt: new Date().toISOString(),
    });
  }

  private async notify(
    organizationId: string,
    workflowRunId: string,
    reason: string,
    nodeId?: string,
  ): Promise<void> {
    const run = this.store.getWorkflowRun(organizationId, workflowRunId);
    if (!run) return;
    await this.effects.notifyInitiator({
      organizationId,
      workflowRun: run,
      reason,
      nodeId,
      actions: ['retry', 'skip', 'abort'],
    });
  }
}
