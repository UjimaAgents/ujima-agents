import {createHash, randomUUID} from 'node:crypto';
import {
  MAIN_FLOW_KINDS,
  latestNodeRuns,
  normalizeWorkflowGraph,
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
  findDownstreamOutputSpec,
  renderOutputFormatContract,
  resolveAttachedSubnodes,
  resolveGoalHandoff,
  resolveTokens,
  type SkillRef,
  type TokenContext,
} from './workflow-node-executors.js';

// ---------------------------------------------------------------------------
// WorkflowEngineService — the deterministic, durable, server-driven stepper.
//
// It is the SINGLE authority over workflow run state: status transitions,
// latency stamps (startedAt/completedAt on every node run), completion
// detection, and node-output derivation all live here. Node *execution* is
// injected via the `WorkflowEffects` port (spawn an agent run, raise an
// approval, start a goal, stat an output file, notify the initiator). This
// preserves n8n's hard split between the execution engine and the nodes, and
// keeps the state machine unit-testable with fakes.
//
// The agent-facing tools are thin adapters: `workflow.advance` calls into
// `advance()` below and never writes node-run state itself; the child-run →
// node-run correlation for a completed agent run lives in
// `handleAgentRunCompleted()` (the run-completed hook at the composition root
// just calls it — no correlation logic there).
//
// DB rule (matches the repo's `transaction` helper): state mutations run
// synchronously inside a transaction; async side effects (spawning, file I/O,
// notifications) happen *after* the commit.
// ---------------------------------------------------------------------------

/** Subset of the repository the engine needs. The real Repository satisfies it. */
export interface WorkflowEngineStore {
  transaction<T>(fn: () => T): T;
  getWorkflowDefinition(organizationId: string, id: string): WorkflowDefinition | null;
  /** Channel-scoped + org-wide definitions, ordered channel-scoped first. */
  listWorkflowDefinitionsForChannel(
    organizationId: string,
    channelId: string,
  ): WorkflowDefinition[];
  saveWorkflowRun(run: WorkflowRun): WorkflowRun;
  getWorkflowRun(organizationId: string, runId: string): WorkflowRun | null;
  listWorkflowRunsByStatus(organizationId: string, statuses: string[]): WorkflowRun[];
  saveWorkflowNodeRun(nodeRun: WorkflowNodeRun): WorkflowNodeRun;
  getWorkflowNodeRun(workflowRunId: string, id: string): WorkflowNodeRun | null;
  listWorkflowNodeRuns(workflowRunId: string): WorkflowNodeRun[];
  /** Correlate a child agent run back to its workflow node run. */
  getWorkflowNodeRunByChildRun(childRunId: string): WorkflowNodeRun | null;
}

