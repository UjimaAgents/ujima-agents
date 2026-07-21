import { existsSync } from 'node:fs';
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
    // Claude Code stores credentials in ~/.claude/ after `claude auth login`
    const claudeDir = resolveClaudeHome();
    return existsSync(claudeDir);
  } catch {
    return false;
  }
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
