export interface ProviderModelOption {
  value: string;
  label: string;
}

function normalizeProviderToken(value: string) {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

export const MODEL_OPTIONS_BY_PROVIDER: Record<string, readonly ProviderModelOption[]> = {
  anthropic: [
    { value: "claude-opus-4-7", label: "claude-opus-4-7" },
    { value: "claude-opus-4-6", label: "claude-opus-4-6" },
    { value: "claude-opus-4-5", label: "claude-opus-4-5" },
    { value: "claude-sonnet-4-20250514", label: "claude-sonnet-4-20250514" },
    { value: "claude-opus-4-1-20250805", label: "claude-opus-4-1-20250805" },
    { value: "claude-3-7-sonnet-latest", label: "claude-3-7-sonnet-latest" },
    { value: "claude-3-5-haiku-latest", label: "claude-3-5-haiku-latest" },
  ],
  openai: [
    { value: "gpt-5.5", label: "gpt-5.5" },
    { value: "gpt-5.4", label: "gpt-5.4" },
    { value: "gpt-5.4-mini", label: "gpt-5.4-mini" },
    { value: "gpt-5.4-nano", label: "gpt-5.4-nano" },
    { value: "gpt-4.1", label: "gpt-4.1" },
    { value: "gpt-4o", label: "gpt-4o" },
    { value: "gpt-4o-mini", label: "gpt-4o-mini" },
  ],
  google: [
    { value: "gemini-3.1-pro", label: "gemini-3.1-pro" },
    { value: "gemini-3-flash", label: "gemini-3-flash" },
    { value: "gemini-3-pro-preview", label: "gemini-3-pro-preview" },
    { value: "gemini-2.5-pro", label: "gemini-2.5-pro" },
    { value: "gemini-2.5-flash", label: "gemini-2.5-flash" },
  ],
  mistral: [
    { value: "mistral-large-latest", label: "mistral-large-latest" },
    { value: "mistral-small-latest", label: "mistral-small-latest" },
    { value: "magistral-medium-latest", label: "magistral-medium-latest" },
  ],
  deepseek: [
    { value: "deepseek-v4-flash", label: "deepseek-v4-flash" },
    { value: "deepseek-v4-pro", label: "deepseek-v4-pro" },
    { value: "deepseek-reasoner", label: "deepseek-reasoner" },
  ],
  xai: [
    { value: "grok-4.3", label: "grok-4.3" },
    { value: "grok-4-fast-non-reasoning", label: "grok-4-fast-non-reasoning" },
    { value: "grok-4-fast-reasoning", label: "grok-4-fast-reasoning" },
    { value: "grok-4-0709", label: "grok-4-0709" },
    { value: "grok-3", label: "grok-3" },
    { value: "grok-3-mini", label: "grok-3-mini" },
  ],
  kimi: [
    { value: "kimi-k2.5", label: "kimi-k2.5" },
    { value: "kimi-k2-thinking", label: "kimi-k2-thinking" },
    { value: "kimi-k2-turbo-preview", label: "kimi-k2-turbo-preview" },
    { value: "kimi-k2-0905-preview", label: "kimi-k2-0905-preview" },
  ],
  "zhipu-ai": [
    { value: "glm-4.5", label: "glm-4.5" },
    { value: "glm-4.5-air", label: "glm-4.5-air" },
  ],
  "openai-codex": [
    { value: "gpt-5.5", label: "gpt-5.5" },
    { value: "gpt-5.4", label: "gpt-5.4" },
    { value: "gpt-5.4-mini", label: "gpt-5.4-mini" },
    { value: "gpt-4.1", label: "gpt-4.1" },
    { value: "gpt-4o", label: "gpt-4o" },
  ],
  openrouter: [
    { value: "openai/gpt-5.5", label: "openai/gpt-5.5" },
    { value: "anthropic/claude-sonnet-4-20250514", label: "anthropic/claude-sonnet-4-20250514" },
    { value: "openai/gpt-5.4", label: "openai/gpt-5.4" },
    { value: "google/gemini-2.5-pro", label: "google/gemini-2.5-pro" },
  ],
  ollama: [
    { value: "llama3.1", label: "llama3.1" },
    { value: "qwen2.5", label: "qwen2.5" },
    { value: "mistral-small3.1", label: "mistral-small3.1" },
  ],
};

export function getModelOptionsForProvider(provider: string): readonly ProviderModelOption[] {
  const options = MODEL_OPTIONS_BY_PROVIDER[normalizeProviderToken(provider)];
  return options ?? (MODEL_OPTIONS_BY_PROVIDER.openai as readonly ProviderModelOption[]);
}

export function defaultModelForProvider(provider: string): string {
  return getModelOptionsForProvider(provider)[0]?.value ?? "gpt-5.4";
}
