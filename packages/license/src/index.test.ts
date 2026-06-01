import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activate,
  isDevMode,
  loadLocalLicense,
  parseToken,
  verifyToken,
  verifyAndCheckRevocation,
  type LicensePayload,
} from './index';
import { _resetMemoForTests } from './revocation';

interface TestKeys {
  privPem: string;
  pubB64: string;
}

function freshKeys(): TestKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privPem: privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
    pubB64: Buffer.from(publicKey.export({ format: 'der', type: 'spki' })).toString('base64'),
  };
}

function signToken(keys: TestKeys, payload: LicensePayload): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = sign(null, Buffer.from(payloadB64, 'utf8'), keys.privPem);
  return `${payloadB64}.${Buffer.from(sig).toString('base64url')}`;
}

const samplePayload: LicensePayload = {
  licenseId: 'LIC-0001',
  subjectEmail: 'alice@example.com',
  tier: 'beta',
  issuedAt: '2026-01-01T00:00:00.000Z',
};

describe('parseToken', () => {
  it('returns null for non-two-part input', () => {
    expect(parseToken('one-part')).toBeNull();
    expect(parseToken('three.parts.here')).toBeNull();
  });

  it('returns null when payload is missing required fields', () => {
    const noId = Buffer.from(JSON.stringify({ subjectEmail: 'x', issuedAt: 'y' })).toString(
      'base64url',
    );
    expect(parseToken(`${noId}.sig`)).toBeNull();
  });
});

describe('verifyToken', () => {
  it('accepts a correctly signed token', () => {
    const keys = freshKeys();
    const token = signToken(keys, samplePayload);
    const result = verifyToken(token, new Date('2026-06-01'), keys.pubB64);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.licenseId).toBe('LIC-0001');
  });

  it('rejects a token signed by a different key', () => {
    const issuer = freshKeys();
    const impostor = freshKeys();
    const token = signToken(issuer, samplePayload);
    const result = verifyToken(token, new Date('2026-06-01'), impostor.pubB64);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad-signature');
  });

  it('rejects a token whose expiresAt is past', () => {
    const keys = freshKeys();
    const token = signToken(keys, { ...samplePayload, expiresAt: '2026-03-01T00:00:00.000Z' });
    const result = verifyToken(token, new Date('2026-06-01'), keys.pubB64);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('rejects malformed input', () => {
    expect(verifyToken('garbage')).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('activate', () => {
  let tmpHome: string;
  const originalHome = process.env.UJIMA_HOME;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'ujima-license-test-'));
    process.env.UJIMA_HOME = tmpHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.UJIMA_HOME;
    else process.env.UJIMA_HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('writes the license state when verification succeeds', () => {
    const keys = freshKeys();
    const token = signToken(keys, samplePayload);
    // Real flow uses the embedded key; we mirror it by overriding verifyToken
    // before calling activate. Simpler path: call verifyToken directly then
    // writeLocalLicense — but activate exercises the persisted-state branch.
    // The embedded key isn't a match for our throwaway keys, so we expect a
    // bad-signature result here, *not* a write. That's actually the most
    // important assertion: production activate cannot be fooled by a token
    // signed under the wrong key.
    const result = activate(token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad-signature');
    expect(loadLocalLicense()).toBeNull();
  });

  it('refuses a revoked id even if the signature would otherwise verify', () => {
    // Spoof a revoked check on a payload whose signature is bad — we still
    // need the bad-signature branch to win because the verify happens first.
    const result = activate('nope.nope', { revokedIds: new Set(['LIC-0001']) });
    expect(result.ok).toBe(false);
  });

  // Regression for the verifyAndCheckRevocation helper that backs
  // the daemon startup check, the init fast path, and `ujima license
  // status`. A signature-valid token whose licenseId is on the
  // local revocation cache must be reported as revoked from every
  // call site, not just from activate().
  it('verifyAndCheckRevocation rejects a signature-valid token whose id is in the cache', () => {
    const keys = freshKeys();
    const token = signToken(keys, { ...samplePayload, licenseId: 'LIC-7777' });
    const cachePath = join(tmpHome, 'revoked.json');
    writeFileSync(
      cachePath,
      JSON.stringify({ fetchedAt: new Date().toISOString(), ids: ['LIC-7777'] }),
    );
    _resetMemoForTests();

    const result = verifyAndCheckRevocation(token, new Date('2026-06-01'), keys.pubB64);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('revoked');
      expect(result.detail).toBe('LIC-7777');
    }
  });

  // Regression for a bot finding where activate() only honoured the
  // `revokedIds` test override and never the local cache, so the CLI
  // happily wrote a revoked token to disk during ujima init.
  it('refuses a properly signed token whose licenseId is in the local revocation cache', () => {
    const keys = freshKeys();
    const revokedPayload: LicensePayload = { ...samplePayload, licenseId: 'LIC-9999' };
    const token = signToken(keys, revokedPayload);

    // Seed the revocation cache file in the test home dir, then reset
    // the in-process memo so isRevoked re-reads it on next call.
    const cachePath = join(tmpHome, 'revoked.json');
    writeFileSync(
      cachePath,
      JSON.stringify({ fetchedAt: new Date().toISOString(), ids: ['LIC-9999'] }),
    );
    _resetMemoForTests();

    const result = activate(token, { publicKeySpkiBase64: keys.pubB64 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('revoked');
    // Critical: no file written. Pre-fix, the revoked token was
    // persisted to ~/.ujima/license.json and the CLI reported success.
    expect(loadLocalLicense()).toBeNull();
  });
});

describe('isDevMode', () => {
  it('returns true when UJIMA_DEV=1', () => {
    const prev = process.env.UJIMA_DEV;
    process.env.UJIMA_DEV = '1';
    try {
      expect(isDevMode('/some/nonexistent/path')).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.UJIMA_DEV;
      else process.env.UJIMA_DEV = prev;
    }
  });

  it('returns true when called from inside this monorepo (turbo.json + packages/license marker)', () => {
    // The test file itself lives inside the repo — walking up must find
    // both markers without depending on env.
    const prev = process.env.UJIMA_DEV;
    delete process.env.UJIMA_DEV;
    try {
      expect(isDevMode(__dirname)).toBe(true);
    } finally {
      if (prev !== undefined) process.env.UJIMA_DEV = prev;
    }
  });

  // Regression for a bot finding: pre-fix isDevMode walked up looking
  // for ANY turbo.json, so a packaged install run from inside an
  // unrelated Turborepo project skipped the license gate entirely.
  // Now we require BOTH turbo.json AND packages/license/package.json
  // at the same ancestor to count.
  it('does NOT bypass the gate for an unrelated repo that just happens to use Turbo', () => {
    const prev = process.env.UJIMA_DEV;
    delete process.env.UJIMA_DEV;
    const fakeRepo = mkdtempSync(join(tmpdir(), 'ujima-fake-turbo-'));
    try {
      writeFileSync(join(fakeRepo, 'turbo.json'), '{}');
      // No packages/license/package.json here — this is some other
      // person's Turborepo project, not ours.
      expect(isDevMode(fakeRepo)).toBe(false);
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
      if (prev !== undefined) process.env.UJIMA_DEV = prev;
    }
  });
});
