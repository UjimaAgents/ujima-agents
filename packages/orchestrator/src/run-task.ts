import type { AgentDef, TaskDef } from '@ujima/shared';
import type { AgentRunInputs, AgentRunResult, BrowserStateSnapshot } from '@ujima/agent-runtime';
import { runConcurrent, type ConcurrentRunHandle } from '@ujima/agent-runtime';
import { resolveManualTeam } from './manual-mode';
import { wireApprovalsGate } from './approvals-gate';
import { synthesizeTask } from './synthesis';
import { planAssignments, type PlanAssignment } from './plan';
import {
  ORCHESTRATOR_EVENT_CHANNEL,
  type OrchestratorDeps,
  type RunTaskInputs,
  type RunTaskResult,
  type SessionHandle,
  type TaskStatus,
} from './types';

export function runTask(deps: OrchestratorDeps, input: RunTaskInputs): SessionHandle {
  const { task, team, sessionId } = input;

  const sessionController = new AbortController();
  const perAgentControllers = new Map<string, AbortController>();
  let agentDefs: AgentDef[] = [];

  const result = execute();

  return {
    sessionId,
    taskId: task.task_id,
    result,
    killAgent(agentId: string) {
      perAgentControllers.get(agentId)?.abort();
    },
    killSession() {
      sessionController.abort();
    },
    agentIds() {
      return agentDefs.map((a) => a.id);
    },
  };

  async function execute(): Promise<RunTaskResult> {
    const resolution = await resolveManualTeam(deps, team);
    agentDefs = resolution.agents;

    if (resolution.missing.length > 0) {
      const error = `unknown agents in team: ${resolution.missing.join(', ')}`;
      return {
        taskId: task.task_id,
        sessionId,
        status: 'failed',
        agentResults: [],
        approvalsPending: 0,
        output: {
          summary: error,
          agents: [],
          pendingApprovals: [],
        },
        error,
      };
    }

    if (agentDefs.length === 0) {
      const error = 'team has no agents';
      return {
        taskId: task.task_id,
        sessionId,
        status: 'failed',
        agentResults: [],
        approvalsPending: 0,
        output: { summary: error, agents: [], pendingApprovals: [] },
        error,
      };
    }

    let assignments: PlanAssignment[] = [];
    const subpromptByAgent = new Map<string, string>();
    if (task.orchestrator_mode === 'auto' && agentDefs.length > 1) {
      const planOutcome = await runPlanner(deps, agentDefs, task, sessionId);
      if (planOutcome.error) {
        return {
          taskId: task.task_id,
          sessionId,
          status: 'failed',
          agentResults: [],
          approvalsPending: 0,
          output: { summary: planOutcome.error, agents: [], pendingApprovals: [] },
          error: planOutcome.error,
        };
      }
      assignments = planOutcome.assignments;
      for (const a of assignments) subpromptByAgent.set(a.agentId, a.subprompt);
      agentDefs = agentDefs.filter((a) => subpromptByAgent.has(a.id));
    }

    const approvalChannels = collectApprovalChannels(agentDefs);
    const approvalsHandle = wireApprovalsGate({
      eventBus: deps.eventBus,
      approvals: deps.approvals,
      taskId: task.task_id,
      sessionId,
      channels: approvalChannels,
    });

    await deps.eventBus.publish(ORCHESTRATOR_EVENT_CHANNEL, {
      event_id: `orc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'task_started',
      publisher: 'orchestrator',
      timestamp: new Date().toISOString(),
      task_id: task.task_id,
      session_id: sessionId,
      payload: {
        kind: 'task_started',
        team_id: team.team_id,
        agent_ids: agentDefs.map((a) => a.id),
      },
    });

    if (deps.taskState) {
      const existing = await deps.taskState.get(task.task_id);
      if (!existing) {
        await deps.taskState.start(task.task_id, { team_id: team.team_id, session_id: sessionId });
      } else {
        await deps.taskState.setStatus(task.task_id, 'running');
      }
    }

    try {
      const executionState = {
        completedOutputs: new Map<string, string>(),
        completedBrowserState: new Map<string, string>(),
      };

      const agentResults =
        task.execution_mode === 'slim'
          ? await runSlimTask({
              deps,
              input,
              agentDefs,
              sessionController,
              perAgentControllers,
              subpromptByAgent,
              executionState,
            })
          : await runConcurrentTask({
              deps,
              input,
              agentDefs,
              assignments,
              sessionController,
              perAgentControllers,
              subpromptByAgent,
              executionState,
            });

      const status: TaskStatus = deriveStatus(agentResults, sessionController.signal.aborted);
      const synth = await synthesizeTask({
        taskId: task.task_id,
        context: deps.context,
        approvals: deps.approvals,
        agentResults,
      });

      await deps.eventBus.publish(ORCHESTRATOR_EVENT_CHANNEL, {
        event_id: `orc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: status === 'completed' ? 'task_completed' : 'task_failed',
        publisher: 'orchestrator',
        timestamp: new Date().toISOString(),
        task_id: task.task_id,
        session_id: sessionId,
        payload: {
          kind: status === 'completed' ? 'task_completed' : 'task_failed',
          status,
          approvals_pending: synth.pendingApprovals.length,
        },
      });

      if (deps.taskState) {
        if (status === 'completed') {
          await deps.taskState.end(task.task_id, 'complete');
        } else if (status === 'failed') {
          await deps.taskState.end(task.task_id, 'failed');
        } else if (status === 'paused') {
          await deps.taskState.setStatus(task.task_id, 'paused');
        }
      }

      return {
        taskId: task.task_id,
        sessionId,
        status,
        agentResults,
        approvalsPending: synth.pendingApprovals.length,
        output: synth,
      };
    } finally {
      approvalsHandle.stop();
    }
  }
}

