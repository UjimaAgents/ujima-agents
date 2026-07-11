import { isCodexProvider, isOpenAIProvider, isClaudeCodeProvider, type ProviderAuthModeUI } from "./catalog";

type ProviderAuthMode = ProviderAuthModeUI | "chatgpt";

export function credentialStatusLabel(providerName: string, hasKey: boolean, authMode?: ProviderAuthMode) {
  if (isClaudeCodeProvider(providerName) || authMode === "claude-code") {
    return hasKey ? "Local Claude Code login" : "Needs Claude Code login";
  }
  if (isCodexProvider(providerName) || authMode === "codex" || authMode === "chatgpt") {
    return hasKey ? "Local Codex login" : "Needs Codex login";
  }
  if (isOpenAIProvider(providerName)) {
    return hasKey ? "API key configured" : "Not configured";
  }
  return hasKey ? "API key configured" : "Not configured";
}