export interface SpawnAgentNodeInput {
  organizationId: string;
  workflowRunId: string;
  workflowName: string;
  initiatedBy: string;
  nodeRunId: string;
  nodeId: string;
  agentId: string;
  /**
   * The child run's id, generated + persisted on the node run by the engine
   * *before* the run is fired, so a fast completion can't race the node run
   * into a stale `running` state. spawnAgentNode must use this as the run id.
   */
  childRunId: string;
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

export interface PostRunUpdateInput {
  organizationId: string;
  channelId: string;
  /** The origin thread the start card went to; the update posts to the same thread. */
  originThreadId?: string;
  workflowName: string;
  workflowRunId: string;
  status: 'completed' | 'failed';
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
  /** Post a "run completed/failed" card into the origin channel. */
  postRunUpdate(input: PostRunUpdateInput): Promise<void>;
  /** Spawn an agent to review + resolve an approval gate via workflow.transition. */
  spawnApproverAgent(input: SpawnApproverAgentInput): Promise<void>;
  /** Publish the canonical run snapshot to realtime consumers. */
  publishRunUpdated?(input: WorkflowRunLiveUpdate): Promise<void> | void;
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

/**
 * The `workflow.advance` contract: an agent node's run finished its work and
 * hands its envelope (summary / json / output path) to the engine. The tool
 * is a thin adapter over this — the engine resolves the calling run to its
 * node run and persists the envelope as the single writer of run state.
 */
export interface AdvanceInput {
  organizationId: string;
  /** The calling agent run's id — correlated to its workflow node run. */
  runId: string;
  summary: string;
  json?: unknown;
  /** Override the node's designated output path. */
  outputPath?: string;
  idempotencyKey?: string;
}

export interface AdvanceResult {
  ok: boolean;
  error?: string;
}

/**
 * The run-completed hook contract: a child agent run went terminal. The
 * engine decides whether it backs a workflow node run and drives the
 * completion; the composition root keeps no correlation logic of its own.
 */
export interface AgentRunCompletedInput {
  organizationId: string;
  /** The finished agent run's id. */
  runId: string;
  /** The run's terminal status (whichever string the runtime persisted). */
  status: string;
}

export interface WorkflowRunLiveUpdate {
  organizationId: string;
  run: WorkflowRun;
  nodeRuns: WorkflowNodeRun[];
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

function createWorkflowNodeRun(input: {
  workflowRunId: string;
  nodeId: string;
  attempt: number;
  kind: WorkflowNodeRun['kind'];
  status: WorkflowNodeRun['status'];
  agentId?: string | null;
  childRunId?: string | null;
  outputPath?: string | null;
  outputSha256?: string | null;
  outputSizeBytes?: number | null;
  outputJson?: unknown;
  summary?: string | null;
  approvalRequestId?: string | null;
  failureReason?: string | null;
  startedAt: string;
  completedAt?: string | null;
}): WorkflowNodeRun {
  return {
    id: randomUUID(),
    workflowRunId: input.workflowRunId,
    nodeId: input.nodeId,
    attempt: input.attempt,
    kind: input.kind,
    agentId: input.agentId ?? null,
    childRunId: input.childRunId ?? null,
    outputPath: input.outputPath ?? null,
    outputSha256: input.outputSha256 ?? null,
    outputSizeBytes: input.outputSizeBytes ?? null,
    outputJson: input.outputJson,
    summary: input.summary ?? null,
    approvalRequestId: input.approvalRequestId ?? null,
    status: input.status,
    failureReason: input.failureReason ?? null,
    startedAt: input.startedAt,
    completedAt: input.completedAt ?? null,
  };
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
  /** Serialize lifecycle decisions per run; idempotency is durable, ordering is local. */
  private readonly transitionTails = new Map<string, Promise<void>>();
  /** Throttle for stuck-run reminders (in-memory; reset on restart is fine). */
  private readonly lastReminderAt = new Map<string, number>();
  /** How many reminders each stuck run has had, so we go quiet instead of flooding. */
  private readonly reminderCount = new Map<string, number>();
  private readonly reminderIntervalMs = 30 * 60 * 1000;
  /** After this many reminders the sweeper stays silent — the run view still shows it. */
  private readonly maxReminders = 3;

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
      originThreadId: input.threadId,
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

    await this.publishState(input.organizationId, runId);
    await this.stepRun(input.organizationId, runId);
    await this.publishState(input.organizationId, runId);
    return {workflowRunId: runId};
  }

  /** The heart: dispatch every node whose main-flow predecessors are done. */
  private async stepRun(organizationId: string, workflowRunId: string): Promise<void> {
    const run = this.store.getWorkflowRun(organizationId, workflowRunId);
    if (!run || run.status !== 'running') return;

    const graph = this.parseGraph(run);
    const nodeRuns = this.store.listWorkflowNodeRuns(workflowRunId);
    const latest = latestNodeRuns(nodeRuns);
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
      await this.publishState(organizationId, workflowRunId);
      const fresh = this.store.getWorkflowRun(organizationId, workflowRunId);
      if (!fresh || fresh.status !== 'running') return; // an approval paused the run
    }

    await this.maybeComplete(organizationId, workflowRunId);
  }

