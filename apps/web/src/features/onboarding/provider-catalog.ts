export interface ProviderCatalogOption {
  label: string;
  token: string;
}

export const PROVIDER_OPTIONS: readonly ProviderCatalogOption[] = [
  { label: "Anthropic", token: "anthropic" },
  { label: "OpenAI", token: "openai" },
  { label: "Google", token: "google" },
  { label: "Mistral", token: "mistral" },
  { label: "DeepSeek", token: "deepseek" },
  { label: "xAI", token: "xai" },
  { label: "Kimi", token: "kimi" },
  { label: "Zhipu AI", token: "zhipu" },
  { label: "OpenAI Codex", token: "openai-codex" },
] as const;

const PROVIDER_LABELS = new Map(PROVIDER_OPTIONS.map((option) => [option.token, option.label]));

export function normalizeProviderToken(value: string) {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

export function providerLabelFromToken(token: string) {
  return PROVIDER_LABELS.get(normalizeProviderToken(token)) ?? token;
}
