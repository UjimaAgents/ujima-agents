export interface ProviderCatalogOption {
  label: string;
  token: string;
}

export const PROVIDER_OPTIONS: readonly ProviderCatalogOption[] = [
  { label: "Anthropic", token: "anthropic" },
  { label: "OpenAI", token: "openai" },
  { label: "Google", token: "google" },
  { label: "OpenRouter", token: "openrouter" },
  { label: "Ollama", token: "ollama" },
] as const;

const PROVIDER_LABELS = new Map(
  PROVIDER_OPTIONS.map((option) => [option.token, option.label]),
);

export function normalizeProviderToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

export function providerLabelFromToken(token: string) {
  return PROVIDER_LABELS.get(normalizeProviderToken(token)) ?? token;
}
