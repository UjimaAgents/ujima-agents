import { isOAuthProvider } from "./constants";

export function credentialStatusLabel(providerName: string, hasKey: boolean) {
  if (!hasKey) return "Not configured";
  if (isOAuthProvider(providerName)) return "Signed in with OpenAI";
  return "API key configured";
}
