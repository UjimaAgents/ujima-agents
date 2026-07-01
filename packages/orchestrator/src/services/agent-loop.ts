import type { LanguageModel, ModelMessage, ToolSet } from 'ai';
import {
  runAgentLoop,
  ContextLengthExceededError,
  SchemaTooLargeError,
  type AgentLoopChunk,
  type AgentLoopStep,
  type HumanPause,
} from '@ujima/agent-core';
import { dropHeaviestAttachedMcp, type AttachedMcpServerSummary } from './spirit-mcp-helpers.js';

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
  onSchemaTooLarge?: (error: SchemaTooLargeError) => Promise<ToolSet | null> | ToolSet | null;
  onContextLengthExceeded?: (error: ContextLengthExceededError) => Promise<ModelMessage[] | null>;
}

export async function runAgentLoopWithRetry(
  buildArgs: () => Parameters<typeof runAgentLoop>[0],
  setTools: (next: ToolSet) => void,
  hooks: RunAgentLoopRetryHooks = {},
): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
  let paletteReduced = false;
  let contextReduced = false;
  while (true) {
    try {
      return await runAgentLoop(buildArgs());
    } catch (error) {
      if (error instanceof SchemaTooLargeError && !paletteReduced && hooks.onSchemaTooLarge) {
        const trimmed = await hooks.onSchemaTooLarge(error);
        if (trimmed) {
          paletteReduced = true;
          setTools(trimmed);
          continue;
        }
      }
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
  attachedMcpServers: readonly AttachedMcpServerSummary[];
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
  let currentTools = config.tools;
  const temperature = supportsTemperature(config.model) ? config.temperature : undefined;
  let compacted = false;

  return runAgentLoopWithRetry(
    () => ({
      model: config.model,
      system: config.system,
      messages: config.messages,
      tools: currentTools,
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
    (next) => {
      currentTools = next;
    },
    {
      onSchemaTooLarge: () => {
        const dropped = dropHeaviestAttachedMcp(currentTools, config.attachedMcpServers);
        if (!dropped) return null;
        console.warn(
          `[${config.logLabel}] gemini "too many states" - dropped MCP "${dropped.serverName}" ` +
            `(${dropped.toolNames.length} tools) and retrying for member="${config.memberLabel}"`,
        );
        return dropped.toolDefs;
      },
      onContextLengthExceeded: hooks?.onContextLengthExceeded
        ? async (error) => {
            if (compacted) return null;
            const reduced = await hooks.onContextLengthExceeded!(error);
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
