import type { LanguageModel, ModelMessage, ToolSet } from 'ai';
import type {
  runAgentLoop,
  AgentLoopChunk,
  AgentLoopStep,
  ContextLengthExceededError,
  HumanPause,
} from '@ujima/agent-core';
import type { McpServerSummary } from './spirit-mcp-helpers.js';
import {
  runAgentLoopWithRetry,
  supportsTemperature,
  wrapToolFallback,
} from '@ujima/agent-runtime';

export {
  RUN_TERMINATING_TOOL_NAMES,
  ContextLengthExceededError,
  ToolApprovalRequiredError,
  ToolInputRequiredError,
  ModelNotFoundError,
  SchemaTooLargeError,
  approvalWaitFromSteps,
  humanPauseFromSteps,
  inputWaitFromSteps,
  mergeInterruptMessages,
  normalizeToDottedToolName,
  runAgentLoop,
  stepHasFinalText,
  stepPausesRun,
  stepTerminatesRun,
} from '@ujima/agent-core';
export type {
  AgentLoopChunk,
  AgentLoopResult,
  AgentLoopStep,
  HumanPause,
} from '@ujima/agent-core';

export type { LoopRetryHooks as RunAgentLoopRetryHooks } from '@ujima/agent-runtime';

export interface RunAgentExecutionConfig {
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  attachedMcpServers: readonly McpServerSummary[];
  stopWhen: Parameters<typeof runAgentLoop>[0]['stopWhen'];
  maxOutputTokens?: number;
  temperature?: number;
  toolChoice?: Parameters<typeof runAgentLoop>[0]['toolChoice'];
  abortSignal?: AbortSignal;
  onChunk?: (chunk: AgentLoopChunk) => PromiseLike<void> | void;
  onStepFinish?: (step: AgentLoopStep, steps: AgentLoopStep[]) => PromiseLike<void> | void;
  loadInterruptMessages?: (step: AgentLoopStep) => Promise<ModelMessage[]> | ModelMessage[];
  detectExternalPause?: () => HumanPause | null;
  logLabel: string;
  memberLabel: string;
}

export interface RunAgentRetryHooks {
  onContextLengthExceeded?: (error: ContextLengthExceededError) => Promise<ModelMessage[] | null>;
}

/**
 * Spirit-mode host entry: delegates the shared machinery (tool adapter,
 * temperature decision, retry/compaction policy) to the consolidated host in
 * `@ujima/agent-runtime`, keeping only the mode-specific message mutation for
 * compaction here.
 */
export async function runAgentWithRetry(
  config: RunAgentExecutionConfig,
  hooks?: RunAgentRetryHooks,
): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
  const model = wrapToolFallback(config.model, config.tools, config.abortSignal);
  const temperature = supportsTemperature(model) ? config.temperature : undefined;
  let compacted = false;

  return runAgentLoopWithRetry(
    () => ({
      model,
      system: config.system,
      messages: config.messages,
      tools: config.tools,
      stopWhen: config.stopWhen,
      maxOutputTokens: config.maxOutputTokens,
      temperature,
      toolChoice: config.toolChoice,
      abortSignal: config.abortSignal,
      onChunk: config.onChunk,
      onStepFinish: config.onStepFinish,
      loadInterruptMessages: config.loadInterruptMessages,
      detectExternalPause: config.detectExternalPause,
    }),
    {
      onContextLengthExceeded: hooks?.onContextLengthExceeded
        ? async (error) => {
            if (compacted) return null;
            const handler = hooks.onContextLengthExceeded;
            if (!handler) return null;
            const reduced = await handler(error);
            if (reduced) {
              compacted = true;
              config.messages = reduced;
            }
            return reduced;
          }
        : undefined,
    },
  );
}

export { runAgentLoopWithRetry, supportsTemperature } from '@ujima/agent-runtime';
export type { LoopRetryHooks } from '@ujima/agent-runtime';