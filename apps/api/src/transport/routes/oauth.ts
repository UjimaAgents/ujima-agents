import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';

interface CodexLoginSession {
  loginId: string;
  deviceAuthId: string;
  verificationUrl: string;
  userCode: string;
  status: 'pending' | 'completed' | 'failed' | 'timeout';
  error?: string;
  lastUpdated: number;
  expiresAt: number;
  intervalMs: number;
}

const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_AUTH_ISSUER = 'https://auth.openai.com';
const DEVICE_VERIFICATION_URL = `${OPENAI_AUTH_ISSUER}/codex/device`;
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000;
const activeLoginSessions = new Map<string, CodexLoginSession>();

function resolveCodexHome(): string {
  return process.env.CODEX_HOME?.trim() || join(homedir(), '.codex');
}

// Cleanup interval to avoid leaking processes
setInterval(() => {
  const now = Date.now();
  for (const [loginId, session] of activeLoginSessions.entries()) {
    if (now > session.expiresAt || now - session.lastUpdated > 10 * 60 * 1000) {
      session.status = 'timeout';
      activeLoginSessions.delete(loginId);
    }
  }
}, 60 * 1000);

async function startCodexLogin(): Promise<{ loginId: string; verificationUrl: string; userCode: string }> {
  const response = await fetch(`${OPENAI_AUTH_ISSUER}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'ujima/0.0.1',
    },
    body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
  });
  if (!response.ok) throw new Error(`Failed to start ChatGPT device login: ${response.status}`);

  const body = await response.json() as {
    device_auth_id?: string;
    user_code?: string;
    interval?: string | number;
    expires_in?: number;
  };
  if (!body.device_auth_id || !body.user_code) throw new Error('Invalid ChatGPT device login response');

  const loginId = randomUUID();
  const session: CodexLoginSession = {
    loginId,
    deviceAuthId: body.device_auth_id,
    verificationUrl: DEVICE_VERIFICATION_URL,
    userCode: body.user_code,
    status: 'pending',
    lastUpdated: Date.now(),
    expiresAt: Date.now() + (body.expires_in ?? 600) * 1000,
    intervalMs: Math.max(Number(body.interval) || 5, 1) * 1000,
  };
  activeLoginSessions.set(loginId, session);
  void pollCodexLogin(session);
  return { loginId, verificationUrl: session.verificationUrl, userCode: session.userCode };
}

async function pollCodexLogin(session: CodexLoginSession): Promise<void> {
  while (session.status === 'pending' && Date.now() < session.expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, session.intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS));
    if (session.status !== 'pending') return;
    try {
      const response = await fetch(`${OPENAI_AUTH_ISSUER}/api/accounts/deviceauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ujima/0.0.1',
        },
        body: JSON.stringify({
          device_auth_id: session.deviceAuthId,
          user_code: session.userCode,
        }),
      });

      if (response.status === 403 || response.status === 404) continue;
      if (!response.ok) throw new Error(`Device authorization failed: ${response.status}`);

      const device = await response.json() as { authorization_code?: string; code_verifier?: string };
      if (!device.authorization_code || !device.code_verifier) throw new Error('Invalid ChatGPT authorization response');

      const tokens = await exchangeCodexTokens(device.authorization_code, device.code_verifier);
      writeCodexAuth(tokens);
      session.status = 'completed';
      session.lastUpdated = Date.now();
      return;
    } catch (error) {
      session.status = 'failed';
      session.error = error instanceof Error ? error.message : String(error);
      session.lastUpdated = Date.now();
      return;
    }
  }
  if (session.status === 'pending') session.status = 'timeout';
}

async function exchangeCodexTokens(code: string, codeVerifier: string): Promise<CodexTokenResponse> {
  const response = await fetch(`${OPENAI_AUTH_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${OPENAI_AUTH_ISSUER}/deviceauth/callback`,
      client_id: CODEX_CLIENT_ID,
      code_verifier: codeVerifier,
    }).toString(),
  });
  if (!response.ok) throw new Error(`Token exchange failed: ${response.status}`);
  return response.json() as Promise<CodexTokenResponse>;
}

interface CodexTokenResponse {
  id_token?: string;
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

function writeCodexAuth(tokens: CodexTokenResponse): void {
  const path = join(resolveCodexHome(), 'auth.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      id_token: tokens.id_token,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      account_id: extractAccountId(tokens),
    },
  }, null, 2), { mode: 0o600 });
}

function extractAccountId(tokens: CodexTokenResponse): string | undefined {
  return extractAccountIdFromJwt(tokens.id_token) ?? extractAccountIdFromJwt(tokens.access_token);
}

function extractAccountIdFromJwt(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const payload = parts[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      chatgpt_account_id?: string;
      organizations?: { id?: string }[];
      'https://api.openai.com/auth'?: { chatgpt_account_id?: string };
    };
    return claims.chatgpt_account_id ?? claims['https://api.openai.com/auth']?.chatgpt_account_id ?? claims.organizations?.[0]?.id;
  } catch {
    return undefined;
  }
}

function hasClaudeCodeLogin(): boolean {
  try {
    const claudeHome = process.env.CLAUDE_CODE_HOME?.trim() || join(homedir(), '.claude');
    return existsSync(claudeHome);
  } catch {
    return false;
  }
}