  /**
   * Called when an agent node's run finishes (whether or not it explicitly
   * called `workflow.advance`). Captures the envelope, marks the node done,
   * and steps forward. This *is* the auto-advance path.
   */
  async onNodeComplete(input: NodeCompleteInput): Promise<void> {
    const nodeRun = this.store.getWorkflowNodeRun(input.workflowRunId, input.nodeRunId);
    if (!nodeRun) return;
    if (TERMINAL_DONE_STATUSES.has(nodeRun.status) || nodeRun.status === 'failed') return; // idempotent
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
      await this.publishState(input.organizationId, input.workflowRunId);
      await this.notify(input.organizationId, input.workflowRunId, `Step "${nodeRun.nodeId}" failed`, nodeRun.nodeId);
      await this.postFailedCard(input.organizationId, input.workflowRunId);
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

    const currentNodeRun = this.store.getWorkflowNodeRun(input.workflowRunId, input.nodeRunId) ?? nodeRun;
    if (TERMINAL_DONE_STATUSES.has(currentNodeRun.status) || currentNodeRun.status === 'failed') return;
    const producedOutput =
      sha !== null || input.json !== undefined || currentNodeRun.outputJson !== undefined;
    if (currentNodeRun.kind === 'agent' && !producedOutput) {
      this.store.transaction(() => {
        this.store.saveWorkflowNodeRun({
          ...currentNodeRun,
          status: 'failed',
          failureReason: 'output_not_written',
          completedAt: nowIso,
        });
        this.setRunStatus(input.organizationId, input.workflowRunId, 'paused');
      });
      await this.publishState(input.organizationId, input.workflowRunId);
      await this.notify(
        input.organizationId,
        input.workflowRunId,
        `Step "${currentNodeRun.nodeId}" produced no output`,
        currentNodeRun.nodeId,
      );
      await this.postFailedCard(input.organizationId, input.workflowRunId);
      return;
    }

    this.store.transaction(() => {
      this.store.saveWorkflowNodeRun({
        ...currentNodeRun,
        status: 'completed',
        summary: input.summary ?? currentNodeRun.summary ?? '(no summary)',
        outputJson: input.json ?? currentNodeRun.outputJson,
        outputPath: outputPath ?? null,
        outputSha256: sha,
        outputSizeBytes: size,
        completedAt: nowIso,
      });
    });

    await this.publishState(input.organizationId, input.workflowRunId);

    const fresh = this.store.getWorkflowRun(input.organizationId, input.workflowRunId);
    if (fresh && fresh.status === 'running') {
      await this.stepRun(input.organizationId, input.workflowRunId);
    }
  }

  /**
   * `workflow.advance` — the in-node terminator. The tool calls only this
   * method; the engine resolves the calling agent run to its node run and
   * persists the envelope (summary / json / output path) as the single writer
   * of node-run state. The node itself is completed when the agent's run
   * finishes (via `handleAgentRunCompleted` → `onNodeComplete`).
   */
  async advance(input: AdvanceInput): Promise<AdvanceResult> {
    const nodeRun = this.store.getWorkflowNodeRunByChildRun(input.runId);
    if (!nodeRun) return {ok: false, error: 'this run is not a workflow node run'};
    const run = this.store.getWorkflowRun(input.organizationId, nodeRun.workflowRunId);
    if (!run) return {ok: false, error: 'this run is not a workflow node run'};
    // The node already went terminal (e.g. the completion hook fired first) —
    // the advance intent is already satisfied; do not clobber terminal state.
    if (TERMINAL_DONE_STATUSES.has(nodeRun.status) || nodeRun.status === 'failed') {
      return {ok: true};
    }
    this.store.transaction(() => {
      this.store.saveWorkflowNodeRun({
        ...nodeRun,
        summary: input.summary,
        outputJson: input.json ?? nodeRun.outputJson,
        outputPath: input.outputPath ?? nodeRun.outputPath,
      });
    });
    await this.publishState(input.organizationId, nodeRun.workflowRunId);
    // `idempotencyKey` is accepted for contract parity; stashing the same
    // envelope twice is a no-op overwrite, so the key needs no persistence.
    return {ok: true};
  }

