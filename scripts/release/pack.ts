#!/usr/bin/env bun
import { existsSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { $ } from 'bun';
import { packTarballFileName, readDistributionPackage } from './lib/package.ts';
import { DIST_PKG_DIR, REPO_ROOT } from './lib/paths.ts';

async function main(): Promise<void> {
  const distribution = readDistributionPackage();
  const expectedTarball = packTarballFileName(distribution.name, distribution.version);
  const tarballPath = join(REPO_ROOT, expectedTarball);

  if (existsSync(tarballPath)) rmSync(tarballPath);

  const result = await $`bun pm pack --destination ${REPO_ROOT} --quiet`
    .cwd(DIST_PKG_DIR)
    .nothrow();
  if (result.exitCode !== 0) {
    console.error(result.stderr.toString());
    process.exit(result.exitCode ?? 1);
  }

  const packed = result.stdout.toString().trim();
  if (basename(packed) !== expectedTarball) {
    console.error(
      `[release:pack] Expected ${expectedTarball} but got ${packed || '(empty)'}`,
    );
    process.exit(1);
  }

}

await main();
