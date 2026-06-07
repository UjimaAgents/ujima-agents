import { streamText, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { RUN_TERMINATING_TOOL_NAMES, normalizeToDottedToolName } from './run-reply-guard.js';
import {
  findToolApprovalRequiredError,
  findToolInputRequiredError,
  ToolApprovalRequiredError,
  ToolInputRequiredError,
} from './tool-loop-result.js';
import { dropHeaviestAttachedMcp, type AttachedMcpServerSummary } from './spirit-mcp-helpers.js';

// Both wake-run (ai-service.generateRunReply) and direct-spirit
// (spirit-agent-run.runOnce) call runAgentLoop and both can hit the
// same two recoverable conditions: bad model id (404) + Gemini
// "too many states" (400). Keeping the retry shape in one helper
// here so the two call sites can't drift — adding a third recovery
// type means editing one place.
export interface RunAgentLoopRetryHooks {
  /**
   * Called on `ModelNotFoundError`. Must return a fresh
   * LanguageModel (typically the provider's safe-default id) for
   * the next attempt. Return `null` to give up and re-throw.
   */
  onModelNotFound?: (error: ModelNotFoundError) => Promise<LanguageModel | null> | LanguageModel | null;
  /**
   * Called on `SchemaTooLargeError`. Must return a trimmed ToolSet
   * (typically with the heaviest MCP dropped) for the next attempt.
   * Return `null` to give up and re-throw.
   */
  onSchemaTooLarge?: (error: SchemaTooLargeError) => Promise<ToolSet | null> | ToolSet | null;
}

export async function runAgentLoopWithRetry(
  buildArgs: () => Parameters<typeof runAgentLoop>[0],
  setModel: (next: LanguageModel) => void,
  setTools: (next: ToolSet) => void,
  hooks: RunAgentLoopRetryHooks = {},
): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
  // Each recovery class fires at most once per outer call — a bad
  // model with too many tools recovers in two attempts; everything
  // beyond that propagates.
  let modelFallbackApplied = false;
  let paletteReduced = false;
  while (true) {
    try {
      return await runAgentLoop(buildArgs());
    } catch (error) {
      if (error instanceof ModelNotFoundError && !modelFallbackApplied && hooks.onModelNotFound) {
        const replacement = await hooks.onModelNotFound(error);
        if (replacement) {
          modelFallbackApplied = true;
          setModel(replacement);
          continue;
        }
      }
      if (error instanceof SchemaTooLargeError && !paletteReduced && hooks.onSchemaTooLarge) {
        const trimmed = await hooks.onSchemaTooLarge(error);
        if (trimmed) {
          paletteReduced = true;
          setTools(trimmed);
          continue;
        }
      }
      throw error;
    }
  }
}

export interface RunAgentExecutionConfig {
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  attachedMcpServers: readonly AttachedMcpServerSummary[];
  stopWhen: NonNullable<Parameters<typeof streamText>[0]['stopWhen']>;
  maxOutputTokens?: number;
  temperature?: number;
  toolChoice?: Parameters<typeof streamText>[0]['toolChoice'];
  abortSignal?: AbortSignal;
  onChunk?: (chunk: AgentLoopChunk) => PromiseLike<void> | void;
  onStepFinish?: (step: AgentLoopStep, steps: AgentLoopStep[]) => PromiseLike<void> | void;
  loadInterruptMessages?: (step: AgentLoopStep) => Promise<ModelMessage[]> | ModelMessage[];
  onModelNotFound: (error: ModelNotFoundError) => Promise<LanguageModel | null> | LanguageModel | null;
  logLabel: string;
  memberLabel: string;
}

export async function runAgentWithRetry(
  config: RunAgentExecutionConfig,
): Promise<AgentLoopResult> {
  let currentModel = config.model;
  let currentTools = config.tools;

  return runAgentLoopWithRetry(
    () => ({
      model: currentModel,
      system: config.system,
      messages: config.messages,
      tools: currentTools,
      stopWhen: config.stopWhen,
      maxOutputTokens: config.maxOutputTokens,
      temperature: config.temperature,
      toolChoice: config.toolChoice,
      abortSignal: config.abortSignal,
      onChunk: config.onChunk,
      onStepFinish: config.onStepFinish,
      loadInterruptMessages: config.loadInterruptMessages,
    }),
    (next) => {
      currentModel = next;
    },
    (next) => {
      currentTools = next;
    },
    {
      onModelNotFound: config.onModelNotFound,
      onSchemaTooLarge: () => {
        const dropped = dropHeaviestAttachedMcp(currentTools, config.attachedMcpServers);
        if (!dropped) return null;
        console.warn(
          `[${config.logLabel}] gemini "too many states" — dropped MCP "${dropped.serverName}" ` +
            `(${dropped.toolNames.length} tools) and retrying for member="${config.memberLabel}"`,
        );
        return dropped.toolDefs;
      },
    },
  );
}

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

