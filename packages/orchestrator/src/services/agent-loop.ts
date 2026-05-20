import { streamText, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { RUN_TERMINATING_TOOL_NAMES } from './run-reply-guard.js';

export interface AgentLoopStep {
  text?: string;
  toolCalls?: { toolCallId?: string; toolName?: string; input?: unknown }[];
  toolResults?: { toolCallId?: string; output?: unknown }[];
  [key: string]: unknown;
}

export interface AgentLoopResult {
  text: string;
  steps: AgentLoopStep[];
  toolResults: { toolName?: string; output?: unknown }[];
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  [key: string]: unknown;
}

/**
 * `toolChoice` strategy. The default for ad-hoc / programmatic runs
 * is `auto`, leaving the model free to mix tool calls and free text.
 *
 * For wake-triggered runs we use `required-first-step`: the *first*
 * inner step is forced to call a tool (so the model picks
 * `channel.pass` or a posting tool fast), and subsequent steps go
 * back to `auto` to keep multi-step read→write→reply work fluid.
 *
 * Setting AI-SDK's `toolChoice` globally would force a tool on
 * every step — that's what L1/L2 in the runtime plan flagged as a
 * loop spinner. The per-step strategy fixes it.
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
   * publish a visible reply or explicitly silence the run — there is
   * no further work to do.
   */
  stopWhen: NonNullable<Parameters<typeof streamText>[0]['stopWhen']>;
  maxOutputTokens?: number;
  temperature?: number;
  toolChoice?: AgentLoopToolChoice;
  abortSignal?: AbortSignal;
  loadInterruptMessages?: (step: AgentLoopStep) => Promise<ModelMessage[]> | ModelMessage[];
}): Promise<AgentLoopResult> {
  const steps: AgentLoopStep[] = [];
  const messages = [...input.messages];
  const toolChoiceStrategy: AgentLoopToolChoice = input.toolChoice ?? 'auto';
  const userStopWhen = input.stopWhen;
  let sawModelOutputStreamPart = false;

  // Composed stop predicate: stop when the user predicate fires, OR
  // when any prior step's toolCalls include a terminating tool. This
  // is the missing half of L1 — without it, the AI-SDK loop keeps
  // running after `channel.pass` and `channel.handoff` calls.
  const stopWhen: NonNullable<Parameters<typeof streamText>[0]['stopWhen']> = (info) => {
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
      prepareStep: async ({ stepNumber, messages: nextMessages }) => {
        // L2: per-step toolChoice. Force `required` on step 0 only
        // when the caller asked for the wake-run strategy; otherwise
        // leave it `auto` (the SDK default). Setting toolChoice on
        // every step would force a tool on continuation steps and
        // make the loop spin until token-cap.
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
        throw part.error;
      }
      if (isModelOutputStreamPart(part)) {
        sawModelOutputStreamPart = true;
      }
    }
    const [text, usage] = await Promise.all([result.text, result.usage]);
    const toolResults = steps.flatMap((step) => step.toolResults ?? []);
    return { text, steps, toolResults, usage } as unknown as AgentLoopResult;
  };

  try {
    return await execute(toolChoiceStrategy);
  } catch (error) {
    if (
      toolChoiceStrategy === 'required-first-step' &&
      steps.length === 0 &&
      !sawModelOutputStreamPart &&
      isUnsupportedToolChoiceError(error)
    ) {
      return execute('auto');
    }
    throw error;
  }
}

function isModelOutputStreamPart(part: { type?: unknown }): boolean {
  if (typeof part.type !== 'string') return false;
  return (
    part.type.includes('text') ||
    part.type.includes('reasoning') ||
    part.type.includes('tool')
  );
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
