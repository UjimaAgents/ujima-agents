#!/usr/bin/env bun
/**
 * Smoke-test the distribution tarball: pack, install globally in a temp dir, sanity-check CLI + API health.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { $ } from 'bun';
import {
  installedPackagePath,
  packTarballFileName,
  readDistributionPackage,
} from './lib/package.ts';
import { buildPackagedWebNodePath } from '../../packages/cli/src/runtime-paths.ts';
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
  const packResult = await $`npm pack --pack-destination ${workDir}`.cwd(DIST_PKG_DIR).nothrow();
  if (packResult.exitCode !== 0) {
    console.error(packResult.stderr.toString());
    process.exit(packResult.exitCode ?? 1);
  }

  const packOutput = packResult.stdout.toString();
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
  await $`mkdir -p ${installRoot}`.quiet();
  await $`npm install -g ${tarballPath} --prefix ${installRoot}`.quiet();

  const ujimaBin = join(installRoot, 'bin', 'ujima');
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

  const pkgRoot = (await $`npm root -g --prefix ${installRoot}`.quiet()).stdout.toString().trim();
  const packageDir = installedPackagePath(pkgRoot, distribution.name);
  const apiEntry = join(packageDir, 'dist', 'runtime', 'api', 'main.js');
  if (!existsSync(apiEntry)) {
    console.error(`API entry not found: ${apiEntry}`);
    process.exit(1);
  }

  const webRuntimeDir = join(packageDir, 'dist', 'runtime', 'web');
  const webEntry =
    [join(webRuntimeDir, 'apps/web/server.js'), join(webRuntimeDir, 'server.js')].find((p) =>
      existsSync(p),
    ) ?? null;
  if (!webEntry) {
    console.error(`Web server entry not found under ${webRuntimeDir}`);
    process.exit(1);
  }
  const webCwd = webEntry.includes(`${join('apps', 'web')}`)
    ? join(webRuntimeDir, 'apps/web')
    : dirname(webEntry);
  const nodePath = buildPackagedWebNodePath(webRuntimeDir);
  const nextResolve = spawnSync(
    process.execPath,
    ['-e', "require.resolve('next')"],
    { cwd: webCwd, encoding: 'utf8', env: { ...process.env, NODE_PATH: nodePath } },
  );
  if (nextResolve.status !== 0) {
    console.error('[release:smoke] Web runtime cannot resolve next:');
    console.error(nextResolve.stderr);
    process.exit(1);
  }
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
