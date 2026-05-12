import { streamText, type LanguageModel, type ToolSet } from 'ai';

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

export async function runAgentLoop(input: {
  model: LanguageModel;
  system: string;
  messages: NonNullable<Parameters<typeof streamText>[0]['messages']>;
  tools: ToolSet;
  stopWhen: NonNullable<Parameters<typeof streamText>[0]['stopWhen']>;
  maxOutputTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}): Promise<AgentLoopResult> {
  const steps: AgentLoopStep[] = [];
  const result = streamText({
    model: input.model,
    system: input.system,
    messages: input.messages,
    tools: input.tools,
    stopWhen: input.stopWhen,
    ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: input.maxOutputTokens } : {}),
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    onStepFinish: (step) => {
      steps.push(step as unknown as AgentLoopStep);
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
