#!/usr/bin/env bun
/**
 * Verify git tag (or TAG env) matches packages/distribution/package.json version.
 *
 * Usage:
 *   bun run release:check
 *   TAG=v0.1.0 bun run release:check
 */
import { readFileSync } from 'node:fs';
import { $ } from 'bun';
import { DISTRIBUTION_PKG_JSON } from './lib/paths.ts';

function normalizeTag(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

async function resolveTag(): Promise<string | null> {
  const fromEnv = process.env.TAG?.trim();
  if (fromEnv) return fromEnv;

  const result = await $`git describe --tags --exact-match`.quiet().nothrow();
  if (result.exitCode !== 0) return null;
  return result.stdout.toString().trim();
}

const tag = await resolveTag();
if (!tag) {
  console.error(
    'No release tag found. Checkout a tag or set TAG=vX.Y.Z (e.g. TAG=v0.1.0 bun run release:check).',
  );
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(DISTRIBUTION_PKG_JSON, 'utf8')) as { version: string };
const expected = normalizeTag(tag);

if (pkg.version !== expected) {
  console.error(
    `Version mismatch: tag ${tag} → ${expected}, but packages/distribution/package.json is ${pkg.version}`,
  );
  process.exit(1);
}

console.log(`Release check OK: tag ${tag} matches package version ${pkg.version}.`);
