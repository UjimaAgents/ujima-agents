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
 * Subscription auth modes surfaced in the UI.
 * - `apikey`       → standard API key
 * - `codex`        → ChatGPT subscription via local Codex login (saved as "openai-codex")
 * - `claude-code`  → Claude Code subscription via local Claude login (saved as "anthropic-claude-code")
 */
export type ProviderAuthModeUI = "apikey" | "codex" | "claude-code";

/** @deprecated Use ProviderAuthModeUI */
export type OpenAIAuthMode = "apikey" | "codex";

/**
 * Resolve the internal provider token from the UI provider + auth mode.
 */
export function resolveInternalProviderToken(
  uiToken: string,
  authMode?: ProviderAuthModeUI,
): string {
  const normalized = normalizeProviderToken(uiToken);
  if (normalized === "openai" && authMode === "codex") return "openai-codex";
  if (normalized === "anthropic" && authMode === "claude-code") return "anthropic-claude-code";
  // Already the subscription token (e.g. saved from an older session)
  if (normalized === "openai-codex") return "openai-codex";
  if (normalized === "anthropic-claude-code") return "anthropic-claude-code";
  return normalized;
}

/**
 * Resolve the UI token from an internal provider token.
 * Maps subscription tokens back to UI tokens so dropdown stays consistent.
 */
export function resolveUiProviderToken(internalToken: string): string {
  const normalized = normalizeProviderToken(internalToken);
  if (normalized === "openai-codex") return "openai";
  if (normalized === "anthropic-claude-code") return "anthropic";
  return normalized;
}

/**
 * Return the auth mode from the internal provider token.
 */
export function resolveAuthMode(internalToken: string): ProviderAuthModeUI | undefined {
  const normalized = normalizeProviderToken(internalToken);
  if (normalized === "openai" || normalized === "openai-codex") {
    return normalized === "openai-codex" ? "codex" : "apikey";
  }
  if (normalized === "anthropic" || normalized === "anthropic-claude-code") {
    return normalized === "anthropic-claude-code" ? "claude-code" : "apikey";
  }
  return undefined;
}

const PROVIDER_LABELS = new Map(
  PROVIDER_OPTIONS.map((option) => [option.token, option.label]),
);
// Internal-only tokens that are not in PROVIDER_OPTIONS but still need labels.
PROVIDER_LABELS.set("openai-codex", "OpenAI Codex");
PROVIDER_LABELS.set("anthropic-claude-code", "Claude Code");

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

/** True for any Anthropic variant (plain API key or Claude Code subscription). */
export function isAnthropicProvider(token: string) {
  const normalized = normalizeProviderToken(token);
  return normalized === "anthropic" || normalized === "anthropic-claude-code";
}

/** True specifically for the Codex subscription path. */
export function isCodexProvider(token: string) {
  return normalizeProviderToken(token) === "openai-codex";
}

/** True specifically for the Claude Code subscription path. */
export function isClaudeCodeProvider(token: string) {
  return normalizeProviderToken(token) === "anthropic-claude-code";
}

/** True for any subscription provider (Codex or Claude Code). */
export function isSubscriptionProvider(token: string) {
  return isCodexProvider(token) || isClaudeCodeProvider(token);
}
