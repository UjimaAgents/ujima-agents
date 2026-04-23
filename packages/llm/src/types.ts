// New (AI SDK) LLM surface.
//
// Consumers should only import from this entrypoint. The old hand-rolled
// clients live behind `@ujima/llm/legacy` and are on a deletion schedule.

/**
 * Provider kinds supported by the AI SDK resolver.
 *
 * - `anthropic`, `openai`, `google` — first-party `@ai-sdk/*` packages.
 * - `openrouter` — OpenAI-compatible; uses `@ai-sdk/openai` with `baseURL`.
 * - `ollama` — OpenAI-compatible; uses `@ai-sdk/openai` against a local host.
 */
export type ProviderKind = 'anthropic' | 'openai' | 'google' | 'openrouter' | 'ollama';

export const PROVIDER_KINDS = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'ollama',
] as const satisfies readonly ProviderKind[];

export class LLMError extends Error {
  readonly code: 'not_configured' | 'unsupported_kind' | 'bad_config';
  constructor(code: 'not_configured' | 'unsupported_kind' | 'bad_config', message: string) {
    super(message);
    this.code = code;
    this.name = 'LLMError';
  }
}
