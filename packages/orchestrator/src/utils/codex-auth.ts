import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

interface CodexAuthFile {
  auth_mode?: unknown;
  OPENAI_API_KEY?: unknown;
  tokens?: {
    access_token?: unknown;
  };
}

export function isCodexAuthMode(value: unknown): value is 'chatgpt' {
  return value === 'chatgpt';
}

export const CODEX_SESSION_MARKER = 'codex-session';

function resolveCodexHome(): string {
  const fromEnv = process.env.CODEX_HOME;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
  return join(homedir(), '.codex');
}

function readCodexAuthFile(): CodexAuthFile | null {
  try {
    return JSON.parse(readFileSync(join(resolveCodexHome(), 'auth.json'), 'utf8')) as CodexAuthFile;
  } catch {
    return null;
  }
}

export function readCodexAccessToken(): string | null {
  const auth = readCodexAuthFile();
  if (!auth) return null;

  const token = auth.tokens?.access_token;
  if (typeof token === 'string' && token.trim()) return token.trim();

  const apiKey = auth.OPENAI_API_KEY;
  if (typeof apiKey === 'string' && apiKey.trim()) return apiKey.trim();

  return null;
}

export function hasCodexAccessToken(): boolean {
  return readCodexAccessToken() !== null;
}

export function resolveOpenAIAccessToken(params: {
  providerName: string;
  authMode?: unknown;
  storedCredential?: string | null;
}): string | null {
  if (isCodexAuthMode(params.authMode) || params.storedCredential === CODEX_SESSION_MARKER) {
    return readCodexAccessToken();
  }

  const stored = params.storedCredential?.trim();
  if (stored) return stored;

  if (params.providerName === 'openai-codex') {
    return readCodexAccessToken();
  }

  return null;
}
