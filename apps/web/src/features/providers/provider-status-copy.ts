import { isCodexProvider, isOpenAIProvider, type OpenAIAuthMode } from "./catalog";

type ProviderAuthMode = OpenAIAuthMode | "chatgpt";

export function credentialStatusLabel(providerName: string, hasKey: boolean, authMode?: ProviderAuthMode) {
  if (isCodexProvider(providerName) || authMode === "codex" || authMode === "chatgpt") {
    return hasKey ? "Local Codex login" : "Needs Codex login";
  }
  if (isOpenAIProvider(providerName)) {
    return hasKey ? "API key configured" : "Not configured";
  }
  return hasKey ? "API key configured" : "Not configured";
}