  /**
   * The run-completed hook's workflow leg. The composition root calls this
   * with every terminal agent run; the engine correlates the child run to its
   * node run (state determination lives here, not in the hook) and drives
   * `onNodeComplete`, which marks the node done and steps the graph forward.
   */
  async handleAgentRunCompleted(input: AgentRunCompletedInput): Promise<void> {
    // Only terminal runs finish a node; a run paused for tool approval / input
    // is not done and will re-fire this hook when it resumes.
    if (!['completed', 'failed', 'cancelled'].includes(input.status)) return;
    const nodeRun = this.store.getWorkflowNodeRunByChildRun(input.runId);
    if (!nodeRun) return;
    await this.onNodeComplete({
      organizationId: input.organizationId,
      workflowRunId: nodeRun.workflowRunId,
      nodeRunId: nodeRun.id,
      failed: input.status !== 'completed',
      failureReason: input.status !== 'completed' ? `agent_run_${input.status}` : undefined,
    });
  }

  /** retry / skip / abort / approve / reject — single idempotent entrypoint. */
  async transition(input: TransitionInput): Promise<TransitionResult> {
    const key = `${input.organizationId}:${input.workflowRunId}`;
    const previous = this.transitionTails.get(key) ?? Promise.resolve();
    const current = previous.then(() => this.transitionInternal(input));
    const tail = current.then(() => undefined, () => undefined);
    this.transitionTails.set(key, tail);
    try {
      return await current;
    } finally {
      if (this.transitionTails.get(key) === tail) this.transitionTails.delete(key);
    }
  }

  private async transitionInternal(input: TransitionInput): Promise<TransitionResult> {
    const run = this.store.getWorkflowRun(input.organizationId, input.workflowRunId);
    if (!run) return {ok: false};
    if (run.lastTransitionToken && run.lastTransitionToken === input.idempotencyKey) {
      return {ok: true, idempotent: true};
    }

    const latest = latestNodeRuns(this.store.listWorkflowNodeRuns(input.workflowRunId));
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
        await this.publishState(input.organizationId, input.workflowRunId);
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
        await this.publishState(input.organizationId, input.workflowRunId);
        await this.notify(
          input.organizationId,
          input.workflowRunId,
          `Approval rejected: ${input.rejectionReason ?? ''}`,
        );
        await this.postFailedCard(input.organizationId, input.workflowRunId);
        return {ok: true};
      }
      case 'abort': {
        this.store.transaction(() => {
          this.setRunStatus(input.organizationId, input.workflowRunId, 'failed', input.idempotencyKey);
        });
        await this.publishState(input.organizationId, input.workflowRunId);
        await this.postFailedCard(input.organizationId, input.workflowRunId);
        return {ok: true};
      }
      case 'retry': {
        const failed = this.latestFailed(latest);
        if (!failed) return {ok: false};
        this.store.transaction(() => {
          this.setRunStatus(input.organizationId, input.workflowRunId, 'running', input.idempotencyKey);
        });
        await this.publishState(input.organizationId, input.workflowRunId);
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
        await this.publishState(input.organizationId, input.workflowRunId);
        await this.stepRun(input.organizationId, input.workflowRunId);
        return {ok: true};
      }
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
        this.reminderCount.set(run.id, (this.reminderCount.get(run.id) ?? 0) + 1);
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
      if (!activeIds.has(id)) {
        this.lastReminderAt.delete(id);
        this.reminderCount.delete(id);
      }
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
    if ((this.reminderCount.get(runId) ?? 0) >= this.maxReminders) return false;
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
    if (node.kind === 'output') return this.dispatchOutput(run, graph, node, outputs, attempt);
  }

