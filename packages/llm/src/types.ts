// New (AI SDK) LLM surface.
//
// Consumers should only import from this entrypoint. The old hand-rolled
// clients live behind `@ujima/llm/legacy` and are on a deletion schedule.

export { PROVIDER_KINDS } from "@ujima/shared";
export type { ProviderKind } from "@ujima/shared";

export class LLMError extends Error {
  readonly code: 'not_configured' | 'unsupported_kind' | 'bad_config';
  constructor(code: 'not_configured' | 'unsupported_kind' | 'bad_config', message: string) {
    super(message);
    this.code = code;
    this.name = 'LLMError';
  }
}