export function registerOauthRoutes(_app: FastifyInstance): void {
  const app = _app.withTypeProvider<ZodTypeProvider>();

  app.get('/auth/openai/login', {
    schema: {
      description: 'Show local Codex login status and setup help',
      tags: ['Onboarding'],
    },
  }, async (_req, reply) => {
    const signedIn = hasCodexAccessToken();
    return reply.type('text/html').send(renderLoginHelpHtml(signedIn));
  });

  app.post('/auth/openai/codex/start', {
    schema: {
      description: 'Start Codex device login flow',
      tags: ['Onboarding'],
      response: {
        200: z.object({
          loginId: z.string(),
          verificationUrl: z.string(),
          userCode: z.string(),
        }),
        500: z.object({
          error: z.string(),
        }),
      },
    },
  }, async (req, reply) => {
    try {
      const result = await startCodexLogin();
      return result;
    } catch (err) {
      reply.status(500);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.get('/auth/openai/codex/status', {
    schema: {
      description: 'Check status of Codex login session',
      tags: ['Onboarding'],
      querystring: z.object({
        loginId: z.string(),
      }),
      response: {
        200: z.object({
          status: z.enum(['pending', 'completed', 'failed', 'timeout', 'not_found']),
          error: z.string().optional(),
        }),
      },
    },
  }, async (req) => {
    const { loginId } = req.query;

    if (hasCodexAccessToken()) {
      activeLoginSessions.delete(loginId);
      return { status: 'completed' as const };
    }

    const session = activeLoginSessions.get(loginId);
    if (!session) {
      return { status: 'not_found' as const };
    }

    if (session.status === 'completed' || session.status === 'failed') {
      activeLoginSessions.delete(loginId);
    }

    return {
      status: session.status,
      error: session.error,
    };
  });

  app.get('/auth/anthropic/claude-code/status', {
    schema: {
      description: 'Check if Claude Code is logged in (detects ~/.claude/ directory)',
      tags: ['Onboarding'],
      response: {
        200: z.object({
          status: z.enum(['connected', 'not_connected']),
        }),
      },
    },
  }, async () => {
    if (hasClaudeCodeLogin()) {
      return { status: 'connected' as const };
    }
    return { status: 'not_connected' as const };
  });

  app.get('/auth/anthropic/claude-code/login', {
    schema: {
      description: 'Show Claude Code login help page',
      tags: ['Onboarding'],
    },
  }, async (_req, reply) => {
    const signedIn = hasClaudeCodeLogin();
    return reply.type('text/html').send(renderClaudeCodeLoginHelp(signedIn));
  });
}

function renderClaudeCodeLoginHelp(signedIn: boolean): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Claude Code login</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fafafa; color: #18181b; }
    main { max-width: 32rem; padding: 2rem; }
    h1 { margin: 0 0 0.75rem; font-size: 1.5rem; }
    p { margin: 0.5rem 0; line-height: 1.5; color: #3f3f46; }
    code { background: #f4f4f5; padding: 0.1rem 0.35rem; border-radius: 0.35rem; }
    a { color: #7c3aed; }
    .status { padding: 0.75rem 1rem; border-radius: 0.5rem; margin-bottom: 1rem; }
    .status.connected { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
    .status.not-connected { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
  </style>
</head>
<body>
  <main>
    <h1>Claude Code Login</h1>
    ${signedIn
      ? '<div class="status connected">✅ Claude Code is authenticated. You can close this tab.</div>'
      : `<div class="status not-connected">⚠️ Claude Code is not authenticated.</div>
        <p>Run <code>claude auth login</code> in your terminal to authenticate, then refresh this page.</p>
        <p>After logging in, your Claude Code subscription will be used for API access instead of an API key.</p>`
    }
  </main>
</body>
</html>`;
}

function hasCodexAccessToken(): boolean {
  try {
    const auth = JSON.parse(readFileSync(join(resolveCodexHome(), 'auth.json'), 'utf8')) as {
      tokens?: { access_token?: unknown };
      OPENAI_API_KEY?: unknown;
    };
    return Boolean(
      (typeof auth.tokens?.access_token === 'string' && auth.tokens.access_token.trim()) ||
        (typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.trim()),
    );
  } catch {
    return false;
  }
}

function renderLoginHelpHtml(signedIn: boolean): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Codex login</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fafafa; color: #18181b; }
    main { max-width: 32rem; padding: 2rem; }
    h1 { margin: 0 0 0.75rem; font-size: 1.5rem; }
    p { margin: 0.5rem 0; line-height: 1.5; color: #3f3f46; }
    code { background: #f4f4f5; padding: 0.1rem 0.35rem; border-radius: 0.35rem; }
    a { color: #7c3aed; }
  </style>
</head>
<body>
  <main>
    <h1>${signedIn ? 'Codex login connected' : 'Codex login needed'}</h1>
    <p>${signedIn ? 'Ujima will use the local Codex ChatGPT session on this machine.' : 'Ujima needs the local Codex ChatGPT session first.'}</p>
    <p>Run <code>codex login --device-auth</code> in a terminal, then reload Ujima.</p>
    <p>Confirm status with <code>codex login status</code>.</p>
  </main>
</body>
</html>`;
}
