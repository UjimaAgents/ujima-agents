import type { LLMMessage, LLMProvider, LLMStreamDelta, LLMToolSpec } from './types';
import { LLMError } from './types';

export interface OllamaProviderOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function createOllamaProvider(options: OllamaProviderOptions = {}): LLMProvider {
  const { baseUrl = 'http://localhost:11434', fetchImpl = fetch } = options;

  return {
    id: 'ollama',
    async *stream(input) {
      const body = {
        model: input.model,
        messages: input.messages.map(convertMessage),
        tools: input.tools?.map(convertTool),
        stream: true,
        options: {
          temperature: input.temperature,
          num_predict: input.maxTokens,
        },
      };
      const res = await fetchImpl(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: input.abortSignal,
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        throw new LLMError('bad_response', `Ollama returned ${res.status}: ${text}`);
      }
      yield* parseNDJSON(res.body);
    },
  };
}

function convertMessage(m: LLMMessage): Record<string, unknown> {
  if (typeof m.content === 'string') return { role: m.role, content: m.content };
  const text = m.content
    .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
  return { role: m.role, content: text };
}

function convertTool(t: LLMToolSpec): Record<string, unknown> {
  return { type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } };
}

async function* parseNDJSON(body: ReadableStream<Uint8Array>): AsyncIterable<LLMStreamDelta> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let promptEvalCount = 0;
  let evalCount = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let evt: OllamaChunk;
      try {
        evt = JSON.parse(trimmed) as OllamaChunk;
      } catch {
        continue;
      }
      if (evt.message?.content) {
        yield { type: 'text', text: evt.message.content };
      }
      if (evt.message?.tool_calls) {
        for (const tc of evt.message.tool_calls) {
          yield {
            type: 'tool_call',
            id: tc.id ?? `tc_${Math.random().toString(36).slice(2, 8)}`,
            name: tc.function?.name ?? '',
            arguments: (tc.function?.arguments ?? {}) as Record<string, unknown>,
          };
        }
      }
      if (evt.prompt_eval_count) promptEvalCount = evt.prompt_eval_count;
      if (evt.eval_count) evalCount = evt.eval_count;
      if (evt.done) {
        yield {
          type: 'finish',
          reason: 'end_turn',
          usage: { inputTokens: promptEvalCount, outputTokens: evalCount },
        };
        return;
      }
    }
  }
  yield { type: 'finish', reason: 'end_turn' };
}

interface OllamaChunk {
  message?: {
    content?: string;
    tool_calls?: {
      id?: string;
      function?: { name?: string; arguments?: Record<string, unknown> };
    }[];
  };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}
