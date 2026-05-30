import { streamText, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { RUN_TERMINATING_TOOL_NAMES } from './run-reply-guard.js';
import { findToolApprovalRequiredError, ToolApprovalRequiredError } from './tool-loop-result.js';

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

    for await (const part of result.fullStream) {
      if (part.type === 'error') {
        const approvalError = findToolApprovalRequiredError(part.error);
        if (approvalError) throw approvalError;
        throw part.error;
      }
    }

    const [text, usage] = await Promise.all([result.text, result.usage]);
    const toolResults = steps.flatMap((step) => step.toolResults ?? []);
    const approvalId = approvalWaitFromSteps(steps);
    if (approvalId) throw new ToolApprovalRequiredError(approvalId);
    return { text, steps, toolResults, usage } as unknown as AgentLoopResult;
  };

  return execute();
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
