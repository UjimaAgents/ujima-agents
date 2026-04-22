import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { TOKEN_FILENAME } from '@ujima/api-schema';
import { join } from 'node:path';

export function tokenPath(homeDir: string): string {
  return join(homeDir, TOKEN_FILENAME);
}

/**
 * Reads an existing bearer token from `$UJIMA_HOME/token`, or generates a new
 * one, writes it at 0600, and returns it. The token is never logged.
 */
export function ensureBearerToken(homeDir: string): string {
  const p = tokenPath(homeDir);
  if (existsSync(p)) {
    const t = readFileSync(p, 'utf8').trim();
    if (t.length >= 32) return t;
  }
  const token = randomBytes(32).toString('hex');
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, token + '\n', 'utf8');
  try {
    chmodSync(p, 0o600);
  } catch {
    // best-effort on platforms that don't support chmod (windows)
  }
  return token;
}
