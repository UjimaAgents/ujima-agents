import type { LanguageModel, ModelMessage, ToolSet } from 'ai';
import {
  runAgentLoop,
  ContextLengthExceededError,
  type AgentLoopChunk,
  type AgentLoopStep,
  type HumanPause,
} from '@ujima/agent-core';
import type { McpServerSummary } from './spirit-mcp-helpers.js';
import { configureClaudeCodeTools } from '@ujima/llm';

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

export interface RunAgentLoopRetryHooks {
  onContextLengthExceeded?: (error: ContextLengthExceededError) => Promise<ModelMessage[] | null>;
}

export async function runAgentLoopWithRetry(
  buildArgs: () => Parameters<typeof runAgentLoop>[0],
  hooks: RunAgentLoopRetryHooks = {},
): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
  let contextReduced = false;
  while (true) {
    try {
      return await runAgentLoop(buildArgs());
    } catch (error) {
      if (error instanceof ContextLengthExceededError && !contextReduced && hooks.onContextLengthExceeded) {
        contextReduced = true;
        const reduced = await hooks.onContextLengthExceeded(error);
        if (reduced) {
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

export async function runAgentWithRetry(
  config: RunAgentExecutionConfig,
  hooks?: RunAgentRetryHooks,
): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
  const model = configureClaudeCodeTools(config.model, async (toolName, args, toolCallId) => {
    const definition = config.tools[toolName] as {
      execute?: (input: Record<string, unknown>, context: Record<string, unknown>) => Promise<unknown>;
    } | undefined;
    if (!definition?.execute) return { error: `Tool not found: ${toolName}` };
    return definition.execute(args, {
      toolCallId,
      abortSignal: config.abortSignal,
      messages: [],
    });
  });
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

function supportsTemperature(model: LanguageModel): boolean {
  const meta = model as { provider?: string; modelId?: string };
  return !(meta.provider === 'openai.responses' && /^gpt-5(?:\.|$|-)/.test(meta.modelId ?? ''));
}
