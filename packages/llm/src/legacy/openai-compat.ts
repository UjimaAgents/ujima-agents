import type { LLMMessage, LLMProvider, LLMStreamDelta, LLMStreamInput, LLMToolSpec } from './types';
import { LLMError } from './types';

export interface OpenAICompatProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  id?: 'openai-compat';
}

export function createOpenAICompatProvider(options: OpenAICompatProviderOptions): LLMProvider {
  const {
    apiKey,
    baseUrl = 'https://api.openai.com/v1',
    fetchImpl = fetch,
  } = options;
  if (!apiKey) {
    throw new LLMError('not_configured', 'OpenAI-compat provider requires an API key');
  }

  return {
    id: 'openai-compat',
    async *stream(input) {
      const body = buildRequest(input);
      const res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: input.abortSignal,
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        throw new LLMError('bad_response', `OpenAI-compat returned ${res.status}: ${text}`);
      }
      yield* parseSSE(res.body);
    },
  };
}

function buildRequest(input: LLMStreamInput): Record<string, unknown> {
  return {
    model: input.model,
    stream: true,
    temperature: input.temperature,
    max_tokens: input.maxTokens,
    messages: input.messages.map(convertMessage),
    tools: input.tools?.map(convertTool),
  };
}

function convertMessage(m: LLMMessage): Record<string, unknown> {
  if (typeof m.content === 'string') {
    return { role: m.role, content: m.content };
  }
  const text = m.content
    .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
  const toolCalls = m.content
    .filter((p): p is Extract<typeof p, { type: 'tool_call' }> => p.type === 'tool_call')
    .map((p) => ({
      id: p.id,
      type: 'function',
      function: { name: p.name, arguments: JSON.stringify(p.arguments) },
    }));
  const toolResults = m.content.filter((p): p is Extract<typeof p, { type: 'tool_result' }> => p.type === 'tool_result');

  const firstToolResult = toolResults[0];
  if (firstToolResult && m.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: firstToolResult.toolCallId,
      content:
        typeof firstToolResult.content === 'string'
          ? firstToolResult.content
          : JSON.stringify(firstToolResult.content),
    };
  }

  const msg: Record<string, unknown> = { role: m.role, content: text || null };
  if (toolCalls.length > 0) msg.tool_calls = toolCalls;
  return msg;
}

function convertTool(t: LLMToolSpec): Record<string, unknown> {
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  };
}

async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncIterable<LLMStreamDelta> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const partialTools: Record<number, { id?: string; name?: string; argsJson: string }> = {};

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      if (payload === '[DONE]') {
        for (const [, p] of Object.entries(partialTools)) {
          yield flushTool(p);
        }
        yield { type: 'finish', reason: 'end_turn' };
        return;
      }
      let evt: ChatCompletionChunk;
      try {
        evt = JSON.parse(payload) as ChatCompletionChunk;
      } catch {
        continue;
      }
      const choice = evt.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta;
      if (delta?.content) {
        yield { type: 'text', text: delta.content };
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          partialTools[idx] ??= { argsJson: '' };
          if (tc.id) partialTools[idx].id = tc.id;
          if (tc.function?.name) partialTools[idx].name = tc.function.name;
          if (tc.function?.arguments) partialTools[idx].argsJson += tc.function.arguments;
        }
      }
      if (choice.finish_reason) {
        for (const [, p] of Object.entries(partialTools)) {
          yield flushTool(p);
        }
        yield { type: 'finish', reason: mapFinish(choice.finish_reason) };
        return;
      }
    }
  }
}

function flushTool(p: { id?: string; name?: string; argsJson: string }): LLMStreamDelta {
  let args: Record<string, unknown> = {};
  try {
    args = p.argsJson ? (JSON.parse(p.argsJson) as Record<string, unknown>) : {};
  } catch {
    args = {};
  }
  return { type: 'tool_call', id: p.id ?? '', name: p.name ?? '', arguments: args };
}

function mapFinish(raw: string): 'end_turn' | 'tool_use' | 'max_tokens' | 'error' {
  if (raw === 'tool_calls') return 'tool_use';
  if (raw === 'length') return 'max_tokens';
  if (raw === 'stop') return 'end_turn';
  return 'error';
}

interface ChatCompletionChunk {
  choices?: {
    delta?: {
      content?: string;
      tool_calls?: {
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string;
  }[];
}
