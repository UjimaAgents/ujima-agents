import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

interface CodexLoginSession {
  child: ReturnType<typeof spawn>;
  loginId: string;
  verificationUrl: string;
  userCode: string;
  status: 'pending' | 'completed' | 'failed' | 'timeout';
  error?: string;
  lastUpdated: number;
}

const activeLoginSessions = new Map<string, CodexLoginSession>();

// Cleanup interval to avoid leaking processes
setInterval(() => {
  const now = Date.now();
  for (const [loginId, session] of activeLoginSessions.entries()) {
    if (now - session.lastUpdated > 5 * 60 * 1000) {
      try {
        session.child.kill('SIGKILL');
      } catch (error) {
        void error;
      }
      activeLoginSessions.delete(loginId);
    }
  }
}, 60 * 1000);

function startCodexLogin(): Promise<{ loginId: string; verificationUrl: string; userCode: string }> {
  return new Promise((resolve, reject) => {
    const home = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex');
    const child = spawn('codex', ['app-server', '--stdio'], {
      env: { ...process.env, CODEX_HOME: home },
    });

    let resolved = false;
    let stdoutBuffer = '';
    let loginIdRef = '';

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { child.kill('SIGKILL'); } catch (error) { void error; }
        reject(new Error('Timeout starting Codex login flow'));
      }
    }, 15000);

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    child.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`Codex App Server closed unexpectedly with code ${code}`));
      } else if (loginIdRef) {
        const session = activeLoginSessions.get(loginIdRef);
        if (session && session.status === 'pending') {
          session.status = 'failed';
          session.error = `Codex App Server closed with code ${code}`;
        }
      }
    });

    child.stdout?.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);

          // 1. Check response to account/login/start
          if (msg.id === 2) {
            if (resolved) continue;
            resolved = true;
            clearTimeout(timeout);
            if (msg.error) {
              try { child.kill('SIGTERM'); } catch (error) { void error; }
              reject(new Error(msg.error.message || 'Failed to start login'));
            } else {
              const { loginId, verificationUrl, userCode } = msg.result || {};
              if (!loginId || !verificationUrl || !userCode) {
                try { child.kill('SIGTERM'); } catch (error) { void error; }
                reject(new Error('Invalid response from Codex App Server'));
              } else {
                loginIdRef = loginId;
                const session: CodexLoginSession = {
                  child,
                  loginId,
                  verificationUrl,
                  userCode,
                  status: 'pending',
                  lastUpdated: Date.now(),
                };
                activeLoginSessions.set(loginId, session);
                resolve({ loginId, verificationUrl, userCode });
              }
            }
          }

          // 2. Check for notifications
          if (msg.method === 'account/login/completed') {
            const { success, error, loginId } = msg.params || {};
            const targetId = loginId || loginIdRef;
            if (targetId) {
              const session = activeLoginSessions.get(targetId);
              if (session) {
                session.status = success ? 'completed' : 'failed';
                if (error) session.error = error;
                session.lastUpdated = Date.now();
                try { child.kill('SIGTERM'); } catch (error) { void error; }
              }
            }
          }
        } catch {
          // ignore parse errors
        }
      }
    });

    // Write initialize request
    child.stdin?.write(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: {
          clientInfo: { name: 'ujima', version: '0.0.1' },
        },
      }) + '\n'
    );

    // Write login start request
    child.stdin?.write(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'account/login/start',
        id: 2,
        params: {
          type: 'chatgptDeviceCode',
        },
      }) + '\n'
    );
  });
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
      const session = activeLoginSessions.get(loginId);
      if (session) {
        try { session.child.kill('SIGTERM'); } catch (error) { void error; }
        activeLoginSessions.delete(loginId);
      }
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
}

function hasCodexAccessToken(): boolean {
  const home = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex');
  try {
    const auth = JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8')) as {
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