function readAgentWorkspaceScopes(agent: AgentDef): string[] | undefined {
  const candidate = (agent as AgentDef & { workspace_scopes?: unknown }).workspace_scopes;
  if (!Array.isArray(candidate)) {
    return undefined;
  }
  const scopes = candidate.filter((value): value is string => typeof value === 'string');
  return scopes.length > 0 ? scopes : undefined;
}

function collectApprovalChannels(agents: AgentDef[]): string[] {
  const set = new Set<string>();
  for (const agent of agents) {
    for (const ch of agent.communication.publishes) set.add(ch);
    set.add(`agent:${agent.id}`);
  }
  return [...set];
}

interface ExecutionState {
  completedOutputs: Map<string, string>;
  completedBrowserState: Map<string, string>;
}

type SpawnResult =
  | { ok: true; member: AgentRunInputs }
  | { ok: false; agent: AgentDef; reason: string };

async function runConcurrentTask(input: {
  deps: OrchestratorDeps;
  input: RunTaskInputs;
  agentDefs: AgentDef[];
  assignments: PlanAssignment[];
  sessionController: AbortController;
  perAgentControllers: Map<string, AbortController>;
  subpromptByAgent: Map<string, string>;
  executionState: ExecutionState;
}): Promise<AgentRunResult[]> {
  const { deps, input: runInput, agentDefs, assignments, sessionController, executionState } = input;
  const assignmentByAgent = new Map(assignments.map((assignment) => [assignment.agentId, assignment]));
  const waves =
    assignments.length > 0
      ? topoSortWaves(assignments)
      : [agentDefs.map((agent) => agent.id)];

  const agentResults: AgentRunResult[] = [];

  for (let waveIdx = 0; waveIdx < waves.length; waveIdx += 1) {
    const waveIds = waves[waveIdx];
    if (!waveIds || sessionController.signal.aborted) {
      continue;
    }

    await publishWaveStarted(
      deps,
      runInput,
      waveIdx,
      waves.length,
      waveIds,
    );

    const waveAgents = waveIds
      .map((id) => agentDefs.find((agent) => agent.id === id))
      .filter((agent): agent is AgentDef => Boolean(agent));

    const memberResults = await Promise.all(
      waveAgents.map((agent) =>
        spawnAgentRun({
          deps,
          agent,
          task: runInput.task,
          sessionId: runInput.sessionId,
          sessionController,
          perAgentControllers: input.perAgentControllers,
          subprompt: input.subpromptByAgent.get(agent.id),
          dependsOn: assignmentByAgent.get(agent.id)?.dependsOn,
          executionState,
        }),
      ),
    );

    const spawnFailed = memberResults
      .filter((result): result is Extract<SpawnResult, { ok: false }> => !result.ok)
      .map((result) => failedSpawnResult(runInput, result.agent, result.reason));

    const members = memberResults
      .filter((result): result is Extract<SpawnResult, { ok: true }> => result.ok)
      .map((result) => result.member);

    let waveResults: AgentRunResult[];
    if (members.length === 0) {
      waveResults = spawnFailed;
    } else {
      const handle: ConcurrentRunHandle = runConcurrent({
        members,
        sessionAbortSignal: sessionController.signal,
      });
      const live = await handle.results;
      waveResults = [...spawnFailed, ...live];
    }

    recordCompletedStageOutputs(executionState, waveResults);
    agentResults.push(...waveResults);
  }

  return agentResults;
}

