import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { RunState } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import type { ConversationService } from './conversation.js';
import type { GoalSystemService, ParsedPlanTask } from './goal-system.js';
import type { CreateRunInput } from './spirit-types.js';
import { buildSystemMessage } from './message-factory.js';
import type {
  NotifyInitiatorInput,
  PostRunCardInput,
  PostRunUpdateInput,
  PrepareRunThreadInput,
  RaiseApprovalInput,
  SpawnAgentNodeInput,
  SpawnApproverAgentInput,
  StartGoalInput,
  StatOutputInput,
  WorkflowEffects,
  WorkflowEngineService,
} from './workflow-engine.js';

/**
 * Live implementation of the workflow engine's effect ports — the seam where
 * the (pure, decoupled) engine meets the running system.
 *
 * - spawnAgentNode: stamps the node run's child_run_id, posts the resolved
 *   prompt + wake-context as a system message (no auto-wake), then fires a
 *   Spirit run. Completion is handled by SpiritService's run-completed hook,
 *   which calls `engine.onNodeComplete`.
 * - statOutput: reads the output file under the org's workspace root.
 * - startGoal: hands off to the goal system.
 * - raiseApproval / notifyInitiator: post system messages into the run thread.
 */
export interface LiveWorkflowEffectsDeps {
  repo: ApiRepository;
  conversations: Pick<ConversationService, 'publishMessage'>;
  goals: Pick<GoalSystemService, 'start'>;
  spirits: { createRun(input: CreateRunInput): Promise<RunState> };
  /** Resolve the workspace filesystem root for an org (for output verification). */
  getWorkspaceRoot(organizationId: string): string | undefined;
}

export class LiveWorkflowEffects implements WorkflowEffects {
  private engine?: Pick<WorkflowEngineService, 'onNodeComplete'>;

  constructor(private readonly deps: LiveWorkflowEffectsDeps) {}

  /** Late-bound so spawn failures can be reported back into the engine. */
  setEngine(engine: Pick<WorkflowEngineService, 'onNodeComplete'>): void {
    this.engine = engine;
  }

