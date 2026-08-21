import { ContextLengthExceededError, isContextLengthExceededError, runAgentLoop } from '@ujima/agent-core';
import { configureClaudeCodeTools } from '@ujima/llm';
import type { LanguageModel, ModelMessage, ToolSet } from 'ai';

/**
 * Consolidated agent-loop host. Task mode (`runAiSdkLoop` in ai-sdk-loop.ts)
 * and spirit mode (`runAgentWithRetry` in the orchestrator) both delegate the
 * shared machinery here: the Claude-code tool-executor adapter, the
 * temperature-support decision, and the context-length retry/compaction
 * policy. Mode-specific concerns (permissions, audit, events, interrupts)
 * stay in each mode's entry point.
 */

/**
 * Single copy of the tool adapter. Wraps the model with a Claude-code-style
 * tool executor that falls back to a `Tool not found` error when the model
 * invokes a tool that isn't in `tools`.
 */
export function wrapToolFallback(
  model: LanguageModel,
  tools: ToolSet,
  abortSignal?: AbortSignal,
): LanguageModel {
  return configureClaudeCodeTools(model, async (toolName, args, toolCallId) => {
    const definition = tools[toolName] as {
      execute?: (input: Record<string, unknown>, context: Record<string, unknown>) => Promise<unknown>;
    } | undefined;
    if (!definition?.execute) return { error: `Tool not found: ${toolName}` };
    return definition.execute(args, {
      toolCallId,
      abortSignal,
      messages: [],
    });
  });
}

/**
 * Single decision about temperature support. OpenAI's `openai.responses`
 * transport rejects a `temperature` parameter for gpt-5 models, so it is
 * omitted for those; everything else takes the caller's temperature.
 */
export function supportsTemperature(model: LanguageModel): boolean {
  const meta = model as { provider?: string; modelId?: string };
  return !(meta.provider === 'openai.responses' && /^gpt-5(?:\.|$|-)/.test(meta.modelId ?? ''));
}

export interface LoopRetryHooks {
  /**
   * Called when the loop exits with a context-length error. Return the
   * reduced message set to retry with, or null to surface the error.
   */
  onContextLengthExceeded?: (error: ContextLengthExceededError) => Promise<ModelMessage[] | null>;
}

/**
 * Single retry/compaction policy. Context-length errors are recognized via
 * agent-core's classifier (so opaque provider error shapes get the same
 * treatment as `ContextLengthExceededError` instances); when the hook
 * supplies a reduced message set the loop is retried exactly once — a
 * second context-length failure always surfaces.
 */
export async function runAgentLoopWithRetry(
  buildArgs: () => Parameters<typeof runAgentLoop>[0],
  hooks: LoopRetryHooks = {},
): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
  let contextReduced = false;
  for (;;) {
    try {
      return await runAgentLoop(buildArgs());
    } catch (error) {
      if (!contextReduced && hooks.onContextLengthExceeded && isContextLengthExceededError(error)) {
        contextReduced = true;
        const reduced = await hooks.onContextLengthExceeded(
          error instanceof ContextLengthExceededError ? error : new ContextLengthExceededError(contextErrorMessage(error)),
        );
        if (reduced) {
          continue;
        }
      }
      throw error;
    }
  }
}

function contextErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(error);
}