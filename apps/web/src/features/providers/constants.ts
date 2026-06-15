import { isCodexProvider } from "./catalog";

export const OPENAI_CODEX_TOKEN = "openai-codex";
export const OPENAI_CODEX_LOGIN_HELP_PATH = "/api/auth/openai/login";

/** @deprecated Use isCodexProvider from catalog */
export function isCodexLoginProvider(name: string) {
  return isCodexProvider(name);
}
