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

  if (task.execution_mode !== 'concurrent') {
    throw new Error(
      `orchestrator: only 'concurrent' execution is wired for MVP (got '${task.execution_mode}')`,
    );
  }

  const sessionController = new AbortController();
  const perAgentControllers = new Map<string, AbortController>();
  let concurrentHandle: ConcurrentRunHandle | undefined;
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
      type SpawnResult =
        | { ok: true; member: AgentRunInputs }
        | { ok: false; agent: AgentDef; reason: string };

      const assignmentByAgent = new Map(assignments.map((a) => [a.agentId, a]));
      const waves =
        assignments.length > 0
          ? topoSortWaves(assignments)
          : [agentDefs.map((a) => a.id)];

      const agentResults: AgentRunResult[] = [];
      const completedOutputs = new Map<string, string>();
      const completedBrowserState = new Map<string, string>();

      for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
        const waveIds = waves[waveIdx];
        if (!waveIds) continue;
        if (sessionController.signal.aborted) break;

        await deps.eventBus.publish(ORCHESTRATOR_EVENT_CHANNEL, {
          event_id: `wave_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'wave_started',
          publisher: 'orchestrator',
          timestamp: new Date().toISOString(),
          task_id: task.task_id,
          session_id: sessionId,
          payload: {
            kind: 'wave_started',
            wave: waveIdx,
            totalWaves: waves.length,
            agents: waveIds,
          },
        });
        if (deps.onStream) {
          deps.onStream({
            event_id: `wave_${waveIdx}`,
            type: 'wave_started',
            publisher: 'orchestrator',
            timestamp: new Date().toISOString(),
            task_id: task.task_id,
            payload: { wave: waveIdx, totalWaves: waves.length, agents: waveIds },
          });
        }

        const waveAgents = waveIds
          .map((id: string) => agentDefs.find((a: AgentDef) => a.id === id))
          .filter((a): a is AgentDef => !!a);

        const memberResults: SpawnResult[] = await Promise.all(
          waveAgents.map(async (agent: AgentDef): Promise<SpawnResult> => {
            try {
              const mcp = await deps.getMCPConnection(agent.mcp, {
                agentId: agent.id,
                scopePaths: readAgentWorkspaceScopes(agent),
              });
              const ctrl = new AbortController();
              perAgentControllers.set(agent.id, ctrl);
              sessionController.signal.addEventListener('abort', () => ctrl.abort(), { once: true });

              let prompt = subpromptByAgent.get(agent.id) ?? task.prompt;
              const assignment = assignmentByAgent.get(agent.id);
              if (assignment?.dependsOn) {
                const predecessorBlocks: string[] = [];
                for (const depId of assignment.dependsOn) {
                  const output = completedOutputs.get(depId);
                  if (output) predecessorBlocks.push(`[Output from ${depId}]:\n${output}`);
                  const browser = completedBrowserState.get(depId);
                  if (browser) predecessorBlocks.push(`[Browser state left by ${depId}]:\n${browser}`);
                }
                const predecessorContext = predecessorBlocks.join('\n\n');
                if (predecessorContext) {
                  prompt = `${predecessorContext}\n\n---\n\n${prompt}`;
                }
              }

              const taskForAgent: TaskDef = { ...task, prompt };
              const member: AgentRunInputs = {
                agent,
                task: taskForAgent,
                sessionId,
                spawnReason: 'initial',
                provider: deps.getProvider(agent),
                mcp,
                permissions: deps.permissions,
                eventBus: deps.eventBus,
                context: deps.context,
                audit: deps.audit,
                agentState: deps.agentState,
                approvals: deps.approvals,
                abortSignal: ctrl.signal,
                onStream: deps.onStream,
                gateResolver: deps.gateResolver,
              };
              return { ok: true, member };
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              return { ok: false, agent, reason };
            }
          }),
        );

        const spawnFailed: AgentRunResult[] = memberResults
          .filter((r): r is Extract<SpawnResult, { ok: false }> => !r.ok)
          .map((r) => ({
            agentId: r.agent.id,
            taskId: task.task_id,
            sessionId,
            exitReason: 'error',
            toolCalls: 0,
            iterations: 0,
            tokensUsed: 0,
            finalText: '',
            error: `spawn failed: ${r.reason}`,
          }));

        const members: AgentRunInputs[] = memberResults
          .filter((r): r is Extract<SpawnResult, { ok: true }> => r.ok)
          .map((r) => r.member);

        let waveResults: AgentRunResult[];
        if (members.length === 0) {
          waveResults = spawnFailed;
        } else {
          concurrentHandle = runConcurrent({ members, sessionAbortSignal: sessionController.signal });
          const live = await concurrentHandle.results;
          waveResults = [...spawnFailed, ...live];
        }

        for (const r of waveResults) {
          if (r.finalText) completedOutputs.set(r.agentId, r.finalText);
          if (r.browserState) {
            completedBrowserState.set(r.agentId, formatBrowserState(r.browserState));
          }
        }
        agentResults.push(...waveResults);
      }

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

  let provider;
  try {
    provider = deps.getProvider(planningAgent);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { assignments: [], error: `planner provider unavailable: ${reason}` };
  }

  try {
    const result = await planAssignments({
      task,
      agents,
      provider,
      model: planningAgent.model,
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
