import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// Operator overrides via env so we can point CLI builds at staging
// without rebuilding. Default falls back to production.
export const REVOCATION_URL =
  process.env.UJIMA_REVOCATION_URL ?? 'https://license.ujima.dev/revoked.json';

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface RevocationCache {
  fetchedAt: string;
  ids: string[];
}

function homeDir(): string {
  const fromEnv = process.env.UJIMA_HOME;
  return fromEnv && fromEnv.trim() !== '' ? fromEnv : join(homedir(), '.ujima');
}

function cachePath(): string {
  return join(homeDir(), 'revoked.json');
}

function readCache(): RevocationCache | null {
  try {
    const raw = readFileSync(cachePath(), 'utf8');
    const parsed = JSON.parse(raw) as RevocationCache;
    if (!Array.isArray(parsed.ids) || typeof parsed.fetchedAt !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(cache: RevocationCache): void {
  const path = cachePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache, null, 2));
}

let memoIds: Set<string> | null = null;
let memoLoadedAt = 0;

function loadIntoMemo(): Set<string> {
  const cache = readCache();
  memoIds = new Set(cache?.ids ?? []);
  memoLoadedAt = Date.now();
  return memoIds;
}

export function isRevoked(licenseId: string): boolean {
  const ids = memoIds ?? loadIntoMemo();
  return ids.has(licenseId);
}

export interface RefreshOptions {
  // Bypass the 24h TTL and force a network fetch. Used by the explicit
  // `ujima license refresh` command, which must always reach the feed —
  // otherwise an operator who just revoked a key can't pull the new
  // list down for up to 24h.
  force?: boolean;
}

export async function refreshRevocations(
  now: Date = new Date(),
  options: RefreshOptions = {},
): Promise<void> {
  const existing = readCache();
  if (!options.force && existing) {
    const age = now.getTime() - Date.parse(existing.fetchedAt);
    if (Number.isFinite(age) && age >= 0 && age < REFRESH_INTERVAL_MS) {
      // Cache fresh; keep memoized view in sync if the file got hot-
      // edited (operator manually nuked it during a session).
      if (!memoIds || Date.now() - memoLoadedAt > 60_000) loadIntoMemo();
      return;
    }
  }
  // Fetch + persist. Failures fall back to the existing cache; we never
  // wipe a known-good list because the network blipped.
  let ids: string[] = existing?.ids ?? [];
  try {
    const res = await fetch(REVOCATION_URL, { headers: { 'user-agent': 'ujima-cli' } });
    if (res.ok) {
      const body = (await res.json()) as { ids?: unknown };
      if (Array.isArray(body.ids)) {
        ids = body.ids.filter((v): v is string => typeof v === 'string');
      }
    }
  } catch {
    // Keep `ids` at the existing value — silent failure is by design.
  }
  writeCache({ fetchedAt: now.toISOString(), ids });
  memoIds = new Set(ids);
  memoLoadedAt = Date.now();
}

// Test seam: clear the in-process memo so the next isRevoked re-reads.
export function _resetMemoForTests(): void {
  memoIds = null;
  memoLoadedAt = 0;
}

// Test seam: also expose the cache path so tests can clean up.
export function _cachePathForTests(): string {
  return cachePath();
}

