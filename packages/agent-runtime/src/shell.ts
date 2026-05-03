import type { UjimaEvent } from '@ujima/shared';
import type { LLMMessage } from '@ujima/llm/legacy';
import { hydrate } from './hydrate';
import { runAiSdkLoop } from './ai-sdk-loop';
import type { AgentRunInputs, AgentRunResult, ExitReason } from './types';

const DEFAULT_MAX_ITERATIONS = 12;
const DEFAULT_HEARTBEAT_MS = 10_000;

export interface AgentHandle {
  agentId: string;
  taskId: string;
  sessionId: string;
  readonly result: Promise<AgentRunResult>;
  kill(): void;
  isRunning(): boolean;
}

export function runAgent(inputs: AgentRunInputs): AgentHandle {
  const controller = new AbortController();
  const externalSignal = inputs.abortSignal;
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let running = true;
  const result = execute(inputs, controller).finally(() => {
    running = false;
  });

  return {
    agentId: inputs.agent.id,
    taskId: inputs.task.task_id,
    sessionId: inputs.sessionId,
    result,
    kill: () => controller.abort(),
    isRunning: () => running,
  };
}

async function execute(inputs: AgentRunInputs, controller: AbortController): Promise<AgentRunResult> {
  const {
    agent,
    task,
    sessionId,
    model,
    mcp,
    permissions,
    eventBus,
    context,
    audit,
    agentState,
    approvals,
    maxToolIterations = DEFAULT_MAX_ITERATIONS,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS,
    abortSignal,
    onEvent,
    onStream,
    gateResolver,
  } = inputs;

  if (!model) {
    throw new Error("runAgent: requires `model` (AI SDK LanguageModel).");
  }
  // Narrow for the dispatch below — lint disallows non-null assertions.
  const activeModel = model;

  await agentState.upsert(agent.id, { status: 'active', last_action: 'starting' });
  await audit.write({
    event_id: `spawn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    event_type: 'spawn',
    agent_id: agent.id,
    task_id: task.task_id,
    session_id: sessionId,
    allowed: true,
  });

  const heartbeat = setInterval(() => {
    void agentState.heartbeat(agent.id);
  }, heartbeatIntervalMs);
  heartbeat.unref();

  const emit = async (event: UjimaEvent): Promise<void> => {
    for (const channel of agent.communication.publishes) {
      await eventBus.publish(channel, event);
    }
    if (agent.communication.publishes.length === 0) {
      await eventBus.publish(`agent:${agent.id}`, event);
    }
    onEvent?.(event);
  };

  try {
    console.log(`\n🚀 [Agent Run Start] "${agent.name}"`);
    console.log(`   Task: ${task.task_id} | Session: ${sessionId}`);
    
    const bundle = inputs.hydration ?? (await hydrate({
      agent,
      task,
      context,
      eventBus,
      approvals,
    }));

    const tools = await mcp.listTools();

    const outcome = await runAiSdkLoop({
      agent,
      taskId: task.task_id,
      sessionId,
      model: activeModel,
      mcp,
      tools,
      permissions,
      audit,
      systemPrompt: bundle.systemPrompt,
      userPrompt: bundle.taskPrompt,
      maxIterations: maxToolIterations,
      abortSignal,
      emitEvent: emit,
      onStream,
      gateResolver,
    });

    const outputKey = `task:${task.task_id}:agent:${agent.id}:output`;
    await context.put(outputKey, {
      agentId: agent.id,
      taskId: task.task_id,
      exitReason: outcome.exitReason,
      finalText: outcome.finalText,
      toolCalls: outcome.toolCalls,
      iterations: outcome.iterations,
      tokensUsed: outcome.tokensUsed,
      completedAt: Date.now(),
    });

    if (outcome.browserState) {
      const browserKey = `task:${task.task_id}:agent:${agent.id}:browser_state`;
      await context.put(browserKey, {
        agentId: agent.id,
        taskId: task.task_id,
        ...outcome.browserState,
      });
    }

    const exitReason: ExitReason = outcome.exitReason;
    await agentState.upsert(agent.id, {
      status: exitReason === 'completed' ? 'exited' : exitReason === 'killed' ? 'killed' : 'blocked',
      last_action: exitReason,
    });

    await audit.write({
      event_id: `exit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      event_type: 'exit',
      agent_id: agent.id,
      task_id: task.task_id,
      session_id: sessionId,
      allowed: true,
      tool_output: { exitReason, toolCalls: outcome.toolCalls, tokensUsed: outcome.tokensUsed },
    });

    await emit({
      event_id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: 'agent_exited',
      publisher: agent.id,
      timestamp: new Date().toISOString(),
      task_id: task.task_id,
      session_id: sessionId,
      payload: { exitReason, outputKey, finalText: outcome.finalText },
    });

    return {
      agentId: agent.id,
      taskId: task.task_id,
      sessionId,
      exitReason,
      toolCalls: outcome.toolCalls,
      iterations: outcome.iterations,
      tokensUsed: outcome.tokensUsed,
      finalText: outcome.finalText,
      escalationReason: outcome.escalationReason,
      error: outcome.error,
      browserState: outcome.browserState,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await agentState.upsert(agent.id, { status: 'blocked', last_action: `error: ${message}` });
    await audit.write({
      event_id: `exit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      event_type: 'exit',
      agent_id: agent.id,
      task_id: task.task_id,
      session_id: sessionId,
      allowed: false,
      block_reason: message,
    });
    return {
      agentId: agent.id,
      taskId: task.task_id,
      sessionId,
      exitReason: 'error',
      toolCalls: 0,
      iterations: 0,
      tokensUsed: 0,
      finalText: '',
      error: message,
    };
  } finally {
    clearInterval(heartbeat);
  }
}
