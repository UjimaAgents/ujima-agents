import type { UjimaEvent } from '@ujima/shared';
import type {
  LLMContentPart,
  LLMMessage,
  LLMProvider,
  LLMStreamDelta,
  LLMToolSpec,
} from '@ujima/llm/legacy';
import type { MCPConnection, ToolInfo } from '@ujima/mcp-client';
import type { PermissionMiddleware } from '@ujima/permissions';
import type { AuditLog } from '@ujima/context-store';
import type { AgentDef } from '@ujima/shared';
import { matchesEscalation } from './escalation';
import type { GateDecision, GateRequest, GateResolver } from './types';

export interface ToolLoopInputs {
  agent: AgentDef;
  taskId: string;
  sessionId: string;
  provider: LLMProvider;
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
  refreshPeerContext?: (iteration: number) => Promise<LLMMessage | undefined>;
  gateResolver?: GateResolver;
}

const DEFAULT_MAX_TOOL_RESULT_CHARS = 12_000;

export interface BrowserStateSnapshot {
  /** Last URL the browser was observed at (from a navigate/snapshot tool call). */
  url?: string;
  /** Page title if the MCP surfaced one. */
  title?: string;
  /** Resource reference for the most recent screenshot, if captured. */
  screenshotRef?: string;
  /** MCP id that produced this state (so downstream agents can pick the same MCP). */
  mcpId?: string;
  /** ISO timestamp of the last browser tool call that mutated state. */
  observedAt?: string;
}

export interface ToolLoopOutcome {
  exitReason: 'completed' | 'escalated' | 'rate_limit_tripped' | 'killed' | 'error';
  escalationReason?: string;
  error?: string;
  toolCalls: number;
  iterations: number;
  tokensUsed: number;
  finalText: string;
  browserState?: BrowserStateSnapshot;
}

