import {
  stepCountIs,
  tool,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import { z } from 'zod';
import type { AgentDef, UjimaEvent } from '@ujima/shared';
import { DEFAULT_SPIRIT_TEMPERATURE } from '@ujima/shared';
import type { AuditLog } from '@ujima/context-store';
import type { MCPConnection, ToolInfo } from '@ujima/mcp-client';
import type { PermissionMiddleware } from '@ujima/permissions';
import { matchesEscalation } from './escalation';
import { runAgentLoopWithRetry, supportsTemperature, wrapToolFallback } from './loop-host';

/**
 * Agent-runtime task-mode host wrapper. Tool execution stays local here,
 * while the loop machinery (tool adapter, retry/compaction policy) lives in
 * `./loop-host`, shared with the orchestrator's spirit-mode host.
 */
export interface AiSdkLoopInputs {
  agent: AgentDef;
  taskId: string;
  sessionId: string;
  model: LanguageModel;
  mcp: MCPConnection;
  tools: ToolInfo[];
  permissions: PermissionMiddleware;
  audit: AuditLog;
  systemPrompt: string;
  userPrompt: string;
  /** Per-wake context messages (Zone 2). Prepended before the user prompt
   * so the system prompt stays cache-stable. */
  contextMessages?: ModelMessage[];
  maxIterations: number;
  abortSignal?: AbortSignal;
  emitEvent?: (event: UjimaEvent) => Promise<void> | void;
  onStream?: (event: UjimaEvent) => void;
  /** Optional max tokens cap per turn; defaults to the provider's own cap. */
  maxOutputTokens?: number;
  /** Temperature override; defaults to 0.2 (matches AiService). */
  temperature?: number;
}

import { type BrowserStateSnapshot, captureBrowserState } from './browser';

export interface AiSdkLoopOutcome {
  exitReason: 'completed' | 'escalated' | 'token_cap_exceeded' | 'killed' | 'error';
  escalationReason?: string;
  error?: string;
  toolCalls: number;
  iterations: number;
  tokensUsed: number;
  finalText: string;
  browserState?: BrowserStateSnapshot;
  /**
   * AI SDK `usage` breakdown for cost-meter wiring (E0.1.5). Zero when the
   * provider doesn't surface usage.
   */
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

// Control-flow sentinels. streamText treats `execute` throwing as an error
// returned to the model; we instead use these to force a non-model-visible
// exit from the loop (token cap, kill, human reject).
class LoopExit extends Error {
  constructor(readonly outcome: Partial<AiSdkLoopOutcome>) {
    super(outcome.exitReason ?? 'error');
    this.name = 'LoopExit';
  }
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') return true;
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  );
}

function loopExitFrom(err: unknown): LoopExit | undefined {
  if (err instanceof LoopExit) return err;
  let cur: unknown = err;
  for (let i = 0; i < 6 && cur instanceof Error; i++) {
    const c = (cur as Error & { cause?: unknown }).cause;
    if (c instanceof LoopExit) return c;
    cur = c;
  }
  return undefined;
}

function genEventId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function runAiSdkLoop(input: AiSdkLoopInputs): Promise<AiSdkLoopOutcome> {
  const {
    agent,
    taskId,
    sessionId,
    model,
    mcp,
    tools: mcpTools,
    permissions,
    audit,
    systemPrompt,
    userPrompt,
    maxIterations,
    abortSignal,
    emitEvent,
    onStream,
    maxOutputTokens,
    temperature = DEFAULT_SPIRIT_TEMPERATURE,
  } = input;

  let toolCalls = 0;
  let iterations = 0;
  let browserState: BrowserStateSnapshot | undefined;
  let forcedExit: Partial<AiSdkLoopOutcome> | undefined;

  const stream = (type: string, payload: unknown): void => {
    if (!onStream) return;
    try {
      onStream({
        event_id: genEventId('str'),
        type,
        publisher: agent.id,
        timestamp: new Date().toISOString(),
        task_id: taskId,
        session_id: sessionId,
        payload,
      });
    } catch {
      // stream listeners must never break the loop
    }
  };

  const wrapMcpTool = (info: ToolInfo) =>
    tool({
      description: info.description,
      // MCP enforces its own input schema server-side; we accept any object
      // here and let the model produce something sensible from `description`.
      inputSchema: z.record(z.string(), z.unknown()),
      execute: async (rawArgs: Record<string, unknown>, { toolCallId }): Promise<unknown> => {
        toolCalls++;
        const args = rawArgs ?? {};
        stream('agent_tool_call', { id: toolCallId, name: info.name, arguments: args });

        // --- Permission pre-hook (E0.1.4) -----------------------------------
        const decision = await permissions.check({
          agent,
          mcp: { id: mcp.id, name: mcp.def.name },
          toolName: info.name,
          args,
          taskId,
          sessionId,
        });

        if (!decision.allowed) {
          // Token cap → non-model-visible exit.
          if (decision.code === 'token_cap_exceeded') {
            if (emitEvent) {
              await emitEvent({
                event_id: genEventId('evt'),
                type: 'token_cap_exceeded',
                publisher: agent.id,
                timestamp: new Date().toISOString(),
                task_id: taskId,
                session_id: sessionId,
                payload: { reason: decision.reason, code: decision.code },
              });
            }
            throw new LoopExit({ exitReason: 'token_cap_exceeded' });
          }

          // Denied/Requires approval/input, no gate resolver — return structured error to the model.
          await audit.write({
            event_id: genEventId('tc'),
            event_type: 'tool_call',
            agent_id: agent.id,
            task_id: taskId,
            session_id: sessionId,
            tool_name: info.name,
            tool_input: args,
            allowed: false,
            block_reason: decision.reason,
          });
          stream('agent_tool_result', {
            id: toolCallId,
            name: info.name,
            content: `Permission denied: ${decision.reason}`,
            isError: true,
            denied: true,
            code: decision.code,
          });
          return {
            status: 'blocked',
            code: decision.code,
            error: decision.reason ?? decision.code,
          };
        }

        // Allowed — straight through.
        return invokeMcpTool(info.name, args, false, undefined);

        async function invokeMcpTool(
          toolName: string,
          finalArgs: Record<string, unknown>,
          gated: boolean,
          gateCode: string | undefined,
        ): Promise<unknown> {
          const start = Date.now();
          try {
            const result = await mcp.callTool(
              { agentId: agent.id, taskId, sessionId },
              toolName,
              finalArgs,
            );
            const duration = Date.now() - start;
            if (!result.isError) {
              browserState = captureBrowserState(
                toolName,
                finalArgs,
                result.content,
                browserState,
                mcp.id,
              );
            }
            await audit.write({
              event_id: genEventId('tc'),
              event_type: 'tool_call',
              agent_id: agent.id,
              task_id: taskId,
              session_id: sessionId,
              tool_name: toolName,
              tool_input: finalArgs,
              tool_output: result.content,
              allowed: true,
              duration_ms: duration,
              block_reason: gated ? `gate_approved:${gateCode ?? ''}` : undefined,
            });
            stream('agent_tool_result', {
              id: toolCallId,
              name: toolName,
              content: result.content,
              isError: result.isError,
              durationMs: duration,
              gateResolved: gated ? 'approve' : undefined,
            });
            await permissions.recordCompletedCall({
              agent,
              mcp: { id: mcp.id, name: mcp.def.name },
              toolName,
              args: finalArgs,
              taskId,
              sessionId,
            });
            if (result.isError) {
              return { error: result.content };
            }
            return result.content;
          } catch (err) {
            const duration = Date.now() - start;
            const message = err instanceof Error ? err.message : String(err);
            await audit.write({
              event_id: genEventId('tc'),
              event_type: 'tool_call',
              agent_id: agent.id,
              task_id: taskId,
              session_id: sessionId,
              tool_name: toolName,
              tool_input: finalArgs,
              allowed: true,
              duration_ms: duration,
              block_reason: `mcp_error:${message}`,
            });
            stream('agent_tool_result', {
              id: toolCallId,
              name: toolName,
              content: message,
              isError: true,
              durationMs: duration,
            });
            return { error: message };
          }
        }
      },
    });

  const toolSet = Object.fromEntries(
    mcpTools.map((t) => [t.name, wrapMcpTool(t)]),
  ) as ToolSet;
  const runnableModel = wrapToolFallback(model, toolSet, abortSignal);

  // Messages are rebuilt per loop attempt so the compaction hook can drop
  // the Zone 2 context block and retry with the bare task prompt.
  let zone2Active = true;
  const buildMessages = (): ModelMessage[] => [
    ...(zone2Active ? (input.contextMessages ?? []) : []),
    { role: 'user', content: userPrompt },
  ];
  const runTemperature = supportsTemperature(runnableModel) ? temperature : undefined;

  stream('agent_turn_started', { iteration: 1 });

  try {
    const result = await runAgentLoopWithRetry(
      () => ({
        model: runnableModel,
        system: systemPrompt,
        messages: buildMessages(),
        tools: toolSet,
        stopWhen: stepCountIs(maxIterations),
        abortSignal,
        onStepFinish: () => {
          iterations++;
        },
        onChunk: (chunk) => {
          if (chunk.kind === 'text') stream('agent_thought_delta', { text: chunk.delta });
        },
        ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
        temperature: runTemperature,
      }),
      {
        onContextLengthExceeded: async () => {
          if (!zone2Active || !input.contextMessages?.length) return null;
          zone2Active = false;
          return buildMessages();
        },
      },
    );

    const finalText = result.text;
    const usage = result.usage;
    const finishReason = result.finishReason ?? 'stop';

    const tokensUsed = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
    if (tokensUsed > 0) {
      await permissions.recordUsage(agent.id, tokensUsed);
    }

    if (forcedExit) {
      stream('agent_finished', {
        ...forcedExit,
        finalText,
        tokensUsed,
      });
      return {
        exitReason: forcedExit.exitReason ?? 'error',
        error: forcedExit.error,
        escalationReason: forcedExit.escalationReason,
        toolCalls,
        iterations,
        tokensUsed,
        finalText,
        browserState,
        usage: {
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          totalTokens: usage?.totalTokens ?? tokensUsed,
        },
      };
    }

    // Escalation detection on the final text (matches legacy).
    const escalation = matchesEscalation(agent, finalText);
    if (escalation.matched) {
      if (emitEvent) {
        await emitEvent({
          event_id: genEventId('evt'),
          type: 'review_required',
          publisher: agent.id,
          timestamp: new Date().toISOString(),
          task_id: taskId,
          session_id: sessionId,
          payload: {
            condition: escalation.condition,
            escalate_to: agent.escalation.escalate_to,
            partial_output: finalText,
          },
        });
      }
      stream('agent_finished', {
        exitReason: 'escalated',
        finalText,
        tokensUsed,
        escalationReason: escalation.condition,
      });
      return {
        exitReason: 'escalated',
        escalationReason: escalation.condition,
        toolCalls,
        iterations,
        tokensUsed,
        finalText,
        browserState,
        usage: {
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          totalTokens: usage?.totalTokens ?? tokensUsed,
        },
      };
    }

    stream('agent_finished', {
      exitReason: 'completed',
      finalText,
      tokensUsed,
      finishReason,
    });
    return {
      exitReason: 'completed',
      toolCalls,
      iterations,
      tokensUsed,
      finalText,
      browserState,
      usage: {
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        totalTokens: usage?.totalTokens ?? tokensUsed,
      },
    };
  } catch (err) {
    const loopExit = loopExitFrom(err);
    if (loopExit) {
      forcedExit = loopExit.outcome;
      return {
        exitReason: loopExit.outcome.exitReason ?? 'error',
        error: loopExit.outcome.error,
        toolCalls,
        iterations,
        tokensUsed: 0,
        finalText: '',
        browserState,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }
    if (isAbortError(err) || abortSignal?.aborted) {
      return {
        exitReason: 'killed',
        toolCalls,
        iterations,
        tokensUsed: 0,
        finalText: '',
        browserState,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    stream('agent_error', { error: message });
    return {
      exitReason: 'error',
      error: message,
      toolCalls,
      iterations,
      tokensUsed: 0,
      finalText: '',
      browserState,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }
}
