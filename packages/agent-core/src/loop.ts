import { streamText, type AssistantContent, type LanguageModel, type ModelMessage, type ToolContent, type ToolSet } from 'ai';

export const RUN_TERMINATING_TOOL_NAMES = new Set([
  'message',
  'channel.reply',
  'channel.close',
  'channel.post',
  'channel.handoff',
  'channel.ack',
  'channel.pass',
]);

export function normalizeToDottedToolName(name: string): string {
  return name.replace(/_/g, '.');
}

export interface AgentLoopStep {
  text?: string;
  toolCalls?: { toolCallId?: string; toolName?: string; input?: unknown; providerExecuted?: boolean }[];
  toolResults?: { toolCallId?: string; output?: unknown; result?: unknown }[];
  staticToolCalls?: { toolName?: string; providerExecuted?: boolean }[];
  dynamicToolCalls?: { toolName?: string; providerExecuted?: boolean }[];
  staticToolResults?: { toolName?: string; output?: unknown; result?: unknown }[];
  dynamicToolResults?: { toolName?: string; output?: unknown; result?: unknown }[];
  content?: { type?: string; text?: string; toolName?: string; output?: unknown; result?: unknown; providerExecuted?: boolean }[];
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
  finishReason?: unknown;
  [key: string]: unknown;
}

export type HumanPause =
  | { kind: 'approval'; id: string }
  | { kind: 'input'; id: string };

export class ToolApprovalRequiredError extends Error {
  constructor(readonly approvalId: string) {
    super(`Tool action requires approval: ${approvalId}`);
    this.name = 'ToolApprovalRequiredError';
  }
}

export class ToolInputRequiredError extends Error {
  constructor(readonly questionId: string) {
    super(`Tool action requires interactive user input: ${questionId}`);
    this.name = 'ToolInputRequiredError';
  }
}

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

export class SchemaTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaTooLargeError';
  }
}

export class ContextLengthExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextLengthExceededError';
  }
}

export function findToolApprovalRequiredError(error: unknown): ToolApprovalRequiredError | null {
  if (error instanceof ToolApprovalRequiredError) return error;
  if (!error || typeof error !== 'object') return null;
  const record = error as Record<string, unknown>;
  if (record.name === 'ToolApprovalRequiredError' && typeof record.approvalId === 'string') {
    return new ToolApprovalRequiredError(record.approvalId);
  }
  for (const key of ['cause', 'error']) {
    const nested = findToolApprovalRequiredError(record[key]);
    if (nested) return nested;
  }
  return null;
}

export function findToolInputRequiredError(error: unknown): ToolInputRequiredError | null {
  if (error instanceof ToolInputRequiredError) return error;
  if (!error || typeof error !== 'object') return null;
  const record = error as Record<string, unknown>;
  if (record.name === 'ToolInputRequiredError' && typeof record.questionId === 'string') {
    return new ToolInputRequiredError(record.questionId);
  }
  for (const key of ['cause', 'error']) {
    const nested = findToolInputRequiredError(record[key]);
    if (nested) return nested;
  }
  return null;
}

function rethrowClassified(error: unknown): never {
  const approval = findToolApprovalRequiredError(error);
  if (approval) throw approval;
  const input = findToolInputRequiredError(error);
  if (input) throw input;
  if (
    error instanceof ModelNotFoundError ||
    error instanceof SchemaTooLargeError ||
    error instanceof ContextLengthExceededError
  ) throw error;
  const classified = classifyApiError(error);
  if (classified) throw classified;
  throw error;
}

function classifyApiError(error: unknown): Error | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as Record<string, unknown>;
  if (e.name !== 'AI_APICallError') return null;
  const message = typeof e.message === 'string' ? e.message : '';
  const url = typeof e.url === 'string' ? e.url : '';
  const status = typeof e.statusCode === 'number' ? e.statusCode : undefined;

  if (
    status === 404 &&
    /is not found for API version|is not supported for generateContent/i.test(message)
  ) {
    const modelMatch = url.match(/models\/([^:]+):/);
    const modelId = modelMatch?.[1] ?? 'unknown';
    const providerHint = url.includes('generativelanguage.googleapis.com') ? 'google' : undefined;
    return new ModelNotFoundError(modelId, providerHint, message);
  }

  if (status === 400 && /too many states for serving/i.test(message)) {
    return new SchemaTooLargeError(message);
  }

  if (/context_length_exceeded/i.test(message)) {
    return new ContextLengthExceededError(message);
  }

  return null;
}

