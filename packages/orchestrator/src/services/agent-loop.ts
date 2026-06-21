import type { LanguageModel, ModelMessage, ToolSet } from 'ai';
import {
  runAgentLoop,
  SchemaTooLargeError,
  type AgentLoopChunk,
  type AgentLoopStep,
  type HumanPause,
} from '@ujima/agent-core';
import { dropHeaviestAttachedMcp, type AttachedMcpServerSummary } from './spirit-mcp-helpers.js';

export {
  RUN_TERMINATING_TOOL_NAMES,
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
}

export async function runAgentLoopWithRetry(
  buildArgs: () => Parameters<typeof runAgentLoop>[0],
  setTools: (next: ToolSet) => void,
  hooks: RunAgentLoopRetryHooks = {},
): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
  let paletteReduced = false;
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

export async function runAgentWithRetry(
  config: RunAgentExecutionConfig,
): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
  let currentTools = config.tools;

  return runAgentLoopWithRetry(
    () => ({
      model: config.model,
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
    },
  );
}
