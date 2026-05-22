import { randomBytes, createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

// We use a simple in-memory map to store the code verifier for the duration of the flow.
// Since this is a local daemon for a single user, this is safe and sufficient.
const pkceStore = new Map<string, string>();

const OPENAI_CLIENT_ID = process.env.UJIMA_OPENAI_CLIENT_ID ?? 'app_EMoamEEZ73f0CkXaXp7hrann';
const OAUTH_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OAUTH_SCOPE = 'openid profile email offline_access';

export function registerOauthRoutes(_app: FastifyInstance): void {
  const app = _app.withTypeProvider<ZodTypeProvider>();

  app.get('/auth/openai/login', {
    schema: {
      description: 'Initiate OpenAI OAuth PKCE flow',
      tags: ['Onboarding'],
    },
  }, async (req, reply) => {
    const state = randomBytes(16).toString('hex');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    // Store the verifier mapped by state with a simple expiration (e.g., 10 minutes)
    pkceStore.set(state, codeVerifier);
    setTimeout(() => pkceStore.delete(state), 10 * 60 * 1000);

    const redirectUri = getRedirectUri(req);

    const authUrl = new URL(OAUTH_AUTHORIZE_URL);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', OPENAI_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', OAUTH_SCOPE);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('id_token_add_organizations', 'true');
    authUrl.searchParams.set('codex_cli_simplified_flow', 'true');
    authUrl.searchParams.set('originator', 'ujima');

    return reply.redirect(302, authUrl.toString());
  });

  app.get('/auth/openai/callback', {
    schema: {
      description: 'Callback endpoint for OpenAI OAuth flow',
      tags: ['Onboarding'],
    },
  }, async (req, reply) => {
    const { code, state, error, error_description } = req.query as Record<string, string | undefined>;

    if (error) {
      return reply.type('text/html').send(renderCallbackHtml(null, error_description || error));
    }

    if (!code || !state) {
      return reply.type('text/html').send(renderCallbackHtml(null, 'Missing code or state parameter'));
    }

    const codeVerifier = pkceStore.get(state);
    if (!codeVerifier) {
      return reply.type('text/html').send(renderCallbackHtml(null, 'Invalid or expired state'));
    }
    
    // Clean up
    pkceStore.delete(state);

    try {
      const redirectUri = getRedirectUri(req);
      
      const tokenResponse = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: OPENAI_CLIENT_ID,
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
        }).toString(),
      });

      if (!tokenResponse.ok) {
        const errData = await tokenResponse.text();
        throw new Error(`Token exchange failed: ${tokenResponse.status} ${errData}`);
      }

      const tokenData = await tokenResponse.json() as { access_token: string };
      
      return reply.type('text/html').send(renderCallbackHtml(tokenData.access_token, null));
    } catch (err) {
      return reply.type('text/html').send(renderCallbackHtml(null, err instanceof Error ? err.message : String(err)));
    }
  });
}

function getRedirectUri(req: { protocol: string; headers: { host?: string } }) {
  const host = req.headers.host?.replace(/^127\.0\.0\.1(?=:|$)/, 'localhost') ?? 'localhost';
  return `${req.protocol}://${host}/api/auth/openai/callback`;
}

function renderCallbackHtml(token: string | null, error: string | null) {
  return `
    <!DOCTYPE html>
    <html>
    <head><title>Authentication Callback</title></head>
    <body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background-color: #f4f4f5; margin: 0;">
      <div style="background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); text-align: center;">
        <h2 style="margin-top: 0; color: #18181b;">${error ? 'Authentication Failed' : 'Authentication Successful'}</h2>
        <p style="color: #52525b;">${error ? error : 'Securely transferring token to the application...'}</p>
      </div>
      <script>
        const message = {
          type: 'OAUTH_SUCCESS',
          token: ${token ? JSON.stringify(token) : 'null'},
          error: ${error ? JSON.stringify(error) : 'null'}
        };
        if (window.opener) {
          window.opener.postMessage(message, '*');
          setTimeout(() => window.close(), 1000);
        } else {
          document.body.innerHTML += '<p style="text-align: center; color: #52525b; margin-top: 1rem;">You can close this tab.</p>';
        }
      </script>
    </body>
    </html>
  `;
}