  private async dispatchAgent(
    run: WorkflowRun,
    graph: WorkflowGraph,
    node: Extract<WorkflowNode, {kind: 'agent'}>,
    outputs: Map<string, NodeOutput>,
    attempt: number,
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const base = createWorkflowNodeRun({
      workflowRunId: run.id,
      nodeId: node.id,
      attempt,
      kind: 'agent',
      agentId: node.config.agentId,
      status: 'pending',
      startedAt: nowIso,
    });
    const nodeRunId = base.id;
    const tokenCtx: TokenContext = {input: run.input ?? '', workflowRunId: run.id, outputs};
    // A downstream `output` node declares the required format + owns the path.
    const outputSpec = findDownstreamOutputSpec(graph, node.id);
    const outputPath = resolveTokens(
      outputSpec?.config.outputPath ??
        node.config.outputPath ??
        defaultAgentOutputPath(run.id, node.id),
      tokenCtx,
    );
    const prompt = resolveTokens(node.config.prompt, {...tokenCtx, selfOutput: outputPath});
    let systemPromptSuffix = buildWorkflowWakeContext({
      workflowName: run.name,
      workflowRunId: run.id,
      nodeId: node.id,
      nodeLabel: node.label,
      outputPath,
    });
    if (outputSpec) {
      systemPromptSuffix += `\n\n${renderOutputFormatContract(outputSpec.config, outputPath)}`;
    }
    const {skills, toolIds} = resolveAttachedSubnodes(graph, node.id);

    // Persist `running` + child_run_id + output_path BEFORE firing the async
    // child run. The child run's id is generated here (not inside the effect)
    // so that if it completes fast, onNodeComplete writes the terminal status
    // onto a fully-stamped row — and there is no later `running` write to
    // clobber it back (the race that could strand a run).
    const childRunId = randomUUID();
    this.store.transaction(() =>
      this.store.saveWorkflowNodeRun({...base, status: 'running', childRunId, outputPath}),
    );

    try {
      await this.effects.spawnAgentNode({
        organizationId: run.organizationId,
        workflowRunId: run.id,
        workflowName: run.name,
        initiatedBy: run.initiatedBy,
        nodeRunId,
        nodeId: node.id,
        agentId: node.config.agentId,
        childRunId,
        channelId: run.channelId,
        threadId: run.threadId,
        prompt,
        systemPromptSuffix,
        toolIds,
        skills,
        outputPath,
      });
    } catch (err) {
      // The child run never started, so no completion can race this write.
      // Guard anyway: don't overwrite a status that already went terminal.
      this.store.transaction(() => {
        const current = this.store.getWorkflowNodeRun(run.id, nodeRunId) ?? base;
        if (TERMINAL_DONE_STATUSES.has(current.status) || current.status === 'failed') return;
        this.store.saveWorkflowNodeRun({
          ...current,
          status: 'failed',
          failureReason: `spawn_failed: ${errorMessage(err)}`,
          completedAt: new Date().toISOString(),
        });
        this.setRunStatus(run.organizationId, run.id, 'paused');
      });
      await this.notify(run.organizationId, run.id, `Step "${node.id}" failed to start`, node.id);
      await this.postFailedCard(run.organizationId, run.id);
    }
  }

