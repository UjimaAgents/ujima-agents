export interface ProviderModelOption {
  value: string;
  label: string;
}

function normalizeProviderToken(value: string) {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

export const MODEL_OPTIONS_BY_PROVIDER: Record<string, readonly ProviderModelOption[]> = {
  anthropic: [
    { value: "claude-opus-4-8", label: "claude-opus-4-8" },
    { value: "claude-opus-4-7", label: "claude-opus-4-7" },
    { value: "claude-sonnet-4-6", label: "claude-sonnet-4-6" },
    { value: "claude-haiku-4-5", label: "claude-haiku-4-5" },
    { value: "fable-5", label: "fable-5" },
  ],
  openai: [
    { value: "gpt-5.5", label: "gpt-5.5" },
    { value: "gpt-5.4-mini", label: "gpt-5.4-mini" },
    { value: "gpt-5.4-nano", label: "gpt-5.4-nano" },
    { value: "gpt-5.4", label: "gpt-5.4" },
    { value: "gpt-4.1", label: "gpt-4.1" },
    { value: "gpt-5.6-sol", label: "gpt-5.6-sol" },
    { value: "gpt-5.6-terra", label: "gpt-5.6-terra" },
    { value: "gpt-5.6-luna", label: "gpt-5.6-luna" },
  ],
  google: [
    { value: "gemini-3.5-flash", label: "gemini-3.5-flash" },
    { value: "gemini-3.1-pro", label: "gemini-3.1-pro" },
    { value: "gemini-3-flash", label: "gemini-3-flash" },
    { value: "gemini-3.1-flash-lite", label: "gemini-3.1-flash-lite" },
  ],
  mistral: [
    { value: "mistral-medium-3-5", label: "mistral-medium-3-5" },
    { value: "mistral-small-4", label: "mistral-small-4" },
    { value: "mistral-large-3", label: "mistral-large-3" },
    { value: "mistral-large-latest", label: "mistral-large-latest" },
    { value: "ministral-3-14b", label: "ministral-3-14b" },
    { value: "ministral-3-8b", label: "ministral-3-8b" },
    { value: "devstral-2", label: "devstral-2" },
    { value: "codestral-2501", label: "codestral-2501" },
    { value: "pixtral-large-2411", label: "pixtral-large-2411" },
  ],
  deepseek: [
    { value: "deepseek-v4-pro", label: "deepseek-v4-pro (text-only)" },
    { value: "deepseek-v4-flash", label: "deepseek-v4-flash (text-only)" },
  ],
  xai: [
    { value: "grok-4.3", label: "grok-4.3" },
    { value: "grok-4.5", label: "grok-4.5" },
    { value: "grok-build-0.1", label: "grok-build-0.1" },
    { value: "grok-4.20", label: "grok-4.20" },
    { value: "grok-4.20-reasoning", label: "grok-4.20-reasoning" },
    { value: "grok-4.20-multi-agent", label: "grok-4.20-multi-agent" },
    { value: "grok-4-1-fast", label: "grok-4-1-fast" },
    { value: "grok-4-fast-non-reasoning", label: "grok-4-fast-non-reasoning" },
    { value: "grok-4-fast-reasoning", label: "grok-4-fast-reasoning" },
    { value: "grok-4-0709", label: "grok-4-0709" },
    { value: "grok-3", label: "grok-3" },
    { value: "grok-3-mini", label: "grok-3-mini" },
  ],
  kimi: [
    { value: "kimi-k2.7-code", label: "kimi-k2.7-code" },
    { value: "kimi-k2.7-code-highspeed", label: "kimi-k2.7-code-highspeed" },
    { value: "kimi-k2.6", label: "kimi-k2.6" },
    { value: "kimi-k2.5", label: "kimi-k2.5" },
  ],
  zhipu: [
    { value: "glm-5.2", label: "glm-5.2" },
    { value: "glm-5v-turbo", label: "glm-5v-turbo" },
    { value: "glm-5.1", label: "glm-5.1" },
    { value: "glm-5", label: "glm-5" },
    { value: "glm-5-turbo", label: "glm-5-turbo" },
    { value: "glm-4.7", label: "glm-4.7" },
    { value: "glm-4.7-flashx", label: "glm-4.7-flashx" },
    { value: "glm-4.6", label: "glm-4.6" },
    { value: "glm-4.6v", label: "glm-4.6v" },
    { value: "glm-4.5", label: "glm-4.5" },
    { value: "glm-4.5-air", label: "glm-4.5-air" },
    { value: "glm-4.5-airx", label: "glm-4.5-airx" },
  ],
  "openai-codex": [
    { value: "gpt-5.5", label: "gpt-5.5" },
    { value: "gpt-5.4-mini", label: "gpt-5.4-mini" },
    { value: "gpt-5.4-nano", label: "gpt-5.4-nano" },
    { value: "gpt-5.4", label: "gpt-5.4" },
    { value: "gpt-4.1", label: "gpt-4.1" },
    { value: "gpt-5.6-sol", label: "gpt-5.6-sol" },
    { value: "gpt-5.6-terra", label: "gpt-5.6-terra" },
    { value: "gpt-5.6-luna", label: "gpt-5.6-luna" },
  ],
  openrouter: [
    { value: "openai/gpt-5.5", label: "openai/gpt-5.5" },
    { value: "anthropic/claude-opus-4-8", label: "anthropic/claude-opus-4-8" },
    { value: "google/gemini-3.5-flash", label: "google/gemini-3.5-flash" },
    { value: "openai/gpt-5.4", label: "openai/gpt-5.4" },
    { value: "deepseek/deepseek-v4-pro", label: "deepseek/deepseek-v4-pro (vision)" },
    { value: "deepseek/deepseek-v4-flash", label: "deepseek/deepseek-v4-flash (vision)" },
    { value: "openai/gpt-5.6-sol", label: "openai/gpt-5.6-sol" },
    { value: "openai/gpt-5.6-terra", label: "openai/gpt-5.6-terra" },
    { value: "openai/gpt-5.6-luna", label: "openai/gpt-5.6-luna" },
    { value: "anthropic/fable-5", label: "anthropic/fable-5" },
  ],
  ollama: [
    { value: "llama3.1", label: "llama3.1" },
    { value: "qwen2.5", label: "qwen2.5" },
    { value: "mistral-small3.1", label: "mistral-small3.1" },
  ],
};

export function getModelOptionsForProvider(provider: string): readonly ProviderModelOption[] {
  const options = MODEL_OPTIONS_BY_PROVIDER[normalizeProviderToken(provider)];
  return options ?? [];
}

const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-5.4",
  google: "gemini-3.1-pro",
  mistral: "mistral-large-latest",
  deepseek: "deepseek-v4-flash",
  xai: "grok-4.3",
  kimi: "kimi-k2.5",
  zhipu: "glm-4.5",
  "openai-codex": "gpt-5.4",
  openrouter: "openai/gpt-4o",
  ollama: "llama3.1",
};

export function defaultModelForProvider(provider: string): string {
  const normalized = normalizeProviderToken(provider);
  return DEFAULT_MODEL_BY_PROVIDER[normalized] ?? "";
}
