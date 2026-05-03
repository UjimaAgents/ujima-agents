import type { OutputChannel } from 'vscode';
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3ToolCall,
  LanguageModelV3ToolResultPart,
} from '@ai-sdk/provider';
import type { LLMContentPart, LLMMessage, LLMProvider, LLMToolSpec } from '@ujima/llm/legacy';
import type { LanguageModel } from 'ai';
import { createVscodeLmProvider } from './vscode-lm-provider';

function emptyUsage(): LanguageModelV3GenerateResult['usage'] {
  return {
    inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  };
}

function toolResultOutputToUnknown(output: LanguageModelV3ToolResultPart['output']): unknown {
  switch (output.type) {
    case 'text':
      return output.value;
    case 'json':
      return JSON.stringify(output.value);
    case 'error-text':
      return output.value;
    case 'error-json':
      return JSON.stringify(output.value);
    case 'execution-denied':
      return output.reason ?? 'execution denied';
    case 'content':
      return output.value.map((x) => (x.type === 'text' ? x.text : '')).join('');
    default:
      return JSON.stringify(output);
  }
}

function v3PromptToLlmMessages(prompt: LanguageModelV3CallOptions['prompt']): LLMMessage[] {
  const out: LLMMessage[] = [];
  for (const msg of prompt) {
    if (msg.role === 'system') {
      out.push({ role: 'system', content: msg.content });
      continue;
    }
    if (msg.role === 'user') {
      const parts: LLMContentPart[] = [];
      for (const c of msg.content) {
        if (c.type === 'text') parts.push({ type: 'text', text: c.text });
        if (c.type === 'file') parts.push({ type: 'text', text: `[attached file: ${c.mediaType}]` });
      }
      out.push({
        role: 'user',
        content: parts.length === 1 && parts[0]?.type === 'text' ? parts[0].text : parts,
      });
      continue;
    }
    if (msg.role === 'assistant') {
      const parts: LLMContentPart[] = [];
      for (const c of msg.content) {
        if (c.type === 'text') parts.push({ type: 'text', text: c.text });
        if (c.type === 'reasoning') parts.push({ type: 'text', text: c.text });
        if (c.type === 'tool-call') {
          const args =
            c.input !== null && typeof c.input === 'object' && !Array.isArray(c.input)
              ? (c.input as Record<string, unknown>)
              : {};
          parts.push({ type: 'tool_call', id: c.toolCallId, name: c.toolName, arguments: args });
        }
        if (c.type === 'tool-result') {
          parts.push({
            type: 'tool_result',
            toolCallId: c.toolCallId,
            content: toolResultOutputToUnknown(c.output),
            isError: c.output.type === 'error-text' || c.output.type === 'error-json',
          });
        }
        if (c.type === 'file') parts.push({ type: 'text', text: `[attached file]` });
      }
      out.push({ role: 'assistant', content: parts });
      continue;
    }
    if (msg.role === 'tool') {
      const parts: LLMContentPart[] = [];
      for (const c of msg.content) {
        if (c.type === 'tool-result') {
          parts.push({
            type: 'tool_result',
            toolCallId: c.toolCallId,
            content: toolResultOutputToUnknown(c.output),
            isError: c.output.type === 'error-text' || c.output.type === 'error-json',
          });
        }
      }
      if (parts.length > 0) out.push({ role: 'tool', content: parts });
    }
  }
  return out;
}

function v3ToolsToLlm(tools: LanguageModelV3CallOptions['tools']): LLMToolSpec[] | undefined {
  if (!tools?.length) return undefined;
  return tools
    .filter((t): t is LanguageModelV3FunctionTool => t.type === 'function')
    .map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    }));
}

async function collectGenerateFromStream(
  stream: ReadableStream<LanguageModelV3StreamPart>,
): Promise<LanguageModelV3GenerateResult> {
  const reader = stream.getReader();
  const textChunks: string[] = [];
  const toolCalls: LanguageModelV3ToolCall[] = [];
  let finish: Extract<LanguageModelV3StreamPart, { type: 'finish' }> | undefined;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.type === 'text-delta') textChunks.push(value.delta);
      if (value.type === 'tool-call') toolCalls.push(value);
      if (value.type === 'finish') finish = value;
    }
  } finally {
    reader.releaseLock();
  }
  const content: LanguageModelV3Content[] = [];
  const text = textChunks.join('');
  if (text) content.push({ type: 'text', text });
  for (const tc of toolCalls) content.push(tc);
  return {
    content,
    usage: finish?.usage ?? emptyUsage(),
    finishReason: finish?.finishReason ?? { unified: 'stop', raw: 'stop' },
    warnings: [],
  };
}

