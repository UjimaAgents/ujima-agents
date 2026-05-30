import { streamText, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { RUN_TERMINATING_TOOL_NAMES } from './run-reply-guard.js';
import { findToolApprovalRequiredError, ToolApprovalRequiredError } from './tool-loop-result.js';

// Typed errors so callers can mount targeted recovery without
// pattern-matching error strings at every site. Both extend Error so
// they propagate normally if the caller chooses not to handle them.
//
// ModelNotFoundError: the configured model id 404'd at the provider.
// Usually means the admin saved an aspirational id (e.g. before the
// model was actually released) — the caller can swap to the
// provider's SAFE_FALLBACK_MODELS entry and retry once.
export class ModelNotFoundError extends Error {
  constructor(
    readonly modelId: string,
    readonly providerKindHint: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ModelNotFoundError';
  }
}

// SchemaTooLargeError: Gemini's structured-generation FSM rejected
// the combined tool schema as having too many states. Caller can
// drop the heaviest MCP from the palette and retry once.
export class SchemaTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaTooLargeError';
  }
}

// Maps a raw `AI_APICallError` from the Vercel AI SDK to one of the
// typed errors above when the message+status pattern matches a known
// recoverable condition. Returns `null` for errors we don't have a
// targeted recovery for — caller re-throws the original.
function classifyApiError(error: unknown): Error | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as Record<string, unknown>;
  if (e.name !== 'AI_APICallError') return null;
  const message = typeof e.message === 'string' ? e.message : '';
  const url = typeof e.url === 'string' ? e.url : '';
  const status = typeof e.statusCode === 'number' ? e.statusCode : undefined;

  // Google "model not found" (404 NOT_FOUND). Pattern is stable
  // across gemini-* ids: the response body always says "is not found
  // for API version" or "is not supported for generateContent". URL
  // looks like .../v1beta/models/<id>:streamGenerateContent.
  if (
    status === 404 &&
    /is not found for API version|is not supported for generateContent/i.test(message)
  ) {
    const modelMatch = url.match(/models\/([^:]+):/);
    const modelId = modelMatch?.[1] ?? 'unknown';
    const providerHint = url.includes('generativelanguage.googleapis.com')
      ? 'google'
      : undefined;
    return new ModelNotFoundError(modelId, providerHint, message);
  }

  // Gemini's structured-generation rejection. Comes back as 400
  // INVALID_ARGUMENT with a verbose explanation about "too many
  // states for serving" — caused by the combined tool palette
  // compiling to an FSM that exceeds the model's limit.
  if (status === 400 && /too many states for serving/i.test(message)) {
    return new SchemaTooLargeError(message);
  }

  return null;
}

export interface AgentLoopStep {
  text?: string;
  toolCalls?: { toolCallId?: string; toolName?: string; input?: unknown }[];
  toolResults?: { toolCallId?: string; output?: unknown }[];
  [key: string]: unknown;
}

export interface AgentLoopChunk {
  kind: 'text' | 'reasoning';
  delta: string;
}

export interface AgentLoopResult {
  text: string;
  steps: AgentLoopStep[];
  toolResults: { toolName?: string; output?: unknown }[];
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  [key: string]: unknown;
}

function approvalWaitFromSteps(steps: readonly AgentLoopStep[]): string | null {
  for (const step of steps) {
    const results = Array.isArray(step.toolResults) ? step.toolResults : [];
    for (const result of results) {
      const output = result?.output as { status?: unknown; approvalId?: unknown } | undefined;
      if (output?.status === 'waiting_for_approval' && typeof output.approvalId === 'string') {
        return output.approvalId;
      }
    }
  }
  return null;
}

/**
 * `toolChoice` strategy. The default for ad-hoc / programmatic runs
 * is `auto`, leaving the model free to mix tool calls and free text.
 *
 * For wake-triggered runs we use `required-first-step`: the *first*
 * inner step is forced to call a tool (so the model picks
 * `channel.pass` or a posting tool fast), and subsequent steps go
 * back to `auto` to keep multi-step read->write->reply work fluid.
 *
 * Setting AI-SDK's `toolChoice` globally would force a tool on
 * every step. The per-step strategy avoids that loop while still
 * making the first decision explicit.
 */
export type AgentLoopToolChoice = 'auto' | 'required-first-step';