export async function runToolLoop(input: ToolLoopInputs): Promise<ToolLoopOutcome> {
  const {
    agent,
    taskId,
    sessionId,
    provider,
    mcp,
    tools,
    permissions,
    audit,
    systemPrompt,
    userPrompt,
    maxIterations,
    maxToolResultChars = DEFAULT_MAX_TOOL_RESULT_CHARS,
    abortSignal,
    emitEvent,
    onStream,
    refreshPeerContext,
    gateResolver,
  } = input;

  const stream = (type: string, payload: unknown): void => {
    if (!onStream) return;
    try {
      onStream({
        event_id: `str_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  const toolSpecs: LLMToolSpec[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
  }));

  let iterations = 0;
  let toolCalls = 0;
  let tokensUsed = 0;
  let finalText = '';
  let browserState: BrowserStateSnapshot | undefined;

  while (iterations < maxIterations) {
    if (abortSignal?.aborted) {
      return { exitReason: 'killed', toolCalls, iterations, tokensUsed, finalText, browserState };
    }
    iterations++;

    if (refreshPeerContext && iterations > 1) {
      const peerNote = await refreshPeerContext(iterations);
      if (peerNote) messages.push(peerNote);
    }

    const assistantText: string[] = [];
    const assistantToolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];
    let finishReason: LLMStreamDelta & { type: 'finish' } = { type: 'finish', reason: 'end_turn' };

    stream('agent_turn_started', { iteration: iterations });

    try {
      for await (const delta of provider.stream({
        messages,
        model: agent.model,
        tools: toolSpecs,
        abortSignal,
      })) {
        if (delta.type === 'text') {
          assistantText.push(delta.text);
          stream('agent_thought_delta', { text: delta.text, iteration: iterations });
        } else if (delta.type === 'tool_call') {
          assistantToolCalls.push({ id: delta.id, name: delta.name, arguments: delta.arguments });
        } else if (delta.type === 'finish') {
          finishReason = delta;
          if (delta.usage) {
            tokensUsed += delta.usage.inputTokens + delta.usage.outputTokens;
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stream('agent_error', { error: message, iteration: iterations });
      return {
        exitReason: 'error',
        error: message,
        toolCalls,
        iterations,
        tokensUsed,
        finalText,
        browserState,
      };
    }

    if (tokensUsed > 0) {
      await permissions.recordUsage(agent.id, tokensUsed);
    }

    const assistantMsgParts: LLMContentPart[] = [];
    const joinedText = assistantText.join('');
    if (joinedText) assistantMsgParts.push({ type: 'text', text: joinedText });
    for (const tc of assistantToolCalls) {
      assistantMsgParts.push({ type: 'tool_call', id: tc.id, name: tc.name, arguments: tc.arguments });
    }
    if (assistantMsgParts.length > 0) {
      messages.push({ role: 'assistant', content: assistantMsgParts });
    }

    const escalation = matchesEscalation(agent, joinedText);
    if (escalation.matched) {
      finalText = joinedText;
      if (emitEvent) {
        await emitEvent({
          event_id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'review_required',
          publisher: agent.id,
          timestamp: new Date().toISOString(),
          task_id: taskId,
          session_id: sessionId,
          payload: {
            condition: escalation.condition,
            escalate_to: agent.escalation.escalate_to,
            partial_output: joinedText,
          },
        });
      }
      stream('agent_finished', {
        exitReason: 'escalated',
        finalText,
        iterations,
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
      };
    }

    if (assistantToolCalls.length === 0 || finishReason.reason !== 'tool_use') {
      finalText = joinedText;
      stream('agent_finished', { exitReason: 'completed', finalText, iterations, tokensUsed });
      return { exitReason: 'completed', toolCalls, iterations, tokensUsed, finalText, browserState };
    }

    const toolResults: LLMContentPart[] = [];
    for (const tc of assistantToolCalls) {
      toolCalls++;
      stream('agent_tool_call', { id: tc.id, name: tc.name, arguments: tc.arguments, iteration: iterations });
      const decision = await permissions.check({
        agent,
        mcp: { id: mcp.id, name: mcp.def.name },
        toolName: tc.name,
        args: tc.arguments,
        taskId,
        sessionId,
      });

      if (!decision.allowed) {
        stream('agent_tool_result', {
          id: tc.id,
          name: tc.name,
          content: `Permission denied: ${decision.reason}`,
          isError: true,
          denied: true,
          code: decision.code,
          gate: decision.gate,
          rule: decision.rule,
        });
        if (decision.code === 'rate_limited' || decision.code === 'token_cap_exceeded') {
          if (emitEvent) {
            await emitEvent({
              event_id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              type: 'rate_limit_tripped',
              publisher: agent.id,
              timestamp: new Date().toISOString(),
              task_id: taskId,
              session_id: sessionId,
              payload: { reason: decision.reason, code: decision.code },
            });
          }
          return {
            exitReason: 'rate_limit_tripped',
            toolCalls,
            iterations,
            tokensUsed,
            finalText: joinedText,
            browserState,
          };
        }
        const isGate =
          decision.code === 'requires_approval' || decision.code === 'requires_input';
        if (emitEvent && isGate) {
          await emitEvent({
            event_id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'policy_gate_triggered',
            publisher: agent.id,
            timestamp: new Date().toISOString(),
            task_id: taskId,
            session_id: sessionId,
            payload: {
              gate: decision.gate,
              code: decision.code,
              reason: decision.reason,
              tool_name: tc.name,
              tool_call_id: tc.id,
              tool_input: tc.arguments,
              mcp_id: mcp.id,
              rule: decision.rule,
            },
          });
        }

        if (isGate && gateResolver) {
          const gateCode = decision.code as 'requires_approval' | 'requires_input';
          let gateOutcome: GateResolverOutcome;
          try {
            gateOutcome = await resolveGate({
              resolver: gateResolver,
              request: {
                agentId: agent.id,
                taskId,
                sessionId,
                toolCallId: tc.id,
                toolName: tc.name,
                mcpId: mcp.id,
                mcpName: mcp.def.name,
                args: tc.arguments,
                gate: decision.gate ?? (gateCode === 'requires_input' ? 'input' : 'approval'),
                code: gateCode,
                reason: decision.reason,
                abortSignal,
              },
              abortSignal,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            stream('agent_tool_result', {
              id: tc.id,
              name: tc.name,
              content: `Gate resolver error: ${message}`,
              isError: true,
            });
            toolResults.push({
              type: 'tool_result',
              toolCallId: tc.id,
              content: `Gate resolver error: ${message}`,
              isError: true,
            });
            continue;
          }

          if (gateOutcome.kind === 'aborted') {
            return {
              exitReason: 'killed',
              toolCalls,
              iterations,
              tokensUsed,
              finalText: joinedText,
              browserState,
            };
          }

          if (emitEvent) {
            await emitEvent({
              event_id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              type: 'policy_gate_resolved',
              publisher: agent.id,
              timestamp: new Date().toISOString(),
              task_id: taskId,
              session_id: sessionId,
              payload: {
                tool_call_id: tc.id,
                tool_name: tc.name,
                mcp_id: mcp.id,
                outcome: gateOutcome.decision.kind,
                decided_by: gateOutcome.decision.decidedBy,
                reason: gateOutcome.decision.reason,
                args_edited:
                  gateOutcome.decision.kind === 'approve' &&
                  gateOutcome.decision.args !== undefined &&
                  JSON.stringify(gateOutcome.decision.args) !== JSON.stringify(tc.arguments),
              },
            });
          }

          if (gateOutcome.decision.kind === 'reject') {
            const rejectMsg = gateOutcome.decision.reason
              ? `Tool "${tc.name}" was rejected by a human reviewer: ${gateOutcome.decision.reason}`
              : `Tool "${tc.name}" was rejected by a human reviewer.`;
            await audit.write({
              event_id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              event_type: 'tool_call',
              agent_id: agent.id,
              task_id: taskId,
              session_id: sessionId,
              tool_name: tc.name,
              tool_input: tc.arguments,
              allowed: false,
              block_reason: `gate_rejected: ${gateOutcome.decision.reason ?? 'no reason provided'}`,
            });
            stream('agent_tool_result', {
              id: tc.id,
              name: tc.name,
              content: rejectMsg,
              isError: true,
              gateResolved: 'reject',
            });
            toolResults.push({
              type: 'tool_result',
              toolCallId: tc.id,
              content: rejectMsg,
              isError: true,
            });
            continue;
          }

          // approved — invoke with (possibly edited) args
          const approvedArgs = gateOutcome.decision.args ?? tc.arguments;
          const start = Date.now();
          try {
            const result = await mcp.callTool(
              { agentId: agent.id, taskId, sessionId },
              tc.name,
              approvedArgs,
            );
            const duration = Date.now() - start;
            if (!result.isError) {
              browserState = captureBrowserState(
                tc.name,
                approvedArgs,
                result.content,
                browserState,
                mcp.id,
              );
            }
            await audit.write({
              event_id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              event_type: 'tool_call',
              agent_id: agent.id,
              task_id: taskId,
              session_id: sessionId,
              tool_name: tc.name,
              tool_input: approvedArgs,
              tool_output: result.content,
              allowed: true,
              duration_ms: duration,
              block_reason: `gate_approved:${gateCode}`,
            });
            const contentForLlm = truncateToolContent(result.content, maxToolResultChars);
            toolResults.push({
              type: 'tool_result',
              toolCallId: tc.id,
              content: contentForLlm,
              isError: result.isError,
            });
            stream('agent_tool_result', {
              id: tc.id,
              name: tc.name,
              content: result.content,
              isError: result.isError,
              durationMs: duration,
              gateResolved: 'approve',
              argsEdited:
                gateOutcome.decision.args !== undefined &&
                JSON.stringify(approvedArgs) !== JSON.stringify(tc.arguments),
            });
          } catch (err) {
            const duration = Date.now() - start;
            const message = err instanceof Error ? err.message : String(err);
            await audit.write({
              event_id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              event_type: 'tool_call',
              agent_id: agent.id,
              task_id: taskId,
              session_id: sessionId,
              tool_name: tc.name,
              tool_input: approvedArgs,
              tool_output: { error: message },
              allowed: true,
              duration_ms: duration,
              block_reason: 'mcp_error',
            });
            toolResults.push({
              type: 'tool_result',
              toolCallId: tc.id,
              content: `Tool error: ${message}`,
              isError: true,
            });
            stream('agent_tool_result', {
              id: tc.id,
              name: tc.name,
              content: `Tool error: ${message}`,
              isError: true,
              durationMs: duration,
            });
          }
          continue;
        }

        const toolFeedback =
          decision.code === 'requires_approval'
            ? `Tool "${tc.name}" is gated: a human must approve this call before it can run. ${decision.reason}`
            : decision.code === 'requires_input'
              ? `Tool "${tc.name}" is gated: the user must confirm or edit the arguments before this call can run. ${decision.reason}`
              : `Permission denied: ${decision.reason}`;
        toolResults.push({
          type: 'tool_result',
          toolCallId: tc.id,
          content: toolFeedback,
          isError: true,
        });
        continue;
      }

      const start = Date.now();
      try {
        const result = await mcp.callTool(
          { agentId: agent.id, taskId, sessionId },
          tc.name,
          tc.arguments,
        );
        const duration = Date.now() - start;
        if (!result.isError) {
          browserState = captureBrowserState(
            tc.name,
            tc.arguments,
            result.content,
            browserState,
            mcp.id,
          );
        }
        await audit.write({
          event_id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          event_type: 'tool_call',
          agent_id: agent.id,
          task_id: taskId,
          session_id: sessionId,
          tool_name: tc.name,
          tool_input: tc.arguments,
          tool_output: result.content,
          allowed: true,
          duration_ms: duration,
        });
        const contentForLlm = truncateToolContent(result.content, maxToolResultChars);
        toolResults.push({
          type: 'tool_result',
          toolCallId: tc.id,
          content: contentForLlm,
          isError: result.isError,
        });
        stream('agent_tool_result', {
          id: tc.id,
          name: tc.name,
          content: result.content,
          isError: result.isError,
          durationMs: duration,
          truncated: contentForLlm !== result.content,
        });
      } catch (err) {
        const duration = Date.now() - start;
        const message = err instanceof Error ? err.message : String(err);
        await audit.write({
          event_id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          event_type: 'tool_call',
          agent_id: agent.id,
          task_id: taskId,
          session_id: sessionId,
          tool_name: tc.name,
          tool_input: tc.arguments,
          tool_output: { error: message },
          allowed: true,
          duration_ms: duration,
          block_reason: 'mcp_error',
        });
        toolResults.push({
          type: 'tool_result',
          toolCallId: tc.id,
          content: `Tool error: ${message}`,
          isError: true,
        });
        stream('agent_tool_result', {
          id: tc.id,
          name: tc.name,
          content: `Tool error: ${message}`,
          isError: true,
          durationMs: duration,
        });
      }
    }

    messages.push({ role: 'tool', content: toolResults });
  }

  stream('agent_finished', { exitReason: 'completed', finalText, iterations, tokensUsed });
  return { exitReason: 'completed', toolCalls, iterations, tokensUsed, finalText, browserState };
}

/**
 * Heuristic: identify a browser-class MCP tool. Playwright MCP prefixes every
 * tool with `browser_`; we also catch common Puppeteer/Puppeteer-MCP spellings.
 */
function isBrowserToolName(name: string): boolean {
  return (
    name.startsWith('browser_') ||
    name.startsWith('puppeteer_') ||
    name === 'navigate' ||
    name === 'screenshot'
  );
}

/**
 * Best-effort extraction of URL / title / screenshot reference from an MCP
 * tool result. Returns an updated snapshot (never wipes fields that were
 * already populated unless this call produced new values for them).
 */
export function captureBrowserState(
  toolName: string,
  args: unknown,
  content: unknown,
  previous: BrowserStateSnapshot | undefined,
  mcpId: string,
): BrowserStateSnapshot | undefined {
  if (!isBrowserToolName(toolName)) return previous;

  const next: BrowserStateSnapshot = { ...(previous ?? {}) };
  next.mcpId = mcpId;
  next.observedAt = new Date().toISOString();

  const argsUrl = extractUrlFromArgs(args);
  if (argsUrl) next.url = argsUrl;

  const text = flattenTextContent(content);
  if (text) {
    const urlFromText = extractUrlFromText(text);
    if (urlFromText) next.url = urlFromText;
    const titleFromText = extractTitleFromText(text);
    if (titleFromText) next.title = titleFromText;
  }

  if (/screenshot|snapshot/i.test(toolName)) {
    const ref = extractScreenshotRef(content);
    if (ref) next.screenshotRef = ref;
  }

  if (!next.url && !next.title && !next.screenshotRef) return previous;
  return next;
}

function extractUrlFromArgs(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const maybe = args as { url?: unknown };
  if (typeof maybe.url === 'string' && /^https?:\/\//i.test(maybe.url)) return maybe.url;
  return undefined;
}

function flattenTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content as unknown[]) {
    if (item && typeof item === 'object') {
      const maybe = item as { type?: unknown; text?: unknown };
      if (maybe.type === 'text' && typeof maybe.text === 'string') parts.push(maybe.text);
    }
  }
  return parts.join('\n');
}

function extractUrlFromText(text: string): string | undefined {
  const labeled = /(?:^|\n)[-\s*]*(?:current\s+)?url\s*[:=]\s*(https?:\/\/\S+)/i.exec(text);
  if (labeled?.[1]) return labeled[1].replace(/[)\].,;]+$/, '');
  const bareMatch = /(https?:\/\/\S+)/i.exec(text);
  if (bareMatch?.[1]) return bareMatch[1].replace(/[)\].,;]+$/, '');
  return undefined;
}

function extractTitleFromText(text: string): string | undefined {
  const labeled = /(?:^|\n)[-\s*]*(?:page\s+)?title\s*[:=]\s*([^\n]+)/i.exec(text);
  if (labeled?.[1]) return labeled[1].trim().replace(/^["']|["']$/g, '').slice(0, 200);
  return undefined;
}

function extractScreenshotRef(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const item of content as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const maybe = item as { type?: unknown; data?: unknown; mimeType?: unknown; resource?: unknown };
    if (maybe.type === 'image' && typeof maybe.mimeType === 'string') {
      const mime = maybe.mimeType;
      const size = typeof maybe.data === 'string' ? maybe.data.length : 0;
      return `inline-image:${mime}:${size}b`;
    }
    if (maybe.type === 'resource' && maybe.resource && typeof maybe.resource === 'object') {
      const r = maybe.resource as { uri?: unknown };
      if (typeof r.uri === 'string') return r.uri;
    }
  }
  return undefined;
}

type GateResolverOutcome =
  | { kind: 'resolved'; decision: GateDecision }
  | { kind: 'aborted' };

async function resolveGate(input: {
  resolver: GateResolver;
  request: GateRequest;
  abortSignal?: AbortSignal;
}): Promise<GateResolverOutcome> {
  const { resolver, request, abortSignal } = input;
  if (abortSignal?.aborted) return { kind: 'aborted' };

  if (!abortSignal) {
    const decision = await resolver.awaitDecision(request);
    return { kind: 'resolved', decision };
  }

  let abortHandler: (() => void) | undefined;
  try {
    const decision = await new Promise<GateDecision>((resolve, reject) => {
      abortHandler = (): void => reject(new Error('__ujima_gate_aborted__'));
      abortSignal.addEventListener('abort', abortHandler, { once: true });
      resolver.awaitDecision(request).then(resolve, reject);
    });
    return { kind: 'resolved', decision };
  } catch (err) {
    if (err instanceof Error && err.message === '__ujima_gate_aborted__') {
      return { kind: 'aborted' };
    }
    throw err;
  } finally {
    if (abortHandler) abortSignal.removeEventListener('abort', abortHandler);
  }
}

function truncateToolContent(content: unknown, maxChars: number): unknown {
  if (typeof content === 'string') {
    return content.length > maxChars ? `${content.slice(0, maxChars)}\n… [truncated ${content.length - maxChars} chars]` : content;
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(content);
  } catch {
    return content;
  }
  if (serialized.length <= maxChars) return content;
  const head = serialized.slice(0, maxChars);
  return `${head}\n… [truncated ${serialized.length - maxChars} chars of tool output — retry with a narrower query or fewer results]`;
}