async function runSlimTask(input: {
  deps: OrchestratorDeps;
  input: RunTaskInputs;
  agentDefs: AgentDef[];
  sessionController: AbortController;
  perAgentControllers: Map<string, AbortController>;
  subpromptByAgent: Map<string, string>;
  executionState: ExecutionState;
}): Promise<AgentRunResult[]> {
  const {
    deps,
    input: runInput,
    agentDefs,
    sessionController,
    perAgentControllers,
    subpromptByAgent,
    executionState,
  } = input;

  const sequence = resolveSlimSequence(agentDefs, runInput.sequence);
  const agentResults: AgentRunResult[] = [];

  for (let stageIdx = 0; stageIdx < sequence.length; stageIdx += 1) {
    const agentId = sequence[stageIdx];
    if (!agentId) {
      continue;
    }
    const checkpoint = await readSlimCheckpoint(deps, runInput.task.task_id, stageIdx);
    if (checkpoint) {
      // Slim mode resumes by replaying persisted stage outputs back into the
      // in-memory execution state, so later stages see the same predecessor
      // context they would have seen during the original run.
      agentResults.push(checkpoint.result);
      if (checkpoint.result.finalText) {
        executionState.completedOutputs.set(checkpoint.result.agentId, checkpoint.result.finalText);
      }
      if (checkpoint.browserState) {
        executionState.completedBrowserState.set(checkpoint.result.agentId, checkpoint.browserState);
      }
      continue;
    }

    if (sessionController.signal.aborted) {
      break;
    }

    await publishWaveStarted(deps, runInput, stageIdx, sequence.length, [agentId]);

    const agent = agentDefs.find((candidate) => candidate.id === agentId);
    if (!agent) {
      agentResults.push(
        failedSpawnResult(runInput, { id: agentId } as AgentDef, `unknown agent in slim sequence: ${agentId}`),
      );
      break;
    }

    const spawned = await spawnAgentRun({
      deps,
      agent,
      task: runInput.task,
      sessionId: runInput.sessionId,
      sessionController,
      perAgentControllers,
      subprompt: subpromptByAgent.get(agent.id),
      executionState,
    });
    if (!spawned.ok) {
      agentResults.push(failedSpawnResult(runInput, agent, spawned.reason));
      break;
    }

    const handle = runConcurrent({
      members: [spawned.member],
      sessionAbortSignal: sessionController.signal,
    });
    const [result] = await handle.results;
    if (!result) {
      break;
    }

    agentResults.push(result);
    recordCompletedStageOutputs(executionState, [result]);

    if (result.exitReason === 'completed') {
      await writeSlimCheckpoint(deps, runInput.task.task_id, stageIdx, result, executionState);
    } else {
      break;
    }
  }

  return agentResults;
}