function stepToolResultItems(step: AgentLoopStep): { output?: unknown; result?: unknown }[] {
  return [
    ...(step.toolResults ?? []),
    ...(step.staticToolResults ?? []),
    ...(step.dynamicToolResults ?? []),
    ...(step.content ?? []),
  ];
}

function toolResultPayload(result: { output?: unknown; result?: unknown }): unknown {
  return result.output ?? result.result;
}

export function approvalWaitFromSteps(steps: readonly AgentLoopStep[]): string | null {
  for (const step of steps) {
    for (const result of stepToolResultItems(step)) {
      const output = toolResultPayload(result) as { status?: unknown; approvalId?: unknown } | undefined;
      if (output?.status === 'waiting_for_approval' && typeof output.approvalId === 'string') {
        return output.approvalId;
      }
    }
  }
  return null;
}

export function inputWaitFromSteps(steps: readonly AgentLoopStep[]): string | null {
  for (const step of steps) {
    for (const result of stepToolResultItems(step)) {
      const output = toolResultPayload(result) as { status?: unknown; questionId?: unknown } | undefined;
      if (output?.status === 'waiting_for_input' && typeof output.questionId === 'string') {
        return output.questionId;
      }
    }
  }
  return null;
}

export function humanPauseFromSteps(steps: readonly AgentLoopStep[]): HumanPause | null {
  const approvalId = approvalWaitFromSteps(steps);
  if (approvalId) return { kind: 'approval', id: approvalId };
  const questionId = inputWaitFromSteps(steps);
  if (questionId) return { kind: 'input', id: questionId };
  return null;
}

export function stepPausesRun(step: AgentLoopStep): boolean {
  return humanPauseFromSteps([step]) !== null;
}

function throwHumanPause(pause: HumanPause): never {
  if (pause.kind === 'approval') throw new ToolApprovalRequiredError(pause.id);
  throw new ToolInputRequiredError(pause.id);
}

