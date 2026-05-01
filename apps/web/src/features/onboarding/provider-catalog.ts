export interface ProviderCatalogOption {
  value: string;
  label: string;
  token: string;
}

export const PROVIDER_OPTIONS: readonly ProviderCatalogOption[] = [
  { value: "Anthropic", label: "Anthropic", token: "anthropic" },
  { value: "OpenAI", label: "OpenAI", token: "openai" },
  { value: "Google", label: "Google", token: "google" },
  { value: "Mistral", label: "Mistral", token: "mistral" },
  { value: "DeepSeek", label: "DeepSeek", token: "deepseek" },
  { value: "xAI", label: "xAI", token: "xai" },
  { value: "Kimi", label: "Kimi", token: "kimi" },
  { value: "Zhipu AI", label: "Zhipu AI", token: "zhipu-ai" },
  { value: "OpenAI Codex", label: "OpenAI Codex", token: "openai-codex" },
] as const;

const PROVIDER_LABELS = new Map(PROVIDER_OPTIONS.map((option) => [option.token, option.value]));

export function normalizeProviderToken(value: string) {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

export function providerValueFromToken(token: string) {
  return PROVIDER_LABELS.get(normalizeProviderToken(token)) ?? token;
}
