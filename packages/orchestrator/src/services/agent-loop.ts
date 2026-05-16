import { streamText, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';

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

export async function runAgentLoop(input: {
  model: LanguageModel;
  system: string;
  messages: NonNullable<Parameters<typeof streamText>[0]['messages']>;
  tools: ToolSet;
  stopWhen: NonNullable<Parameters<typeof streamText>[0]['stopWhen']>;
  maxOutputTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
  loadInterruptMessages?: (step: AgentLoopStep) => Promise<ModelMessage[]> | ModelMessage[];
  onChunk?: (chunk: AgentLoopChunk) => PromiseLike<void> | void;
}): Promise<AgentLoopResult> {
  const steps: AgentLoopStep[] = [];
  const messages = [...input.messages];
  const onChunk = input.onChunk;
  const result = streamText({
    model: input.model,
    system: input.system,
    messages,
    tools: input.tools,
    stopWhen: input.stopWhen,
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
      if (stepNumber === 0) return undefined;
      const previousStep = steps.at(-1);
      if (!previousStep) return undefined;
      const interrupts = await input.loadInterruptMessages?.(previousStep);
      if (!interrupts?.length) return undefined;
      messages.splice(0, messages.length, ...nextMessages, ...interrupts);
      return { messages };
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
  }
  const [text, usage] = await Promise.all([
    result.text,
    result.usage,
  ]);
  const toolResults = steps.flatMap((step) => step.toolResults ?? []);
  return { text, steps, toolResults, usage } as unknown as AgentLoopResult;
}
