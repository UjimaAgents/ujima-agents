// ujima-license-ops — Cloudflare Worker that owns the license
// registry. The signing key never lives here; it stays on the
// operator's machine and signs offline. We only persist
// { licenseId → { email, status, granted_at, revoked_at? } } and
// serve the public revoked list.

export interface Env {
  LICENSES: KVNamespace;
  ADMIN_TOKEN: string;
  PUBLIC_REVOCATION_PATH: string;
}

interface LicenseRecord {
  licenseId: string;
  subjectEmail: string;
  tier?: string;
  grantedAt: string;
  revokedAt?: string;
  // Optional caller-supplied note (e.g. "beta-waitlist-2026-06").
  notes?: string;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers ?? {}) },
  });
}

function requireAdmin(req: Request, env: Env): Response | null {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

async function listLicenses(env: Env): Promise<LicenseRecord[]> {
  // KV.list paginates at ~1000 keys/page; we must follow `cursor` until
  // `list_complete` or registry entries past the first page silently
  // disappear from the regenerated revoked.json — the exact bug a bot
  // review flagged, which would have shipped a partial revocation
  // feed once the waitlist grew past a single page.
  const out: LicenseRecord[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await env.LICENSES.list({ prefix: 'lic:', cursor });
    for (const k of page.keys) {
      const value = await env.LICENSES.get<LicenseRecord>(k.name, 'json');
      if (value) out.push(value);
    }
    // KV result is either { list_complete: true } or
    // { list_complete: false, cursor }. We exit on either complete or
    // the (defensively-checked) case of a missing cursor.
    if ('list_complete' in page && page.list_complete) break;
    const nextCursor = (page as { cursor?: string }).cursor;
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  out.sort((a, b) => a.grantedAt.localeCompare(b.grantedAt));
  return out;
}

async function regenerateRevokedJson(env: Env): Promise<{ ids: string[] }> {
  const records = await listLicenses(env);
  const ids = records.filter((r) => Boolean(r.revokedAt)).map((r) => r.licenseId);
  const body = { ids, generatedAt: new Date().toISOString() };
  await env.LICENSES.put('revoked.json', JSON.stringify(body));
  return { ids };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Public, unauthenticated revocation feed.
    if (url.pathname === env.PUBLIC_REVOCATION_PATH && req.method === 'GET') {
      const cached = await env.LICENSES.get('revoked.json');
      if (cached) {
        return new Response(cached, {
          headers: {
            ...JSON_HEADERS,
            // 1h public cache — CLI checks daily anyway, this protects
            // Worker invocation quota under any sudden burst.
            'cache-control': 'public, max-age=3600',
          },
        });
      }
      return json({ ids: [], generatedAt: new Date().toISOString() });
    }

    // Everything below requires the operator bearer token.
    const denied = requireAdmin(req, env);
    if (denied) return denied;

    if (url.pathname === '/licenses' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as Partial<LicenseRecord> | null;
      if (!body?.licenseId || !body?.subjectEmail) {
        return json({ error: 'licenseId and subjectEmail required' }, { status: 400 });
      }
      const record: LicenseRecord = {
        licenseId: body.licenseId,
        subjectEmail: body.subjectEmail,
        tier: body.tier,
        grantedAt: new Date().toISOString(),
        notes: body.notes,
      };
      await env.LICENSES.put(`lic:${record.licenseId}`, JSON.stringify(record));
      return json({ ok: true, record }, { status: 201 });
    }

    if (url.pathname === '/licenses' && req.method === 'GET') {
      return json({ records: await listLicenses(env) });
    }

    const revokeMatch = url.pathname.match(/^\/licenses\/([^/]+)$/);
    if (revokeMatch && req.method === 'DELETE') {
      const id = decodeURIComponent(revokeMatch[1]!);
      const existing = await env.LICENSES.get<LicenseRecord>(`lic:${id}`, 'json');
      if (!existing) return json({ error: 'not found' }, { status: 404 });
      const updated: LicenseRecord = { ...existing, revokedAt: new Date().toISOString() };
      await env.LICENSES.put(`lic:${id}`, JSON.stringify(updated));
      const { ids } = await regenerateRevokedJson(env);
      return json({ ok: true, record: updated, revokedCount: ids.length });
    }

    if (url.pathname === '/licenses/regenerate-revoked' && req.method === 'POST') {
      const { ids } = await regenerateRevokedJson(env);
      return json({ ok: true, revokedCount: ids.length });
    }

    return json({ error: 'not found' }, { status: 404 });
  },
};
