#!/usr/bin/env bun
/**
 * End-to-end test: pack tarball, install locally in a temp dir, run `ujima start`, probe API + web.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { $ } from 'bun';
import {
  installedPackagePath,
  packTarballFileName,
  readDistributionPackage,
} from './lib/package.ts';
import {
  assertBootstrapEndpoints,
  assertDistManifestVersion,
  assertNoTransportErrors,
  waitForHttpOk,
} from './lib/pack-verify.ts';
import { DIST_PKG_DIR, REPO_ROOT } from './lib/paths.ts';

const API_PORT = '17621';
const WEB_PORT = '17622';

async function main(): Promise<void> {
  const distribution = readDistributionPackage();
  const expectedTarball = packTarballFileName(distribution.name, distribution.version);

  if (!existsSync(join(DIST_PKG_DIR, 'dist', 'cli.js'))) {
    console.error('[release:e2e] Missing dist — run: bun run release:dist');
    process.exit(1);
  }
  assertDistManifestVersion(DIST_PKG_DIR);

  const workDir = mkdtempSync(join(tmpdir(), 'ujima-e2e-'));
  console.log(`[release:e2e] Work dir: ${workDir}`);

  const packResult = await $`bun pm pack --destination ${workDir} --quiet`
    .cwd(DIST_PKG_DIR)
    .nothrow();
  if (packResult.exitCode !== 0) {
    console.error(packResult.stderr.toString());
    process.exit(packResult.exitCode ?? 1);
  }

  const packedTarball = packResult.stdout.toString().trim();
  if (!packedTarball) {
    console.error(`[release:e2e] Could not find tarball (expected ${expectedTarball})`);
    process.exit(1);
  }

  const tarballPath = packedTarball.startsWith('/') ? packedTarball : join(workDir, packedTarball);
  const tarballName = basename(tarballPath);
  const installRoot = join(workDir, 'install');
  const cacheDir = join(workDir, 'bun-cache');
  const tmpDir = join(workDir, 'bun-tmp');
  await $`mkdir -p ${installRoot} ${cacheDir} ${tmpDir}`.quiet();
  writeFileSync(
    join(installRoot, 'package.json'),
    `${JSON.stringify({ name: 'ujima-e2e-install', private: true }, null, 2)}\n`,
  );
  console.log(`[release:e2e] Installing ${tarballName} with bun…`);
  const install = await $`bun add --cache-dir ${cacheDir} --cwd ${installRoot} ${tarballPath}`
    .env({ ...process.env, TMPDIR: tmpDir })
    .nothrow();
  if (install.exitCode !== 0) {
    console.error(install.stderr.toString());
    process.exit(install.exitCode ?? 1);
  }

  const ujimaBin = join(installRoot, 'node_modules', '.bin', 'ujima');
  const homeDir = join(workDir, 'ujima-home');
  await $`mkdir -p ${homeDir}`.quiet();

  const pkgRoot = join(installRoot, 'node_modules');
  const packageDir = installedPackagePath(pkgRoot, distribution.name);
  const webRuntimeDir = join(packageDir, 'dist', 'runtime', 'web');
  const nextPkg = join(webRuntimeDir, 'node_modules', 'next', 'package.json');
  if (!existsSync(nextPkg)) {
    console.error(`[release:e2e] node_modules/next missing in installed package: ${nextPkg}`);
    process.exit(1);
  }
  console.log('[release:e2e] Packaged web has node_modules/next');

  console.log('[release:e2e] Starting ujima start (API + web)…');
  const proc = Bun.spawn([ujimaBin, 'start'], {
    env: {
      ...process.env,
      UJIMA_HOME: homeDir,
      UJIMA_PORT: API_PORT,
      UJIMA_BIND_HOST: '127.0.0.1',
      WEB_PORT,
      WEB_HOST: '127.0.0.1',
      PATH: `${join(installRoot, 'bin')}:${process.env.PATH ?? ''}`,
      UJIMA_DEV: '1',
      UJIMA_TELEGRAM_POLLING: '0',
    },
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: workDir,
  });

  const token = await Bun.file(join(homeDir, 'token')).text().catch(() => '');
  const apiOk = await waitForHttpOk(`http://127.0.0.1:${API_PORT}/health`, 45, 1000);
  const webOk = await waitForHttpOk(`http://127.0.0.1:${WEB_PORT}/`, 45, 1000);

  proc.kill('SIGTERM');
  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  const stdout = await new Response(proc.stdout).text();

  if (token.trim()) {
    try {
      await assertBootstrapEndpoints({
        apiPort: API_PORT,
        webPort: WEB_PORT,
        bearerToken: token.trim(),
      });
      console.log('[release:e2e] Bootstrap endpoints OK (no 500)');
    } catch (error) {
      console.error('[release:e2e] Bootstrap check failed:', error);
      console.error('--- stderr ---\n', stderr.slice(-4000));
      rmSync(workDir, { recursive: true, force: true });
      process.exit(1);
    }
  }

  try {
    await assertNoTransportErrors(stderr);
  } catch (error) {
    console.error('[release:e2e]', error);
    console.error('--- stderr ---\n', stderr.slice(-4000));
    rmSync(workDir, { recursive: true, force: true });
    process.exit(1);
  }

  if (!apiOk) {
    console.error('[release:e2e] API /health did not become ready');
    console.error('--- stdout ---\n', stdout.slice(-4000));
    console.error('--- stderr ---\n', stderr.slice(-4000));
    rmSync(workDir, { recursive: true, force: true });
    process.exit(1);
  }
  console.log('[release:e2e] API /health OK');

  if (!webOk) {
    console.error('[release:e2e] Web UI did not respond');
    console.error('--- stdout ---\n', stdout.slice(-4000));
    console.error('--- stderr ---\n', stderr.slice(-4000));
    rmSync(workDir, { recursive: true, force: true });
    process.exit(1);
  }
  console.log('[release:e2e] Web UI HTTP OK');

  console.log(`[release:e2e] ujima start exited with code ${exitCode}`);
  rmSync(workDir, { recursive: true, force: true });
  console.log('[release:e2e] All checks passed.');
}

await main();