  async spawnAgentNode(input: SpawnAgentNodeInput): Promise<{ childRunId: string }> {
    const runId = randomUUID();

    // Stamp child_run_id BEFORE the async run starts so workflow.advance and
    // the completion hook can find this node run by the child run id.
    const nodeRun = this.deps.repo.getWorkflowNodeRun(input.workflowRunId, input.nodeRunId);
    if (nodeRun) {
      this.deps.repo.saveWorkflowNodeRun({ ...nodeRun, childRunId: runId });
    }

    // Give the agent its task: prompt + wake-context, posted without waking
    // anyone (we drive the run explicitly below).
    const content = `${input.prompt}\n\n${input.systemPromptSuffix}`;
    const message = buildSystemMessage({
      organizationId: input.organizationId,
      threadId: input.threadId,
      channelId: input.channelId,
      content,
    });
    this.deps.conversations.publishMessage(message, [], undefined, { wakePolicy: 'never' });

    // Fire the run; completion is handled by the run-completed hook.
    void this.deps.spirits
      .createRun({
        organizationId: input.organizationId,
        agentId: input.agentId,
        threadId: input.threadId,
        runId,
        sourceMessageId: message.id,
        byMemberId: input.initiatedBy,
        summary: `Workflow ${input.workflowName} · step ${input.nodeId}`,
      })
      .catch((err) => {
        void this.engine?.onNodeComplete({
          organizationId: input.organizationId,
          workflowRunId: input.workflowRunId,
          nodeRunId: input.nodeRunId,
          failed: true,
          failureReason: `spawn_failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      });

    return { childRunId: runId };
  }

  async raiseApproval(input: RaiseApprovalInput): Promise<{ approvalRequestId: string }> {
    // The gate is surfaced through the shared approval queue (the "Approval N of
    // M" card + floating pending pill), sourced live from run/node-run state via
    // GET /api/workflow-approvals — no inline channel card. The node run's
    // approvalRequestId is what the queue keys on.
    return { approvalRequestId: randomUUID() };
  }

  async startGoal(input: StartGoalInput): Promise<{ goalId: string }> {
    const agents = this.deps.repo
      .listMembers(input.organizationId)
      .filter((m) => m.kind === 'agent' && !m.retiredAt);
    const agentIds = new Set(agents.map((a) => a.id));
    const fallbackAssignee = agents[0]?.id ?? input.initiatedBy;
    const supervisorId = agents[0]?.id ?? input.initiatedBy;

    const rawTasks = Array.isArray(input.tasks) ? input.tasks : [];
    const tasks: ParsedPlanTask[] = rawTasks.map((raw) => {
      const t = (raw ?? {}) as { title?: string; assigneeId?: string };
      const assigneeId = t.assigneeId && agentIds.has(t.assigneeId) ? t.assigneeId : fallbackAssignee;
      return { title: t.title ?? 'Task', assigneeId };
    });
    if (tasks.length === 0) {
      tasks.push({ title: input.title, assigneeId: fallbackAssignee });
    }

    const result = this.deps.goals.start({
      organizationId: input.organizationId,
      channelId: input.channelId,
      supervisorId,
      title: input.title,
      planMarkdown: `Created by workflow run ${input.workflowRunId}.`,
      tasks,
    });
    return { goalId: result.goal.id };
  }

  async statOutput(
    input: StatOutputInput,
  ): Promise<{ sha256: string; sizeBytes: number } | null> {
    const root = this.deps.getWorkspaceRoot(input.organizationId);
    if (!root) return null;
    try {
      const abs = join(root, input.path);
      const stat = statSync(abs);
      if (!stat.isFile()) return null;
      const buf = readFileSync(abs);
      return { sha256: createHash('sha256').update(buf).digest('hex'), sizeBytes: stat.size };
    } catch {
      return null;
    }
  }

  async getRunStatus(input: {
    organizationId: string;
    runId: string;
  }): Promise<string | null> {
    return this.deps.repo.getRun(input.organizationId, input.runId)?.status ?? null;
  }

  async prepareRunThread(input: PrepareRunThreadInput): Promise<{threadId: string}> {
    // A dedicated thread inside the origin channel with the workflow's agents as
    // members — agents run here (isolated), and membership is guaranteed.
    const threadId = `wf-run-${input.workflowRunId}`;
    const memberIds = [...new Set([input.initiatedBy, ...input.agentIds])];
    this.deps.repo.ensureThread({
      id: threadId,
      organizationId: input.organizationId,
      channelId: input.channelId,
      memberIds,
      title: `Workflow: ${input.workflowName}`,
      createdAt: new Date().toISOString(),
    });
    return {threadId};
  }

  async postRunCard(input: PostRunCardInput): Promise<void> {
    const content = `▶ Workflow "${input.workflowName}" started in this channel`;
    this.deps.conversations.publishMessage(
      buildSystemMessage({
        organizationId: input.organizationId,
        threadId: input.originThreadId,
        channelId: input.channelId,
        content,
        metadata: {
          workflowRunMarker: {
            workflowRunId: input.workflowRunId,
            workflowName: input.workflowName,
            phase: 'started',
          },
        },
      }),
      [],
      undefined,
      {wakePolicy: 'never'},
    );
  }

  async postRunUpdate(input: PostRunUpdateInput): Promise<void> {
    const done = input.status === 'completed';
    const content = `${done ? '✅' : '⛔'} Workflow "${input.workflowName}" ${done ? 'completed' : 'failed'}`;
    this.deps.conversations.publishMessage(
      buildSystemMessage({
        organizationId: input.organizationId,
        threadId: input.channelId,
        channelId: input.channelId,
        content,
        metadata: {
          workflowRunMarker: {
            workflowRunId: input.workflowRunId,
            workflowName: input.workflowName,
            phase: done ? 'completed' : 'failed',
          },
        },
      }),
      [],
      undefined,
      {wakePolicy: 'never'},
    );
  }

  async spawnApproverAgent(input: SpawnApproverAgentInput): Promise<void> {
    const runId = randomUUID();
    const content = [
      `## Approval review`,
      `You are the approver for the "${input.nodeId}" gate of workflow "${input.workflowName}" (run \`${input.workflowRunId}\`).`,
      input.priorSummary ? `Prior step summary: ${input.priorSummary}` : '',
      input.priorOutputPath
        ? `Read the document at \`${input.priorOutputPath}\` with the view tool and judge whether it meets the bar.`
        : '',
      `Then call \`workflow.transition\` with { run_id: "${input.workflowRunId}", action: "approve" or "reject", idempotency_key: a fresh uuid, and rejection_reason if you reject }.`,
      `Your only job is to approve or reject this gate — do nothing else.`,
    ]
      .filter(Boolean)
      .join('\n');
    const message = buildSystemMessage({
      organizationId: input.organizationId,
      threadId: input.threadId,
      channelId: input.channelId,
      content,
    });
    this.deps.conversations.publishMessage(message, [], undefined, {wakePolicy: 'never'});
    void this.deps.spirits
      .createRun({
        organizationId: input.organizationId,
        agentId: input.approverAgentId,
        threadId: input.threadId,
        runId,
        sourceMessageId: message.id,
        summary: `Workflow ${input.workflowName} · approve gate ${input.nodeId}`,
      })
      .catch(() => {
        // approver run failed to start; the gate stays open for a human.
      });
  }

  async notifyInitiator(input: NotifyInitiatorInput): Promise<void> {
    const actions = input.actions ? ` Actions available: ${input.actions.join(' / ')} (in the run view).` : '';
    const content = `⚠️ Workflow "${input.workflowRun.name}" needs attention — ${input.reason}.${actions}`;
    this.deps.conversations.publishMessage(
      buildSystemMessage({
        organizationId: input.organizationId,
        threadId: input.workflowRun.threadId,
        channelId: input.workflowRun.channelId,
        content,
      }),
      [],
      undefined,
      { wakePolicy: 'never' },
    );
  }
}
