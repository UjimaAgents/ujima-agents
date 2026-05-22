import { normalizeProviderToken } from "./catalog";

export const OPENAI_CODEX_TOKEN = "openai-codex";
export const OPENAI_OAUTH_LOGIN_PATH = "/api/auth/openai/login";

const OAUTH_PROVIDERS = new Set([OPENAI_CODEX_TOKEN]);

export function isOAuthProvider(name: string) {
  return OAUTH_PROVIDERS.has(normalizeProviderToken(name));
}