async function publishWaveStarted(
  deps: OrchestratorDeps,
  input: RunTaskInputs,
  waveIdx: number,
  totalWaves: number,
  agentIds: string[],
): Promise<void> {
  await deps.eventBus.publish(ORCHESTRATOR_EVENT_CHANNEL, {
    event_id: `wave_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'wave_started',
    publisher: 'orchestrator',
    timestamp: new Date().toISOString(),
    task_id: input.task.task_id,
    session_id: input.sessionId,
    payload: {
      kind: 'wave_started',
      wave: waveIdx,
      totalWaves,
      agents: agentIds,
    },
  });
  if (deps.onStream) {
    deps.onStream({
      event_id: `wave_${waveIdx}`,
      type: 'wave_started',
      publisher: 'orchestrator',
      timestamp: new Date().toISOString(),
      task_id: input.task.task_id,
      payload: { wave: waveIdx, totalWaves, agents: agentIds },
    });
  }
}

async function spawnAgentRun(input: {
  deps: OrchestratorDeps;
  agent: AgentDef;
  task: TaskDef;
  sessionId: string;
  sessionController: AbortController;
  perAgentControllers: Map<string, AbortController>;
  subprompt?: string;
  dependsOn?: string[];
  executionState: ExecutionState;
}): Promise<SpawnResult> {
  try {
    const mcp = await input.deps.getMCPConnection(input.agent.mcp, {
      agentId: input.agent.id,
      scopePaths: readAgentWorkspaceScopes(input.agent),
    });
    const ctrl = new AbortController();
    input.perAgentControllers.set(input.agent.id, ctrl);
    if (input.sessionController.signal.aborted) {
      ctrl.abort();
    } else {
      input.sessionController.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    }

    let prompt = input.subprompt ?? input.task.prompt;
    if (input.dependsOn && input.dependsOn.length > 0) {
      prompt = applyPredecessorContext(prompt, input.dependsOn, input.executionState);
    } else if (input.executionState.completedOutputs.size > 0 || input.executionState.completedBrowserState.size > 0) {
      prompt = applyPredecessorContext(
        prompt,
        [...new Set([
          ...input.executionState.completedOutputs.keys(),
          ...input.executionState.completedBrowserState.keys(),
        ])],
        input.executionState,
      );
    }

    const taskForAgent: TaskDef = { ...input.task, prompt };
    const member: AgentRunInputs = {
      agent: input.agent,
      task: taskForAgent,
      sessionId: input.sessionId,
      spawnReason: 'initial',
      model: input.deps.getModel(input.agent),
      mcp,
      permissions: input.deps.permissions,
      eventBus: input.deps.eventBus,
      context: input.deps.context,
      audit: input.deps.audit,
      agentState: input.deps.agentState,
      approvals: input.deps.approvals,
      taskState: input.deps.taskState,
      abortSignal: ctrl.signal,
      onStream: input.deps.onStream,
      gateResolver: input.deps.gateResolver,
    };
    return { ok: true, member };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, agent: input.agent, reason };
  }
}

function applyPredecessorContext(
  prompt: string,
  dependsOn: readonly string[],
  executionState: ExecutionState,
): string {
  const predecessorBlocks: string[] = [];
  for (const depId of dependsOn) {
    const output = executionState.completedOutputs.get(depId);
    if (output) predecessorBlocks.push(`[Output from ${depId}]:\n${output}`);
    const browser = executionState.completedBrowserState.get(depId);
    if (browser) predecessorBlocks.push(`[Browser state left by ${depId}]:\n${browser}`);
  }
  const predecessorContext = predecessorBlocks.join('\n\n');
  if (!predecessorContext) {
    return prompt;
  }
  return `${predecessorContext}\n\n---\n\n${prompt}`;
}

function recordCompletedStageOutputs(
  executionState: ExecutionState,
  results: readonly AgentRunResult[],
): void {
  for (const result of results) {
    if (result.finalText) {
      executionState.completedOutputs.set(result.agentId, result.finalText);
    }
    if (result.browserState) {
      executionState.completedBrowserState.set(result.agentId, formatBrowserState(result.browserState));
    }
  }
}

function failedSpawnResult(
  input: RunTaskInputs,
  agent: { id: string },
  reason: string,
): AgentRunResult {
  return {
    agentId: agent.id,
    taskId: input.task.task_id,
    sessionId: input.sessionId,
    exitReason: 'error',
    toolCalls: 0,
    iterations: 0,
    tokensUsed: 0,
    finalText: '',
    error: `spawn failed: ${reason}`,
  };
}

function resolveSlimSequence(agentDefs: AgentDef[], requested?: readonly string[]): string[] {
  const available = new Set(agentDefs.map((agent) => agent.id));
  if (!requested || requested.length === 0) {
    return agentDefs.map((agent) => agent.id);
  }
  const sequence = requested.filter((agentId, index) => requested.indexOf(agentId) === index);
  const valid = sequence.filter((agentId) => available.has(agentId));
  return valid.length > 0 ? valid : agentDefs.map((agent) => agent.id);
}

interface SlimCheckpointRecord {
  stage: number;
  agentId: string;
  result: AgentRunResult;
  browserState?: string;
}

async function readSlimCheckpoint(
  deps: OrchestratorDeps,
  taskId: string,
  stage: number,
): Promise<SlimCheckpointRecord | undefined> {
  return deps.context.get<SlimCheckpointRecord>(slimCheckpointKey(taskId, stage));
}

async function writeSlimCheckpoint(
  deps: OrchestratorDeps,
  taskId: string,
  stage: number,
  result: AgentRunResult,
  executionState: ExecutionState,
): Promise<void> {
  await deps.context.put(slimCheckpointKey(taskId, stage), {
    stage,
    agentId: result.agentId,
    result,
    browserState: executionState.completedBrowserState.get(result.agentId),
  } satisfies SlimCheckpointRecord);
}

function slimCheckpointKey(taskId: string, stage: number): string {
  return `task:${taskId}:slim:checkpoint:${stage}`;
}

async function runPlanner(
  deps: OrchestratorDeps,
  agents: AgentDef[],
  task: TaskDef,
  sessionId: string,
): Promise<{ assignments: PlanAssignment[]; error?: string }> {
  const planningAgent = agents[0];
  if (!planningAgent) return { assignments: [], error: 'planner: no agents to pick from' };

  await deps.eventBus.publish(ORCHESTRATOR_EVENT_CHANNEL, {
    event_id: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'planning_started',
    publisher: 'orchestrator',
    timestamp: new Date().toISOString(),
    task_id: task.task_id,
    session_id: sessionId,
    payload: { kind: 'planning_started', candidate_agent_ids: agents.map((a) => a.id) },
  });

  try {
    const result = await planAssignments({
      task,
      agents,
      model: deps.getModel(planningAgent),
    });

    await deps.eventBus.publish(ORCHESTRATOR_EVENT_CHANNEL, {
      event_id: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'planning_completed',
      publisher: 'orchestrator',
      timestamp: new Date().toISOString(),
      task_id: task.task_id,
      session_id: sessionId,
      payload: {
        kind: 'planning_completed',
        assignments: result.assignments,
        warnings: result.warnings,
      },
    });

    if (deps.onStream) {
      deps.onStream({
        event_id: `plan_done_${Date.now()}`,
        type: 'planning_completed',
        publisher: 'orchestrator',
        timestamp: new Date().toISOString(),
        task_id: task.task_id,
        payload: {
          assignments: result.assignments.map((a) => ({
            agentId: a.agentId,
            subprompt: a.subprompt,
            dependsOn: a.dependsOn ?? [],
          })),
          warnings: result.warnings,
          rawText: result.rawText.slice(0, 500),
        },
      });
    }

    if (result.assignments.length === 0) {
      const detail = result.warnings.length ? ` (${result.warnings.join('; ')})` : '';
      return {
        assignments: [],
        error: `planner returned no assignments${detail}. Raw: ${result.rawText.slice(0, 300)}`,
      };
    }
    return { assignments: result.assignments };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { assignments: [], error: `planner failed: ${reason}` };
  }
}

export function topoSortWaves(assignments: PlanAssignment[]): string[][] {
  const waves: string[][] = [];
  const placed = new Set<string>();
  const remaining = new Map(assignments.map((a) => [a.agentId, a]));

  while (remaining.size > 0) {
    const wave: string[] = [];
    for (const [id, a] of remaining) {
      const deps = a.dependsOn ?? [];
      if (deps.every((d) => placed.has(d))) {
        wave.push(id);
      }
    }
    if (wave.length === 0) {
      wave.push(...remaining.keys());
    }
    for (const id of wave) {
      remaining.delete(id);
      placed.add(id);
    }
    waves.push(wave);
  }

  return waves;
}

function formatBrowserState(state: BrowserStateSnapshot): string {
  const lines: string[] = [];
  if (state.url) lines.push(`- URL: ${state.url}`);
  if (state.title) lines.push(`- Title: ${state.title}`);
  if (state.screenshotRef) lines.push(`- Screenshot: ${state.screenshotRef}`);
  if (state.mcpId) lines.push(`- Source MCP: ${state.mcpId}`);
  if (state.observedAt) lines.push(`- Observed at: ${state.observedAt}`);
  return lines.join('\n') || '(empty)';
}

function deriveStatus(results: AgentRunResult[], sessionAborted: boolean): TaskStatus {
  if (sessionAborted) return 'paused';
  const hasError = results.some((r) => r.exitReason === 'error');
  if (hasError) return 'failed';
  const hasKilled = results.some((r) => r.exitReason === 'killed');
  if (hasKilled) return 'paused';
  return 'completed';
}