export function mergeInterruptMessages(
  messages: ModelMessage[],
  nextMessages: ModelMessage[],
  interrupts: ModelMessage[],
): ModelMessage[] {
  if (!interrupts.length) return messages;
  if (nextMessages === messages) {
    messages.push(...interrupts);
    return messages;
  }
  messages.splice(0, messages.length, ...nextMessages, ...interrupts);
  return messages;
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
    const output = toolResultPayload(record) as { status?: unknown } | undefined;
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

export function stepHasFinalText(step: AgentLoopStep): boolean {
  const text = typeof step.text === 'string' ? step.text.trim() : '';
  const contentText = (step.content ?? []).some((part) => {
    const record = part as { type?: string; text?: unknown };
    return record.type === 'text' && typeof record.text === 'string' && record.text.trim();
  });
  if (!text && !contentText) return false;
  return !stepHasPendingToolCall(step);
}

function stepHasPendingToolCall(step: AgentLoopStep): boolean {
  const calls = [
    ...(step.toolCalls ?? []),
    ...(step.staticToolCalls ?? []),
    ...(step.dynamicToolCalls ?? []),
  ];
  if (calls.some((item) => (item as { providerExecuted?: boolean }).providerExecuted !== true)) return true;
  return (step.content ?? []).some((item) => {
    const record = item as { type?: string; providerExecuted?: boolean };
    return record.type === 'tool-call' && record.providerExecuted !== true;
  });
}

export async function runAgentLoop(input: {
  model: LanguageModel;
  system: string;
  messages: NonNullable<Parameters<typeof streamText>[0]['messages']>;
  tools: ToolSet;
  stopWhen: NonNullable<Parameters<typeof streamText>[0]['stopWhen']>;
  maxOutputTokens?: number;
  temperature?: number;
  toolChoice?: Parameters<typeof streamText>[0]['toolChoice'];
  abortSignal?: AbortSignal;
  loadInterruptMessages?: (step: AgentLoopStep) => Promise<ModelMessage[]> | ModelMessage[];
  onChunk?: (chunk: AgentLoopChunk) => PromiseLike<void> | void;
  onStepFinish?: (step: AgentLoopStep, steps: AgentLoopStep[]) => PromiseLike<void> | void;
  detectExternalPause?: () => HumanPause | null;
}): Promise<AgentLoopResult> {
  const steps: AgentLoopStep[] = [];
  const messages = sanitizeModelMessages(input.messages);
  const userStopWhen = input.stopWhen;
  const onChunk = input.onChunk;
  let pendingInterrupts: ModelMessage[] = [];

  const readInterrupts = async (step: AgentLoopStep): Promise<ModelMessage[]> =>
    sanitizeModelMessages(await input.loadInterruptMessages?.(step) ?? []);

  const loadInterruptsForStep = async (step: AgentLoopStep): Promise<ModelMessage[]> => {
    if (pendingInterrupts.length) {
      const out = pendingInterrupts;
      pendingInterrupts = [];
      return out;
    }
    return readInterrupts(step);
  };

  const hasInterruptsForStep = async (step: AgentLoopStep): Promise<boolean> => {
    if (pendingInterrupts.length) return true;
    const loaded = await readInterrupts(step);
    if (!loaded.length) return false;
    pendingInterrupts = loaded;
    return true;
  };

  const stopWhen: NonNullable<Parameters<typeof streamText>[0]['stopWhen']> = async (info) => {
    const completedSteps = [...steps, ...(info.steps as AgentLoopStep[])];
    if (humanPauseFromSteps(completedSteps)) return true;
    if (input.detectExternalPause?.()) return true;
    for (const step of completedSteps) {
      if (stepTerminatesRun(step)) return true;
    }
    for (const step of completedSteps) {
      if (!stepHasFinalText(step)) continue;
      if (input.loadInterruptMessages && await hasInterruptsForStep(step)) return false;
      return true;
    }
    if (typeof userStopWhen === 'function') {
      try {
        return await (userStopWhen as unknown as (i: typeof info) => boolean | Promise<boolean>)(info);
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
              if (chunk.type === 'reasoning-delta' && delta) {
                await onChunk({ kind: 'reasoning', delta });
              }
            },
          }
        : {}),
      prepareStep: async ({ stepNumber, messages: nextMessages }) => {
        if (stepNumber === 0) return undefined;
        const pause = input.detectExternalPause?.();
        if (pause) throwHumanPause(pause);
        const previousStep = steps.at(-1);
        if (!previousStep) return undefined;
        const interrupts = await loadInterruptsForStep(previousStep);
        if (!interrupts.length) return undefined;
        mergeInterruptMessages(messages, nextMessages, interrupts);
        messages.splice(0, messages.length, ...sanitizeModelMessages(messages));
        return { messages };
      },
      onStepFinish: async (step) => {
        const loopStep = step as unknown as AgentLoopStep;
        steps.push(loopStep);
        const pause = humanPauseFromSteps([loopStep]) ?? input.detectExternalPause?.();
        if (pause) throwHumanPause(pause);
        await input.onStepFinish?.(loopStep, steps);
      },
    });

    try {
      for await (const part of result.fullStream) {
        if (part.type === 'error') rethrowClassified(part.error);
      }
    } catch (streamError) {
      rethrowClassified(streamError);
    }

    let text: string;
    let usage: AgentLoopResult['usage'];
    let finishReason: unknown;
    try {
      [text, usage, finishReason] = await Promise.all([result.text, result.totalUsage, result.finishReason]);
    } catch (resolveError) {
      rethrowClassified(resolveError);
    }

    const toolResults = steps.flatMap((step) => step.toolResults ?? []);
    const pause = humanPauseFromSteps(steps) ?? input.detectExternalPause?.();
    if (pause) throwHumanPause(pause);
    const normalizedUsage = normalizeStepTokenUsage(steps);
    return {
      text,
      steps,
      toolResults,
      usage: normalizedUsage.totalTokens > 0 ? normalizedUsage : usage,
      finishReason,
    } as unknown as AgentLoopResult;
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

