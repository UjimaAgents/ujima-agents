import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function isClaudeCodeAuthMode(value: unknown): value is 'claude-code' {
  return value === 'claude-code';
}

export const CLAUDE_CODE_SESSION_MARKER = 'claude-code-session';

function resolveClaudeHome(): string {
  const fromEnv = process.env.CLAUDE_CODE_HOME;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
  return join(homedir(), '.claude');
}

export function hasClaudeCodeLogin(): boolean {
  try {
    const claudeHome = resolveClaudeHome();
    for (const file of [join(claudeHome, '.credentials.json'), join(claudeHome, 'credentials.json')]) {
      if (!existsSync(file)) continue;
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      if (containsCredentialToken(parsed)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function containsCredentialToken(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  for (const [key, child] of Object.entries(value)) {
    if (/^(access[_-]?token|refresh[_-]?token|token)$/i.test(key) && typeof child === 'string' && child.trim()) {
      return true;
    }
    if (containsCredentialToken(child)) return true;
  }
  return false;
}

export function resolveAnthropicAccessToken(params: {
  providerName: string;
  authMode?: unknown;
  storedCredential?: string | null;
}): string | null {
  if (isClaudeCodeAuthMode(params.authMode) || params.storedCredential === CLAUDE_CODE_SESSION_MARKER) {
    return hasClaudeCodeLogin() ? 'claude-code-session' : null;
  }

  const stored = params.storedCredential?.trim();
  if (stored) return stored;

  if (params.providerName === 'anthropic-claude-code') {
    return hasClaudeCodeLogin() ? 'claude-code-session' : null;
  }

  return null;
}
