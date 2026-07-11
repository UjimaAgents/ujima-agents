import { isCodexProvider } from "./catalog";

export const OPENAI_CODEX_TOKEN = "openai-codex";
export const ANTHROPIC_CLAUDE_CODE_TOKEN = "anthropic-claude-code";
export const OPENAI_CODEX_LOGIN_HELP_PATH = "/api/auth/openai/login";
export const CLAUDE_CODE_LOGIN_HELP_PATH = "/api/auth/anthropic/claude-code/login";

/** @deprecated Use isCodexProvider from catalog */
export function isCodexLoginProvider(name: string) {
  return isCodexProvider(name);
}
