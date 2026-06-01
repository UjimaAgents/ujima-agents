import { createPublicKey, verify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { SIGNING_PUBLIC_KEY_SPKI_BASE64 } from './keypair.js';
import { isRevoked, refreshRevocations } from './revocation.js';

export interface LicensePayload {
  licenseId: string;
  subjectEmail: string;
  tier?: string;
  issuedAt: string;
  expiresAt?: string;
}

export interface LicenseToken {
  payload: LicensePayload;
  signatureB64: string;
}

export interface VerifyOk {
  ok: true;
  payload: LicensePayload;
}

export interface VerifyFail {
  ok: false;
  reason:
    | 'malformed'
    | 'bad-signature'
    | 'expired'
    | 'revoked'
    | 'no-license';
  detail?: string;
}

export type VerifyResult = VerifyOk | VerifyFail;

export interface LicenseState {
  token: string;
  payload: LicensePayload;
  activatedAt: string;
}

// Token wire format: base64url(payload-json) "." base64url(signature).
// Two-part, no header — we don't negotiate algorithms across versions.
export function parseToken(token: string): LicenseToken | null {
  const parts = token.trim().split('.');
  if (parts.length !== 2) return null;
  const [payloadPart, signaturePart] = parts;
  if (!payloadPart || !signaturePart) return null;
  try {
    const payloadJson = Buffer.from(payloadPart, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as LicensePayload;
    if (
      typeof payload?.licenseId !== 'string' ||
      typeof payload?.subjectEmail !== 'string' ||
      typeof payload?.issuedAt !== 'string'
    ) {
      return null;
    }
    return { payload, signatureB64: signaturePart };
  } catch {
    return null;
  }
}

function signedBytes(token: LicenseToken): Buffer {
  // Sign over the EXACT base64url payload string so a clock-skewed
  // re-serializer can't change the canonical form between sign and verify.
  const original = Buffer.from(JSON.stringify(token.payload), 'utf8').toString('base64url');
  return Buffer.from(original, 'utf8');
}

// `publicKeySpkiBase64` is a test seam — production always uses the
// embedded value. The override lets tests sign with a throwaway pair
// and verify against the matching public half without shipping a
// private key in the repo.
export function verifyToken(
  token: string,
  now: Date = new Date(),
  publicKeySpkiBase64: string = SIGNING_PUBLIC_KEY_SPKI_BASE64,
): VerifyResult {
  const parsed = parseToken(token);
  if (!parsed) return { ok: false, reason: 'malformed' };
  const pubDer = Buffer.from(publicKeySpkiBase64, 'base64');
  const pub = createPublicKey({ key: pubDer, format: 'der', type: 'spki' });
  const sig = Buffer.from(parsed.signatureB64, 'base64url');
  const valid = verify(null, signedBytes(parsed), pub, sig);
  if (!valid) return { ok: false, reason: 'bad-signature' };
  if (parsed.payload.expiresAt) {
    const exp = Date.parse(parsed.payload.expiresAt);
    if (Number.isFinite(exp) && exp < now.getTime()) {
      return { ok: false, reason: 'expired' };
    }
  }
  return { ok: true, payload: parsed.payload };
}

export function resolveLicenseHome(): string {
  const fromEnv = process.env.UJIMA_HOME;
  return fromEnv && fromEnv.trim() !== '' ? fromEnv : join(homedir(), '.ujima');
}

function licensePath(): string {
  return join(resolveLicenseHome(), 'license.json');
}

export function loadLocalLicense(): LicenseState | null {
  try {
    const raw = readFileSync(licensePath(), 'utf8');
    const parsed = JSON.parse(raw) as LicenseState;
    if (
      typeof parsed?.token !== 'string' ||
      typeof parsed?.activatedAt !== 'string' ||
      !parsed?.payload
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeLocalLicense(state: LicenseState): void {
  const path = licensePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), { mode: 0o600 });
}

export function clearLocalLicense(): void {
  try {
    writeFileSync(licensePath(), '');
  } catch {
    // best-effort
  }
}

export interface ActivateOptions {
  now?: Date;
  // Override for tests; production reads from network with caching.
  revokedIds?: Set<string>;
  // Test seam — see verifyToken's matching parameter.
  publicKeySpkiBase64?: string;
}

export function activate(token: string, options: ActivateOptions = {}): VerifyResult {
  const now = options.now ?? new Date();
  const verified = verifyToken(token, now, options.publicKeySpkiBase64);
  if (!verified.ok) return verified;
  // Always consult the local revocation cache so a token revoked
  // before activation can't be written to disk. Tests can still pass
  // an explicit `revokedIds` override to force the path without
  // populating the cache. Callers that want the freshest possible
  // answer should `await refreshRevocations()` first.
  const inExplicit =
    options.revokedIds?.has(verified.payload.licenseId) ?? false;
  if (inExplicit || isRevoked(verified.payload.licenseId)) {
    return { ok: false, reason: 'revoked', detail: verified.payload.licenseId };
  }
  writeLocalLicense({
    token,
    payload: verified.payload,
    activatedAt: now.toISOString(),
  });
  return verified;
}

// Pure-sync helper: verify the signature, expiry, and the local
// revocation cache in one shot. Callers are responsible for any
// freshness work (refreshRevocations) before invoking this so the
// cache reflects the latest feed. Single source of truth for the
// "is this token currently good?" question — used by the daemon
// startup check, the init fast path, and `ujima license status`,
// so the three can't drift on which checks they enforce.
export function verifyAndCheckRevocation(
  token: string,
  now: Date = new Date(),
  publicKeySpkiBase64?: string,
): VerifyResult {
  const verified = verifyToken(token, now, publicKeySpkiBase64);
  if (!verified.ok) return verified;
  if (isRevoked(verified.payload.licenseId)) {
    return { ok: false, reason: 'revoked', detail: verified.payload.licenseId };
  }
  return verified;
}

// Daemon/CLI startup check. Returns ok when:
//   - dev mode (running from the monorepo OR UJIMA_DEV=1)
//   - a locally stored license verifies AND isn't on the revoked list
// Otherwise returns a fail with a `reason` callers can render. The
// revoked check is best-effort: if the cache + network both fail, we
// don't punish the operator (the existence of a valid token is the
// authoritative signal, revocation is the optional cherry on top).
export interface CheckOptions {
  now?: Date;
  // Disable network refresh (tests, CI). When true, only the local
  // revoked-cache is consulted; missing cache means "assume not revoked".
  offlineOnly?: boolean;
}

export async function checkLicenseForStartup(
  options: CheckOptions = {},
): Promise<VerifyResult> {
  if (isDevMode()) {
    return {
      ok: true,
      payload: {
        licenseId: 'dev-mode',
        subjectEmail: 'dev@localhost',
        issuedAt: new Date(0).toISOString(),
      },
    };
  }
  const state = loadLocalLicense();
  if (!state) return { ok: false, reason: 'no-license' };
  if (!options.offlineOnly) {
    // Best-effort daily refresh; failure to fetch is non-fatal.
    await refreshRevocations().catch(() => undefined);
  }
  return verifyAndCheckRevocation(state.token, options.now ?? new Date());
}

// Dev-mode detection: short-circuit license enforcement when:
//   - UJIMA_DEV=1 explicitly set, OR
//   - the process is running from inside THIS monorepo (turbo.json
//     AND packages/license/package.json both present at some
//     ancestor).
// The two-marker check matters because contributors run `bun run
// dev:local` without ever installing the published package — forcing
// them to mint a key would be hostile to development. The package.json
// marker pins detection to OUR repo so a user who happens to run
// `ujima` from inside an unrelated Turborepo project doesn't bypass
// the gate by accident.
export function isDevMode(cwd: string = process.cwd()): boolean {
  if (process.env.UJIMA_DEV === '1') return true;
  let dir = resolve(cwd);
  for (;;) {
    if (
      existsSync(join(dir, 'turbo.json')) &&
      existsSync(join(dir, 'packages', 'license', 'package.json'))
    ) {
      return true;
    }
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

export { refreshRevocations, isRevoked, REVOCATION_URL } from './revocation.js';