  private async dispatchApproval(
    run: WorkflowRun,
    graph: WorkflowGraph,
    node: Extract<WorkflowNode, {kind: 'approval'}>,
    outputs: Map<string, NodeOutput>,
    attempt: number,
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const base = createWorkflowNodeRun({
      workflowRunId: run.id,
      nodeId: node.id,
      attempt,
      kind: 'approval',
      status: 'awaiting_approval',
      startedAt: nowIso,
    });
    const nodeRunId = base.id;
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
    const nowIso = new Date().toISOString();
    const base = createWorkflowNodeRun({
      workflowRunId: run.id,
      nodeId: node.id,
      attempt,
      kind: 'goal_handoff',
      status: 'pending',
      startedAt: nowIso,
    });
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

  /**
   * An `output` node is a synchronous passthrough: the format it declares already
   * shaped its upstream agent (see dispatchAgent), so here it just carries that
   * agent's envelope forward and re-steps so the downstream node dispatches.
   */
  private async dispatchOutput(
    run: WorkflowRun,
    graph: WorkflowGraph,
    node: Extract<WorkflowNode, {kind: 'output'}>,
    outputs: Map<string, NodeOutput>,
    attempt: number,
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const upstream = this.nearestUpstreamOutput(graph, node.id, outputs);
    this.store.transaction(() =>
      this.store.saveWorkflowNodeRun(
        createWorkflowNodeRun({
        workflowRunId: run.id,
        nodeId: node.id,
        attempt,
        kind: 'output',
        outputPath: upstream?.output_file ?? null,
        outputJson: upstream?.json,
        summary: `Output · ${node.config.format}`,
        status: 'completed',
        startedAt: nowIso,
        completedAt: nowIso,
        }),
      ),
    );
    // The output node completes synchronously; re-step to dispatch what's now ready.
    await this.stepRun(run.organizationId, run.id);
  }

  // --- Internals ----------------------------------------------------------

  private loadGraph(input: StartRunInput): {
    graph: WorkflowGraph;
    name: string;
    definitionId: string | null;
  } {
    if (input.inlineGraph) {
      return {
        graph: normalizeWorkflowGraph(input.inlineGraph),
        name: input.name ?? 'workflow',
        definitionId: null,
      };
    }
    // Resolve a definition by name preferring the current channel's copy, then
    // the org-wide one — so `@workflow Foo` in channel A can't pick up a
    // channel-B Foo. listWorkflowDefinitionsForChannel returns channel-scoped
    // rows before org-wide ones, so the first name match is the right one.
    const def = input.definitionId
      ? this.store.getWorkflowDefinition(input.organizationId, input.definitionId)
      : input.definitionName
        ? (this.store
            .listWorkflowDefinitionsForChannel(input.organizationId, input.channelId)
            .find((d) => d.name === input.definitionName) ?? null)
        : null;
    if (!def) {
      throw new Error(
        `Workflow definition not found (${input.definitionId ?? input.definitionName ?? '?'})`,
      );
    }
    return {
      graph: normalizeWorkflowGraph({nodes: def.nodes, edges: def.edges}),
      name: input.name ?? def.name,
      definitionId: def.id,
    };
  }

  private parseGraph(run: WorkflowRun): WorkflowGraph {
    return normalizeWorkflowGraph(JSON.parse(run.graphSnapshot));
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

  private async maybeComplete(organizationId: string, workflowRunId: string): Promise<void> {
    const run = this.store.getWorkflowRun(organizationId, workflowRunId);
    if (!run || run.status !== 'running') return;
    const graph = this.parseGraph(run);
    const latest = latestNodeRuns(this.store.listWorkflowNodeRuns(workflowRunId));
    const mainNodes = graph.nodes.filter((n) => MAIN_FLOW_KINDS.includes(n.kind));
    const anyActive = [...latest.values()].some((nr) => ACTIVE_NODE_STATUSES.has(nr.status));
    const allTerminal = mainNodes.every((n) => {
      const nr = latest.get(n.id);
      return nr ? TERMINAL_DONE_STATUSES.has(nr.status) : false;
    });
    if (allTerminal && !anyActive) {
      this.setRunStatus(organizationId, workflowRunId, 'completed');
      await this.publishState(organizationId, workflowRunId);
      await this.effects.postRunUpdate({
        organizationId,
        channelId: run.channelId,
        originThreadId: run.originThreadId ?? undefined,
        workflowName: run.name,
        workflowRunId,
        status: 'completed',
      });
    }
  }

  /**
   * Post the "⛔ failed" card into the origin thread (same place the start card
   * went), so the origin channel reflects the failure instead of showing a
   * stale "started" card. Safe to call from any failure path.
   */
  private async postFailedCard(organizationId: string, workflowRunId: string): Promise<void> {
    const run = this.store.getWorkflowRun(organizationId, workflowRunId);
    if (!run) return;
    await this.effects.postRunUpdate({
      organizationId,
      channelId: run.channelId,
      originThreadId: run.originThreadId ?? undefined,
      workflowName: run.name,
      workflowRunId,
      status: 'failed',
    });
  }

  private async publishState(organizationId: string, workflowRunId: string): Promise<void> {
    if (!this.effects.publishRunUpdated) return;
    const run = this.store.getWorkflowRun(organizationId, workflowRunId);
    if (!run) return;
    await this.effects.publishRunUpdated({
      organizationId,
      run,
      nodeRuns: this.store.listWorkflowNodeRuns(workflowRunId),
    });
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
