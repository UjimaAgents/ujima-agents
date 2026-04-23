import type {
  LLMContentPart,
  LLMMessage,
  LLMProvider,
  LLMStreamDelta,
  LLMStreamInput,
  LLMToolSpec,
} from './types';
import { LLMError } from './types';

export interface AnthropicProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}
interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}
interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
type AnthropicBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicBlock[];
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  temperature?: number;
  tools?: { name: string; description?: string; input_schema: Record<string, unknown> }[];
  stream: true;
}

export function createAnthropicProvider(options: AnthropicProviderOptions): LLMProvider {
  const { apiKey, baseUrl = 'https://api.anthropic.com', fetchImpl = fetch } = options;
  if (!apiKey) {
    throw new LLMError('not_configured', 'Anthropic provider requires an API key');
  }

  return {
    id: 'anthropic',
    async *stream(input) {
      const body = buildAnthropicRequest(input);
      const res = await fetchImpl(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: input.abortSignal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        throw new LLMError('bad_response', `Anthropic returned ${res.status}: ${text}`);
      }

      yield* parseAnthropicSSE(res.body);
    },
  };
}

function buildAnthropicRequest(input: LLMStreamInput): AnthropicRequest {
  const systemParts: string[] = [];
  const messages: AnthropicMessage[] = [];
  for (const m of input.messages) {
    if (m.role === 'system') {
      systemParts.push(typeof m.content === 'string' ? m.content : flattenText(m.content));
      continue;
    }
    messages.push(convertMessage(m));
  }
  return {
    model: input.model,
    max_tokens: input.maxTokens ?? 4096,
    messages,
    system: systemParts.length ? systemParts.join('\n\n') : undefined,
    temperature: input.temperature,
    tools: input.tools?.map(convertTool),
    stream: true,
  };
}

function convertMessage(m: LLMMessage): AnthropicMessage {
  const role: 'user' | 'assistant' = m.role === 'assistant' ? 'assistant' : 'user';
  if (typeof m.content === 'string') {
    return { role, content: [{ type: 'text', text: m.content }] };
  }
  const blocks: AnthropicBlock[] = m.content.map((p): AnthropicBlock => {
    switch (p.type) {
      case 'text':
        return { type: 'text', text: p.text };
      case 'tool_call':
        return { type: 'tool_use', id: p.id, name: p.name, input: p.arguments };
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: p.toolCallId,
          content: typeof p.content === 'string' ? p.content : JSON.stringify(p.content),
          is_error: p.isError,
        };
    }
  });
  return { role, content: blocks };
}

function convertTool(t: LLMToolSpec): { name: string; description?: string; input_schema: Record<string, unknown> } {
  return {
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  };
}

function flattenText(parts: LLMContentPart[]): string {
  return parts
    .filter((p): p is Extract<LLMContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

async function* parseAnthropicSSE(body: ReadableStream<Uint8Array>): AsyncIterable<LLMStreamDelta> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';
  const partial = new Map<number, { id: string; name: string; argsJson: string }>();
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  let stopReason: LLMStreamDelta & { type: 'finish' } = { type: 'finish', reason: 'end_turn' };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const raw of events) {
      const dataLine = raw
        .split('\n')
        .find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      const jsonStr = dataLine.slice('data:'.length).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      let evt: AnthropicSSEEvent;
      try {
        evt = JSON.parse(jsonStr) as AnthropicSSEEvent;
      } catch {
        continue;
      }

      if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
        partial.set(evt.index, {
          id: evt.content_block.id ?? '',
          name: evt.content_block.name ?? '',
          argsJson: '',
        });
      } else if (evt.type === 'content_block_delta') {
        if (evt.delta?.type === 'text_delta' && evt.delta.text) {
          yield { type: 'text', text: evt.delta.text };
        } else if (evt.delta?.type === 'input_json_delta') {
          const p = partial.get(evt.index);
          if (p && evt.delta.partial_json) p.argsJson += evt.delta.partial_json;
        }
      } else if (evt.type === 'content_block_stop') {
        const p = partial.get(evt.index);
        if (p) {
          let args: Record<string, unknown> = {};
          try {
            args = p.argsJson ? (JSON.parse(p.argsJson) as Record<string, unknown>) : {};
          } catch {
            args = {};
          }
          yield { type: 'tool_call', id: p.id, name: p.name, arguments: args };
          partial.delete(evt.index);
        }
      } else if (evt.type === 'message_delta') {
        if (evt.usage) {
          usage = {
            inputTokens: evt.usage.input_tokens ?? 0,
            outputTokens: evt.usage.output_tokens ?? 0,
          };
        }
        if (evt.delta?.stop_reason) {
          stopReason = { type: 'finish', reason: mapStopReason(evt.delta.stop_reason), usage };
        }
      } else if (evt.type === 'message_stop') {
        stopReason = { type: 'finish', reason: stopReason.reason, usage: usage ?? stopReason.usage };
      }
    }
  }

  yield stopReason;
}

function mapStopReason(raw: string): 'end_turn' | 'tool_use' | 'max_tokens' | 'error' {
  if (raw === 'tool_use') return 'tool_use';
  if (raw === 'max_tokens') return 'max_tokens';
  if (raw === 'end_turn' || raw === 'stop_sequence') return 'end_turn';
  return 'error';
}

interface AnthropicSSEEvent {
  type: string;
  index: number;
  content_block?: { type: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: { input_tokens?: number; output_tokens?: number };
}
