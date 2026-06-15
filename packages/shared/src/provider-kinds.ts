export const PROVIDER_KINDS = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "ollama",
  "deepseek",
  "xai",
  "mistral",
  "kimi",
  "zhipu",
  "openai-codex",
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const PROVIDER_AUTH_MODES = ["apikey", "chatgpt"] as const;
export type ProviderAuthMode = (typeof PROVIDER_AUTH_MODES)[number];

export const DEFAULT_SPIRIT_TEMPERATURE = 0.2;

export const AGENT_KIND = 'agent' as const;