// Re-throws `error` if it matches any known, typed condition; throws
// the classified error otherwise. Consolidates the triple-classify
// pattern that must fire at every catch site in runAgentLoop.
function rethrowClassified(error: unknown): never {
  if (findToolApprovalRequiredError(error)) throw error;
  if (findToolInputRequiredError(error)) throw error;
  if (error instanceof ModelNotFoundError || error instanceof SchemaTooLargeError) throw error;
  const classified = classifyApiError(error);
  if (classified) throw classified;
  throw error;
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
  staticToolCalls?: { toolName?: string }[];
  dynamicToolCalls?: { toolName?: string }[];
  staticToolResults?: { toolName?: string; output?: unknown }[];
  dynamicToolResults?: { toolName?: string; output?: unknown }[];
  content?: { type?: string; toolName?: string; output?: unknown }[];
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
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

function inputWaitFromSteps(steps: readonly AgentLoopStep[]): string | null {
  for (const step of steps) {
    const results = Array.isArray(step.toolResults) ? step.toolResults : [];
    for (const result of results) {
      const output = result?.output as { status?: unknown; questionId?: unknown } | undefined;
      if (output?.status === 'waiting_for_input' && typeof output.questionId === 'string') {
        return output.questionId;
      }
    }
  }
  return null;
}

export function stepTerminatesRun(step: AgentLoopStep): boolean {
  const items = [
    ...(step.toolCalls ?? []),
    ...(step.toolResults ?? []),
    ...(step.staticToolCalls ?? []),
    ...(step.dynamicToolCalls ?? []),
    ...(step.staticToolResults ?? []),
    ...(step.dynamicToolResults ?? []),
    ...(step.content ?? []),
  ];
  for (const item of items) {
    const record = item as { toolName?: string; output?: unknown };
    if (RUN_TERMINATING_TOOL_NAMES.has(normalizeToDottedToolName(record.toolName ?? ''))) return true;
    const output = record.output as { status?: unknown } | undefined;
    if (
      output?.status === 'passed' ||
      output?.status === 'acked' ||
      output?.status === 'acknowledged' ||
      output?.status === 'handoff_sent'
    ) {
      return true;
    }
  }
  return false;
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
  toolChoice?: Parameters<typeof streamText>[0]['toolChoice'];
  abortSignal?: AbortSignal;
  loadInterruptMessages?: (step: AgentLoopStep) => Promise<ModelMessage[]> | ModelMessage[];
  onChunk?: (chunk: AgentLoopChunk) => PromiseLike<void> | void;
  onStepFinish?: (step: AgentLoopStep, steps: AgentLoopStep[]) => PromiseLike<void> | void;
}): Promise<AgentLoopResult> {
  const steps: AgentLoopStep[] = [];
  const messages = [...input.messages];
  const userStopWhen = input.stopWhen;
  const onChunk = input.onChunk;

  const stopWhen: NonNullable<Parameters<typeof streamText>[0]['stopWhen']> = (info) => {
    const completedSteps = [...steps, ...(info.steps as AgentLoopStep[])];
    if (approvalWaitFromSteps(completedSteps)) return true;
    if (inputWaitFromSteps(completedSteps)) return true;
    for (const step of completedSteps) {
      if (stepTerminatesRun(step)) return true;
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

  const execute = async (): Promise<AgentLoopResult> => {
    const result = streamText({
      model: input.model,
      system: input.system,
      messages,
      tools: input.tools,
      stopWhen,
      ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: input.maxOutputTokens } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      ...(input.toolChoice !== undefined ? { toolChoice: input.toolChoice } : {}),
      ...(onChunk
        ? {
            onChunk: async ({ chunk }) => {
              const delta = chunkDelta(chunk);
              if (chunk.type === 'text-delta') {
                if (delta) await onChunk({ kind: 'text', delta });
                return;
              }
              if (chunk.type === 'reasoning-delta') {
                if (delta) await onChunk({ kind: 'reasoning', delta });
              }
            },
          }
        : {}),
      prepareStep: async ({ stepNumber, messages: nextMessages }) => {
        if (stepNumber === 0) {
          return undefined;
        }
        const previousStep = steps.at(-1);
        if (!previousStep) {
          return undefined;
        }
        const interrupts = await input.loadInterruptMessages?.(previousStep);
        if (!interrupts?.length) {
          return undefined;
        }
        messages.splice(0, messages.length, ...nextMessages, ...interrupts);
        return { messages };
      },
      onStepFinish: async (step) => {
        const loopStep = step as unknown as AgentLoopStep;
        steps.push(loopStep);
        if (input.onStepFinish) {
          await input.onStepFinish(loopStep, steps);
        }
      },
    });

    // The AI SDK surfaces 4xx/5xx from the provider through *both*
    // `fullStream` (as `{ type: 'error', error }`) AND as a Promise
    // rejection on `result.text` / `result.usage` / the
    // async-iterator itself. We have to classify in every branch —
    // a 400 "too many states" sometimes arrives only through the
    // text-promise rejection, and the original
    // `for await … part.type === 'error'` catch never sees it.
    // Wrapping both paths is the only way to guarantee the typed
    // error gets thrown so spirit-agent-run's retry-with-fallback
    // can fire.
    try {
      for await (const part of result.fullStream) {
        if (part.type === 'error') {
          rethrowClassified(part.error);
        }
      }
    } catch (streamError) {
      rethrowClassified(streamError);
    }

    let text: string;
    let usage: AgentLoopResult['usage'];
    try {
      [text, usage] = await Promise.all([result.text, result.usage]);
    } catch (resolveError) {
      rethrowClassified(resolveError);
    }

    const toolResults = steps.flatMap((step) => step.toolResults ?? []);
    const approvalId = approvalWaitFromSteps(steps);
    if (approvalId) throw new ToolApprovalRequiredError(approvalId);
    const questionId = inputWaitFromSteps(steps);
    if (questionId) throw new ToolInputRequiredError(questionId);
    return { text, steps, toolResults, usage } as unknown as AgentLoopResult;
  };

  try {
    return await execute();
  } catch (error) {
    rethrowClassified(error);
  }
}

function chunkDelta(chunk: unknown): string {
  if (!chunk || typeof chunk !== 'object') return '';
  const record = chunk as Record<string, unknown>;
  return typeof record.delta === 'string'
    ? record.delta
    : typeof record.text === 'string'
      ? record.text
      : '';
}