export async function runAgentLoop(input: {
  model: LanguageModel;
  system: string;
  messages: NonNullable<Parameters<typeof streamText>[0]['messages']>;
  tools: ToolSet;
  /**
   * Optional extra stop predicate. The loop ALSO stops on its own
   * when any prior step called a tool in
   * {@link RUN_TERMINATING_TOOL_NAMES}, because those tools either
   * publish a visible reply or explicitly silence the run.
   */
  stopWhen: NonNullable<Parameters<typeof streamText>[0]['stopWhen']>;
  maxOutputTokens?: number;
  temperature?: number;
  toolChoice?: AgentLoopToolChoice;
  abortSignal?: AbortSignal;
  loadInterruptMessages?: (step: AgentLoopStep) => Promise<ModelMessage[]> | ModelMessage[];
  onChunk?: (chunk: AgentLoopChunk) => PromiseLike<void> | void;
}): Promise<AgentLoopResult> {
  const steps: AgentLoopStep[] = [];
  const messages = [...input.messages];
  const toolChoiceStrategy: AgentLoopToolChoice = input.toolChoice ?? 'auto';
  const userStopWhen = input.stopWhen;
  const onChunk = input.onChunk;

  const stopWhen: NonNullable<Parameters<typeof streamText>[0]['stopWhen']> = (info) => {
    if (approvalWaitFromSteps(steps)) return true;
    for (const step of steps) {
      const calls = Array.isArray(step.toolCalls) ? step.toolCalls : [];
      for (const call of calls) {
        const name = typeof call?.toolName === 'string' ? call.toolName : '';
        if (RUN_TERMINATING_TOOL_NAMES.has(name)) {
          return true;
        }
      }
    }
    if (typeof userStopWhen === 'function') {
      try {
        return (userStopWhen as unknown as (i: typeof info) => boolean | Promise<boolean>)(info);
      } catch {
        return false;
      }
    }
    return false;
  };

  const execute = async (strategy: AgentLoopToolChoice): Promise<AgentLoopResult> => {
    const result = streamText({
      model: input.model,
      system: input.system,
      messages,
      tools: input.tools,
      stopWhen,
      ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: input.maxOutputTokens } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      ...(onChunk
        ? {
            onChunk: async ({ chunk }) => {
              if (chunk.type === 'text-delta') {
                await onChunk({ kind: 'text', delta: chunk.text });
                return;
              }
              if (chunk.type === 'reasoning-delta') {
                await onChunk({ kind: 'reasoning', delta: chunk.text });
              }
            },
          }
        : {}),
      prepareStep: async ({ stepNumber, messages: nextMessages }) => {
        const stepToolChoice =
          strategy === 'required-first-step' && stepNumber === 0
            ? ('required' as const)
            : undefined;

        if (stepNumber === 0) {
          return stepToolChoice ? { toolChoice: stepToolChoice } : undefined;
        }
        const previousStep = steps.at(-1);
        if (!previousStep) {
          return stepToolChoice ? { toolChoice: stepToolChoice } : undefined;
        }
        const interrupts = await input.loadInterruptMessages?.(previousStep);
        if (!interrupts?.length) {
          return stepToolChoice ? { toolChoice: stepToolChoice } : undefined;
        }
        messages.splice(0, messages.length, ...nextMessages, ...interrupts);
        return stepToolChoice ? { messages, toolChoice: stepToolChoice } : { messages };
      },
      onStepFinish: (step) => {
        const loopStep = step as unknown as AgentLoopStep;
        steps.push(loopStep);
      },
    });

    for await (const part of result.fullStream) {
      if (part.type === 'error') {
        const approvalError = findToolApprovalRequiredError(part.error);
        if (approvalError) throw approvalError;
        const classified = classifyApiError(part.error);
        if (classified) throw classified;
        throw part.error;
      }
    }

    const [text, usage] = await Promise.all([result.text, result.usage]);
    const toolResults = steps.flatMap((step) => step.toolResults ?? []);
    const approvalId = approvalWaitFromSteps(steps);
    if (approvalId) throw new ToolApprovalRequiredError(approvalId);
    return { text, steps, toolResults, usage } as unknown as AgentLoopResult;
  };

  try {
    return await execute(toolChoiceStrategy);
  } catch (error) {
    // Retry with `auto` when the provider rejects `toolChoice: required` on
    // step 0. Some models (e.g. deepseek-v4-flash in thinking mode) may
    // stream reasoning tokens before the HTTP error arrives; we still retry
    // because `onStepFinish` has not run and no tool results were committed.
    if (
      toolChoiceStrategy === 'required-first-step' &&
      steps.length === 0 &&
      isUnsupportedToolChoiceError(error)
    ) {
      return execute('auto');
    }
    throw error;
  }
}

function isUnsupportedToolChoiceError(error: unknown): boolean {
  const text = collectErrorText(error).toLowerCase();
  const referencesToolChoice =
    text.includes('tool_choice') ||
    text.includes('toolchoice') ||
    text.includes('tool choice');
  if (!referencesToolChoice) return false;
  return (
    text.includes('does not support') ||
    text.includes('not support') ||
    text.includes('unsupported')
  );
}

function collectErrorText(error: unknown, seen = new Set<unknown>()): string {
  if (error == null) return '';
  if (typeof error === 'string') return error;
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') {
    return String(error);
  }
  if (typeof error !== 'object') return '';
  if (seen.has(error)) return '';
  seen.add(error);

  const record = error as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ['name', 'message', 'statusText', 'code', 'type']) {
    const value = record[key];
    if (typeof value === 'string') parts.push(value);
  }
  for (const key of ['cause', 'error']) {
    if (key in record) parts.push(collectErrorText(record[key], seen));
  }
  try {
    parts.push(JSON.stringify(error));
  } catch {
    // Ignore objects that cannot be stringified.
  }
  return parts.filter(Boolean).join(' ');
}
