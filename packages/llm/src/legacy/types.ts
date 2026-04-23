export type ProviderId = 'mock' | 'vscode-lm' | 'anthropic' | 'openai-compat' | 'ollama';

export interface LLMTextPart {
  type: 'text';
  text: string;
}

export interface LLMToolCallPart {
  type: 'tool_call';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMToolResultPart {
  type: 'tool_result';
  toolCallId: string;
  content: unknown;
  isError?: boolean;
}

export type LLMContentPart = LLMTextPart | LLMToolCallPart | LLMToolResultPart;

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | LLMContentPart[];
}

export interface LLMToolSpec {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export type LLMStreamDelta =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'finish'; reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error'; usage?: LLMUsage };

export interface LLMStreamInput {
  messages: LLMMessage[];
  model: string;
  tools?: LLMToolSpec[];
  maxTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}

export interface LLMProvider {
  readonly id: ProviderId;
  stream(input: LLMStreamInput): AsyncIterable<LLMStreamDelta>;
}

export class LLMError extends Error {
  readonly code: 'rate_limited' | 'not_configured' | 'timeout' | 'bad_response' | 'unknown';
  constructor(
    code: 'rate_limited' | 'not_configured' | 'timeout' | 'bad_response' | 'unknown',
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = 'LLMError';
  }
}