export interface NormalizedTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export function normalizeTokenUsage(usage: unknown): NormalizedTokenUsage {
  const value = usage as { inputTokens?: unknown; outputTokens?: unknown; totalTokens?: unknown } | undefined;
  const inputTokens = tokenTotal(value?.inputTokens);
  const outputTokens = tokenTotal(value?.outputTokens);
  const totalTokens = tokenTotal(value?.totalTokens) || inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

export function normalizeStepTokenUsage(steps: readonly { usage?: unknown }[]): NormalizedTokenUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const step of steps) {
    const usage = normalizeTokenUsage(step.usage);
    if (usage.inputTokens > 0) inputTokens = usage.inputTokens;
    outputTokens += usage.outputTokens;
  }
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

function tokenTotal(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (value && typeof value === 'object') return tokenTotal((value as { total?: unknown }).total);
  return 0;
}

export function sanitizeModelMessages(messages: readonly ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  let pendingToolCallIds = new Set<string>();

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === 'assistant') {
      const sanitized = sanitizeAssistantMessage(message, toolResultIdsFor(messages[index + 1]));
      pendingToolCallIds = sanitized ? toolCallIdsFor(sanitized.content) : new Set<string>();
      if (sanitized) out.push(sanitized);
      continue;
    }

    if (message.role === 'tool') {
      const sanitized = sanitizeToolMessage(message, pendingToolCallIds);
      pendingToolCallIds = new Set<string>();
      if (sanitized) out.push(sanitized);
      continue;
    }

    pendingToolCallIds = new Set<string>();
    out.push(message);
  }

  return out;
}

function sanitizeAssistantMessage(
  message: Extract<ModelMessage, { role: 'assistant' }>,
  nextToolResultIds: Set<string>,
): Extract<ModelMessage, { role: 'assistant' }> | null {
  if (!Array.isArray(message.content)) return message;
  const content: AssistantContent = [];
  let changed = false;
  for (const part of message.content) {
    if (isToolCallPart(part) && !nextToolResultIds.has(part.toolCallId)) {
      changed = true;
      continue;
    }
    content.push(part);
  }
  if (!changed) return message;
  if (content.length === 0) return null;
  return { ...message, content };
}

function sanitizeToolMessage(
  message: Extract<ModelMessage, { role: 'tool' }>,
  pendingToolCallIds: Set<string>,
): Extract<ModelMessage, { role: 'tool' }> | null {
  if (!Array.isArray(message.content)) return null;
  if (pendingToolCallIds.size === 0) return null;
  const content: ToolContent = [];
  for (const part of message.content) {
    if (isToolResultPart(part) && pendingToolCallIds.has(part.toolCallId)) content.push(part);
  }
  if (content.length === 0) return null;
  return { ...message, content };
}

function toolResultIdsFor(message: ModelMessage | undefined): Set<string> {
  if (!message || message.role !== 'tool' || !Array.isArray(message.content)) return new Set();
  const ids = new Set<string>();
  for (const part of message.content) {
    if (isToolResultPart(part)) ids.add(part.toolCallId);
  }
  return ids;
}

function toolCallIdsFor(content: Extract<ModelMessage, { role: 'assistant' }>['content']): Set<string> {
  if (!Array.isArray(content)) return new Set();
  const ids = new Set<string>();
  for (const part of content) {
    if (isToolCallPart(part)) ids.add(part.toolCallId);
  }
  return ids;
}

function isToolCallPart(part: unknown): part is { type: 'tool-call'; toolCallId: string } {
  return !!part && typeof part === 'object' &&
    (part as { type?: unknown }).type === 'tool-call' &&
    typeof (part as { toolCallId?: unknown }).toolCallId === 'string';
}

function isToolResultPart(part: unknown): part is { type: 'tool-result'; toolCallId: string } {
  return !!part && typeof part === 'object' &&
    (part as { type?: unknown }).type === 'tool-result' &&
    typeof (part as { toolCallId?: unknown }).toolCallId === 'string';
}
