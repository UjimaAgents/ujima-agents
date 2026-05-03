import {
  stepCountIs,
  streamText,
  tool,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import { z } from 'zod';
import type { AgentDef, UjimaEvent } from '@ujima/shared';
import type { AuditLog } from '@ujima/context-store';
import type { MCPConnection, ToolInfo } from '@ujima/mcp-client';
import type { PermissionMiddleware } from '@ujima/permissions';
import { matchesEscalation } from './escalation';
import type { GateDecision, GateResolver } from './types';

/**
 * AI-SDK-based agent turn loop. Structural mirror of {@link runToolLoop} but
 * built on top of `streamText({ tools, stopWhen })`. The per-tool `execute`
 * callback preserves the legacy permission → gate → MCP → audit sequence.
 *
 * This is engine = 'ai-sdk' (the default post-E0). Engine = 'legacy' keeps
 * the hand-rolled `runToolLoop` path alive for two clean releases.
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
  maxIterations: number;
  maxToolResultChars?: number;
  abortSignal?: AbortSignal;
  emitEvent?: (event: UjimaEvent) => Promise<void> | void;
  onStream?: (event: UjimaEvent) => void;
  gateResolver?: GateResolver;
  /** Optional max tokens cap per turn; defaults to the provider's own cap. */
  maxOutputTokens?: number;
  /** Temperature override; defaults to 0.2 (matches AiService). */
  temperature?: number;
}

import { type BrowserStateSnapshot, captureBrowserState } from './browser';

export interface AiSdkLoopOutcome {
  exitReason: 'completed' | 'escalated' | 'rate_limit_tripped' | 'killed' | 'error';
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

const DEFAULT_MAX_TOOL_RESULT_CHARS = 12_000;

// Control-flow sentinels. streamText treats `execute` throwing as an error
// returned to the model; we instead use these to force a non-model-visible
// exit from the loop (rate limit, kill, human reject).
class LoopExit extends Error {
  constructor(readonly outcome: Partial<AiSdkLoopOutcome>) {
    super(outcome.exitReason ?? 'error');
    this.name = 'LoopExit';
  }
}

function genEventId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function truncateToolContent(content: unknown, maxChars: number): unknown {
  if (maxChars <= 0) {
    return '[tool output truncated]';
  }

  if (typeof content === 'string') {
    return truncateText(content, maxChars);
  }

  const serialized = safeStringify(content);
  if (serialized.length <= maxChars) {
    return content;
  }

  return {
    truncated: true,
    summary: `Tool output exceeded ${maxChars} chars and was truncated.`,
    preview: truncateText(serialized, maxChars),
  };
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const omitted = value.length - maxChars;
  return `${value.slice(0, maxChars)}\n...[truncated ${omitted} chars]`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
    maxToolResultChars = DEFAULT_MAX_TOOL_RESULT_CHARS,
    abortSignal,
    emitEvent,
    onStream,
    gateResolver,
    maxOutputTokens,
    temperature = 0.2,
  } = input;

  let toolCalls = 0;
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
          // Rate limit / token cap → non-model-visible exit.
          if (decision.code === 'rate_limited' || decision.code === 'token_cap_exceeded') {
            if (emitEvent) {
              await emitEvent({
                event_id: genEventId('evt'),
                type: 'rate_limit_tripped',
                publisher: agent.id,
                timestamp: new Date().toISOString(),
                task_id: taskId,
                session_id: sessionId,
                payload: { reason: decision.reason, code: decision.code },
              });
            }
            throw new LoopExit({ exitReason: 'rate_limit_tripped' });
          }

          const isGate =
            decision.code === 'requires_approval' || decision.code === 'requires_input';

