// Legacy provider surface — pre-AI-SDK hand-rolled clients.
// New code must NOT import from here; use `@ujima/llm` instead.
// Scheduled for deletion two clean releases after the AI SDK cutover ships.
export type {
  ProviderId,
  LLMProvider,
  LLMMessage,
  LLMContentPart,
  LLMTextPart,
  LLMToolCallPart,
  LLMToolResultPart,
  LLMToolSpec,
  LLMStreamDelta,
  LLMStreamInput,
  LLMUsage,
} from './types.js';
export { LLMError } from './types.js';

export { createMockProvider, textTurn, toolTurn } from './mock.js';
export type { MockProviderOptions, MockTurn } from './mock.js';

export { createAnthropicProvider } from './anthropic.js';
export type { AnthropicProviderOptions } from './anthropic.js';

export { createOpenAICompatProvider } from './openai-compat.js';
export type { OpenAICompatProviderOptions } from './openai-compat.js';

export { createOllamaProvider } from './ollama.js';
export type { OllamaProviderOptions } from './ollama.js';

export { selectProvider } from './select.js';
export type { ProviderConfig, SelectProviderOptions } from './select.js';
