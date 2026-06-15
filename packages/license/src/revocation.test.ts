import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  it('throws on force-refresh failure so `ujima license refresh` can surface it', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('upstream broken', { status: 503 }),
    ) as typeof fetch;
    await expect(refreshRevocations(new Date(), { force: true })).rejects.toThrow(/503/);
  });

});