          if (isGate && gateResolver) {
            if (emitEvent) {
              await emitEvent({
                event_id: genEventId('evt'),
                type: 'policy_gate_triggered',
                publisher: agent.id,
                timestamp: new Date().toISOString(),
                task_id: taskId,
                session_id: sessionId,
                payload: {
                  gate: decision.gate,
                  code: decision.code,
                  reason: decision.reason,
                  tool_name: info.name,
                  tool_call_id: toolCallId,
                  tool_input: args,
                  mcp_id: mcp.id,
                  rule: decision.rule,
                },
              });
            }

            let gateDecision: GateDecision;
            try {
              gateDecision = await gateResolver.awaitDecision({
                agentId: agent.id,
                taskId,
                sessionId,
                toolCallId,
                toolName: info.name,
                mcpId: mcp.id,
                mcpName: mcp.def.name,
                args,
                gate:
                  decision.gate ??
                  (decision.code === 'requires_input' ? 'input' : 'approval'),
                code: decision.code as 'requires_approval' | 'requires_input',
                reason: decision.reason,
                abortSignal,
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              stream('agent_tool_result', {
                id: toolCallId,
                name: info.name,
                content: `Gate resolver error: ${message}`,
                isError: true,
              });
              return { error: `gate_resolver_error: ${message}` };
            }

            if (emitEvent) {
              await emitEvent({
                event_id: genEventId('evt'),
                type: 'policy_gate_resolved',
                publisher: agent.id,
                timestamp: new Date().toISOString(),
                task_id: taskId,
                session_id: sessionId,
                payload: {
                  tool_call_id: toolCallId,
                  tool_name: info.name,
                  mcp_id: mcp.id,
                  outcome: gateDecision.kind,
                  decided_by: gateDecision.decidedBy,
                  reason: gateDecision.reason,
                },
              });
            }

            if (gateDecision.kind === 'reject') {
              const rejectMsg = gateDecision.reason
                ? `Tool "${info.name}" was rejected by a human reviewer: ${gateDecision.reason}`
                : `Tool "${info.name}" was rejected by a human reviewer.`;
              await audit.write({
                event_id: genEventId('tc'),
                event_type: 'tool_call',
                agent_id: agent.id,
                task_id: taskId,
                session_id: sessionId,
                tool_name: info.name,
                tool_input: args,
                allowed: false,
                block_reason: `gate_rejected: ${gateDecision.reason ?? 'no reason provided'}`,
              });
              stream('agent_tool_result', {
                id: toolCallId,
                name: info.name,
                content: rejectMsg,
                isError: true,
                gateResolved: 'reject',
              });
              return { error: rejectMsg };
            }

            // Approved — fall through with possibly edited args.
            const approvedArgs = gateDecision.args ?? args;
            return invokeMcpTool(info.name, approvedArgs, /* gated */ true, decision.code);
          }

          // Denied, no gate resolver — return structured error to the model.
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
          return { error: `permission_denied: ${decision.reason ?? decision.code}` };
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
            if (result.isError) {
              return { error: truncateToolContent(result.content, maxToolResultChars) };
            }
            return truncateToolContent(result.content, maxToolResultChars);
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

  const messages: ModelMessage[] = [{ role: 'user', content: userPrompt }];

  stream('agent_turn_started', { iteration: 1 });

  try {
    const result = streamText({
      model,
      system: systemPrompt,
      messages,
      tools: toolSet,
      stopWhen: stepCountIs(maxIterations),
      abortSignal,
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      temperature,
    });

    // Drain the full stream so tool `execute` callbacks run AND the finish
    // part fires (which carries usage). textStream closes on text-end and
    // would miss the finish frame.
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        stream('agent_thought_delta', { text: part.text });
      }
    }

    const [finalText, usage, finishReason] = await Promise.all([
      result.text,
      result.usage,
      result.finishReason,
    ]);

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
        iterations: 1,
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
        iterations: 1,
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
      iterations: 1,
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
    if (err instanceof LoopExit) {
      forcedExit = err.outcome;
      return {
        exitReason: err.outcome.exitReason ?? 'error',
        error: err.outcome.error,
        toolCalls,
        iterations: 1,
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
      iterations: 1,
      tokensUsed: 0,
      finalText: '',
      browserState,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }
}
