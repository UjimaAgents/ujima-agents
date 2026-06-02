#!/usr/bin/env bun
// Mint a license token for an approved waitlist user.
//
// Reads the Ed25519 private key from $UJIMA_SIGNING_KEY (or
// ~/.ujima/license-signing.key by default), signs a fresh payload
// offline, and POSTs the licenseId to the ops Worker so revocation
// can find it later.
//
// Usage:
//   bun scripts/license/mint.ts \
//     --email alice@example.com \
//     --tier beta \
//     --notes "waitlist-2026-06" \
//     --worker https://ujima-license-ops.<your>.workers.dev
//
// Prints the signed token to stdout — copy/paste into your email.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sign, randomBytes } from 'node:crypto';

interface Args {
  email: string;
  tier?: string;
  notes?: string;
  worker: string;
  expiresInDays?: number;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`mint: missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case '--email': out.email = next(); break;
      case '--tier': out.tier = next(); break;
      case '--notes': out.notes = next(); break;
      case '--worker': out.worker = next(); break;
      case '--expires-in-days': out.expiresInDays = Number(next()); break;
      default: throw new Error(`mint: unknown argument "${arg}"`);
    }
  }
  if (!out.email) throw new Error('mint: --email is required');
  if (!out.worker) throw new Error('mint: --worker is required');
  return out as Args;
}

function loadPrivateKeyPem(): string {
  const path = process.env.UJIMA_SIGNING_KEY ?? join(homedir(), '.ujima', 'license-signing.key');
  return readFileSync(path, 'utf8');
}

function newLicenseId(): string {
  // 8 random bytes (16 hex chars) is plenty of entropy for a registry
  // that'll hold thousands of records and still be readable in an email.
  return `LIC-${randomBytes(8).toString('hex').toUpperCase()}`;
}

async function registerWithWorker(args: Args, licenseId: string): Promise<void> {
  const adminToken = process.env.UJIMA_ADMIN_TOKEN;
  if (!adminToken) {
    throw new Error('mint: UJIMA_ADMIN_TOKEN is required to register with the Worker');
  }
  const res = await fetch(`${args.worker.replace(/\/$/, '')}/licenses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      licenseId,
      subjectEmail: args.email,
      tier: args.tier,
      notes: args.notes,
    }),
  });
  if (!res.ok) {
    throw new Error(`mint: Worker registration failed (${res.status}): ${await res.text()}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const privPem = loadPrivateKeyPem();
  const licenseId = newLicenseId();
  const now = new Date();
  const payload: Record<string, unknown> = {
    licenseId,
    subjectEmail: args.email,
    issuedAt: now.toISOString(),
  };
  if (args.tier) payload.tier = args.tier;
  if (args.expiresInDays !== undefined && Number.isFinite(args.expiresInDays)) {
    payload.expiresAt = new Date(now.getTime() + args.expiresInDays * 86400_000).toISOString();
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = sign(null, Buffer.from(payloadB64, 'utf8'), privPem);
  const token = `${payloadB64}.${Buffer.from(signature).toString('base64url')}`;
  await registerWithWorker(args, licenseId);
  process.stdout.write(`${token}\n`);
  process.stderr.write(
    `\nMinted ${licenseId} for ${args.email}` +
      `${args.tier ? ` (tier=${args.tier})` : ''}` +
      `${payload.expiresAt ? ` expires ${payload.expiresAt as string}` : ''}\n` +
      `Email the token above to the user.\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`mint failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
