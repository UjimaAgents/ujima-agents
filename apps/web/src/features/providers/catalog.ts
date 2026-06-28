export interface ProviderCatalogOption {
  label: string;
  token: string;
}

export const PROVIDER_OPTIONS: readonly ProviderCatalogOption[] = [
  { label: "Anthropic", token: "anthropic" },
  { label: "OpenAI", token: "openai" },
  { label: "Google", token: "google" },
  { label: "OpenRouter", token: "openrouter" },
  { label: "Mistral", token: "mistral" },
  { label: "DeepSeek", token: "deepseek" },
  { label: "xAI", token: "xai" },
  { label: "Kimi", token: "kimi" },
  { label: "z.ai", token: "zhipu" },
  { label: "Ollama", token: "ollama" },
] as const;

/**
 * OpenAI auth modes surfaced in the UI.
 * - `apikey`  → standard API key, saved as provider "openai"
 * - `codex`   → ChatGPT subscription via local Codex login, saved as provider "openai-codex"
 */
export type OpenAIAuthMode = "apikey" | "codex";

/**
 * Resolve the internal provider token from the UI provider + auth mode.
 * For all providers other than OpenAI the mode is irrelevant.
 */
export function resolveInternalProviderToken(
  uiToken: string,
  authMode?: OpenAIAuthMode,
): string {
  const normalized = normalizeProviderToken(uiToken);
  if (normalized === "openai" && authMode === "codex") return "openai-codex";
  // Already the codex token (e.g. saved from an older session)
  if (normalized === "openai-codex") return "openai-codex";
  return normalized;
}

/**
 * Resolve the UI token from an internal provider token.
 * Maps "openai-codex" → "openai" so the dropdown selection stays consistent.
 */
export function resolveUiProviderToken(internalToken: string): string {
  const normalized = normalizeProviderToken(internalToken);
  if (normalized === "openai-codex") return "openai";
  return normalized;
}

/**
 * Return the auth mode from the internal provider token.
 */
export function resolveAuthMode(internalToken: string): OpenAIAuthMode | undefined {
  const normalized = normalizeProviderToken(internalToken);
  if (normalized === "openai" || normalized === "openai-codex") {
    return normalized === "openai-codex" ? "codex" : "apikey";
  }
  return undefined;
}

const PROVIDER_LABELS = new Map(
  PROVIDER_OPTIONS.map((option) => [option.token, option.label]),
);
// Internal-only tokens that are not in PROVIDER_OPTIONS but still need labels.
PROVIDER_LABELS.set("openai-codex", "OpenAI Codex");

export function normalizeProviderToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

export function normalizeProviderKey(value: string) {
  const normalized = normalizeProviderToken(value);
  return normalized === "zhipu-ai" || normalized === "z.ai" || normalized === "z-ai" ? "zhipu" : normalized;
}

export function providerLabelFromToken(token: string) {
  const normalized = normalizeProviderToken(token);
  return PROVIDER_LABELS.get(normalized) ?? token;
}

/** True for any OpenAI variant (plain API key or Codex subscription). */
export function isOpenAIProvider(token: string) {
  const normalized = normalizeProviderToken(token);
  return normalized === "openai" || normalized === "openai-codex";
}

/** True specifically for the Codex subscription path. */
export function isCodexProvider(token: string) {
  return normalizeProviderToken(token) === "openai-codex";
}
