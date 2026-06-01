import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _cachePathForTests,
  _resetMemoForTests,
  refreshRevocations,
} from './revocation';

interface CacheFile {
  fetchedAt: string;
  ids: string[];
}

describe('refreshRevocations', () => {
  let tmpHome: string;
  const originalHome = process.env.UJIMA_HOME;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'ujima-revocation-test-'));
    process.env.UJIMA_HOME = tmpHome;
    _resetMemoForTests();
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.UJIMA_HOME;
    else process.env.UJIMA_HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  });

  it('writes a fresh cache on successful fetch', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ids: ['LIC-1'] }), { status: 200 }),
    ) as typeof fetch;
    await refreshRevocations();
    const cache = JSON.parse(readFileSync(_cachePathForTests(), 'utf8')) as CacheFile;
    expect(cache.ids).toEqual(['LIC-1']);
    expect(Date.parse(cache.fetchedAt)).toBeGreaterThan(0);
  });

  // Regression for a bot finding: previously the helper wrote
  // fetchedAt=now and ids=existing-or-empty even when the fetch
  // failed, which (a) suppressed retries for 24h after a single
  // network blip and (b) locked in an empty list as "fresh" on
  // the initial offline run.
  it('does NOT write a cache file when the fetch throws and none existed', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as typeof fetch;
    await refreshRevocations();
    expect(existsSync(_cachePathForTests())).toBe(false);
  });

  it('preserves prior cache (does not advance fetchedAt) when the fetch throws', async () => {
    const original: CacheFile = {
      fetchedAt: '2026-05-01T00:00:00.000Z',
      ids: ['LIC-PRIOR'],
    };
    writeFileSync(_cachePathForTests(), JSON.stringify(original));
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as typeof fetch;
    // Use force so the TTL early-return doesn't apply — the only
    // reason to skip the write is now the fetch failure itself.
    await expect(refreshRevocations(new Date(), { force: true })).rejects.toThrow();
    const after = JSON.parse(readFileSync(_cachePathForTests(), 'utf8')) as CacheFile;
    expect(after.fetchedAt).toBe(original.fetchedAt);
    expect(after.ids).toEqual(['LIC-PRIOR']);
  });

  it('throws on force-refresh failure so `ujima license refresh` can surface it', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('upstream broken', { status: 503 }),
    ) as typeof fetch;
    await expect(refreshRevocations(new Date(), { force: true })).rejects.toThrow(/503/);
  });

  it('silently no-ops on best-effort failure (no throw, no cache write)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as typeof fetch;
    // Non-force callers (daemon startup, init pre-flight) want a
    // quiet failure mode so a transient outage doesn't crash the CLI.
    await expect(refreshRevocations()).resolves.toBeUndefined();
    expect(existsSync(_cachePathForTests())).toBe(false);
  });
});
