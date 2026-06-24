#!/usr/bin/env bun
/**
 * Smoke-test the distribution tarball: pack, install locally in a temp dir, sanity-check CLI + API health.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { $ } from 'bun';
import {
  installedPackagePath,
  packTarballFileName,
  readDistributionPackage,
} from './lib/package.ts';
import {
  assertDistributionReadme,
  assertDistManifestVersion,
  assertPackagedApiBinaries,
  assertPackagedWebNext,
  assertPackManifestIncludesReadme,
} from './lib/pack-verify.ts';
import { DIST_PKG_DIR, REPO_ROOT } from './lib/paths.ts';

const skipStart = process.argv.includes('--skip-start');

async function main(): Promise<void> {
  const distribution = readDistributionPackage();
  const expectedTarball = packTarballFileName(distribution.name, distribution.version);

  console.log('[release:smoke] Assembling distribution…');
  const assemble = await $`bun run release:dist`.cwd(REPO_ROOT).nothrow();
  if (assemble.exitCode !== 0) {
    console.error(assemble.stderr.toString());
    process.exit(assemble.exitCode ?? 1);
  }

  const workDir = mkdtempSync(join(tmpdir(), 'ujima-smoke-'));
  const packResult = await $`bun pm pack --destination ${workDir}`
    .cwd(DIST_PKG_DIR)
    .nothrow();
  if (packResult.exitCode !== 0) {
    console.error(packResult.stderr.toString());
    process.exit(packResult.exitCode ?? 1);
  }

  assertDistributionReadme(DIST_PKG_DIR);
  assertDistManifestVersion(DIST_PKG_DIR);

  const packOutput = `${packResult.stdout}\n${packResult.stderr}`;
  assertPackManifestIncludesReadme(packOutput);
  const tarballName =
    packOutput.match(new RegExp(`${expectedTarball.replace('.', '\\.')}`))?.[0] ??
    packOutput.match(/[^\s"]+\.tgz/)?.[0]?.replace(/^npm notice\s+/, '').trim();

  if (!tarballName) {
    console.error(
      `Could not find packed tarball (expected ${expectedTarball} from ${distribution.name}@${distribution.version})`,
    );
    console.error(packOutput);
    process.exit(1);
  }

  const tarballPath = join(workDir, tarballName);
  if (!existsSync(tarballPath)) {
    console.error(`Expected tarball at ${tarballPath}`);
    process.exit(1);
  }

  const installRoot = join(workDir, 'install');
  const cacheDir = join(workDir, 'bun-cache');
  const tmpDir = join(workDir, 'bun-tmp');
  await $`mkdir -p ${installRoot} ${cacheDir} ${tmpDir}`.quiet();
  writeFileSync(
    join(installRoot, 'package.json'),
    `${JSON.stringify({ name: 'ujima-smoke-install', private: true }, null, 2)}\n`,
  );
  await $`bun add --cache-dir ${cacheDir} --cwd ${installRoot} ${tarballPath}`
    .env({ ...process.env, TMPDIR: tmpDir })
    .quiet();

  const ujimaBin = join(installRoot, 'node_modules', '.bin', 'ujima');
  const help = await $`${ujimaBin} --help`.nothrow();
  if (help.exitCode !== 0) {
    console.error('ujima --help failed');
    console.error(help.stderr.toString());
    process.exit(1);
  }
  console.log('[release:smoke] ujima --help OK');

  if (skipStart) {
    console.log('[release:smoke] Skipping runtime start (--skip-start).');
    rmSync(workDir, { recursive: true, force: true });
    return;
  }

  const homeDir = join(workDir, 'ujima-home');
  await $`mkdir -p ${homeDir}`.quiet();

  const pkgRoot = join(installRoot, 'node_modules');
  const packageDir = installedPackagePath(pkgRoot, distribution.name);
  const apiEntry = join(packageDir, 'dist', 'runtime', 'api', 'main.js');
  if (!existsSync(apiEntry)) {
    console.error(`API entry not found: ${apiEntry}`);
    process.exit(1);
  }

  try {
    assertPackagedApiBinaries(packageDir);
    assertPackagedWebNext(packageDir);
  } catch (error) {
    console.error('[release:smoke]', error);
    process.exit(1);
  }
  console.log('[release:smoke] Packaged API has rg/fd binaries');
  console.log('[release:smoke] Web runtime resolves next OK');

  const apiProc = Bun.spawn([process.execPath, apiEntry], {
    env: {
      ...process.env,
      UJIMA_HOME: homeDir,
      UJIMA_PORT: '17511',
      UJIMA_BIND_HOST: '127.0.0.1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let healthy = false;
  for (let i = 0; i < 30; i++) {
    await Bun.sleep(1000);
    try {
      const res = await fetch('http://127.0.0.1:17511/health');
      if (res.ok) {
        healthy = true;
        break;
      }
    } catch {
      // retry
    }
  }

  apiProc.kill();
  await apiProc.exited;

  if (!healthy) {
    console.error('[release:smoke] API /health did not become ready');
    process.exit(1);
  }

  console.log('[release:smoke] API /health OK');
  rmSync(workDir, { recursive: true, force: true });
  console.log('[release:smoke] All checks passed.');
}

await main();