function makeStreamId(): string {
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Wraps the legacy vscode.lm {@link import('@ujima/llm/legacy').LLMProvider} stream
 * as an AI SDK {@link LanguageModelV3} so the orchestrator can call {@link deps.getModel}.
 */
export function createVscodeLmLanguageModel(opts: {
  legacy: LLMProvider;
  modelId: string;
}): LanguageModel {
  const { legacy, modelId } = opts;

  const model: LanguageModelV3 = {
    specificationVersion: 'v3',
    provider: 'vscode-lm',
    modelId,
    supportedUrls: {},
    async doGenerate(options) {
      const { stream } = await model.doStream(options);
      return collectGenerateFromStream(stream);
    },
    async doStream(options): Promise<LanguageModelV3StreamResult> {
      const messages = v3PromptToLlmMessages(options.prompt);
      const tools = v3ToolsToLlm(options.tools);
      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        async start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          const textId = makeStreamId();
          let textOpen = false;
          try {
            const iterable = legacy.stream({
              messages,
              model: modelId,
              tools,
              maxTokens: options.maxOutputTokens,
              temperature: options.temperature,
              abortSignal: options.abortSignal,
            });
            for await (const d of iterable) {
              if (d.type === 'text' && d.text) {
                if (!textOpen) {
                  controller.enqueue({ type: 'text-start', id: textId });
                  textOpen = true;
                }
                controller.enqueue({ type: 'text-delta', id: textId, delta: d.text });
              } else if (d.type === 'tool_call') {
                if (textOpen) {
                  controller.enqueue({ type: 'text-end', id: textId });
                  textOpen = false;
                }
                controller.enqueue({
                  type: 'tool-call',
                  toolCallId: d.id,
                  toolName: d.name,
                  input: JSON.stringify(d.arguments ?? {}),
                });
              } else if (d.type === 'finish') {
                if (textOpen) {
                  controller.enqueue({ type: 'text-end', id: textId });
                  textOpen = false;
                }
                const unified =
                  d.reason === 'tool_use'
                    ? ('tool-calls' as const)
                    : d.reason === 'error'
                      ? ('error' as const)
                      : ('stop' as const);
                controller.enqueue({
                  type: 'finish',
                  usage: emptyUsage(),
                  finishReason: { unified, raw: d.reason },
                });
              }
            }
          } catch (error) {
            controller.enqueue({ type: 'error', error });
          } finally {
            controller.close();
          }
        },
      });
      return { stream };
    },
  };

  return model;
}

export function tryCreateVscodeLmLanguageModel(options: {
  channel?: OutputChannel;
  modelId: string;
}): LanguageModel | undefined {
  const legacy = createVscodeLmProvider({ channel: options.channel });
  if (!legacy) return undefined;
  return createVscodeLmLanguageModel({ legacy, modelId: options.modelId });
}

export function createUnconfiguredStubLanguageModel(): LanguageModel {
  const text =
    '(Ujima) No LLM configured. Set ANTHROPIC_API_KEY / OPENAI_API_KEY, run Ollama, or install GitHub Copilot for vscode.lm.';
  const id = 'stub';
  const model: LanguageModelV3 = {
    specificationVersion: 'v3',
    provider: 'ujima-stub',
    modelId: 'unconfigured',
    supportedUrls: {},
    async doGenerate(_options: LanguageModelV3CallOptions) {
      return {
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage: emptyUsage(),
        warnings: [],
      };
    },
    async doStream() {
      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id });
            controller.enqueue({ type: 'text-delta', id, delta: text });
            controller.enqueue({ type: 'text-end', id });
            controller.enqueue({
              type: 'finish',
              usage: emptyUsage(),
              finishReason: { unified: 'stop', raw: 'stop' },
            });
            controller.close();
          },
        }),
      };
    },
  };
  return model;
}
