import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildPackagedWebNodePath } from '../../../packages/cli/src/runtime-paths.ts';
import { DIST_PKG_DIR } from './paths.ts';

const MIN_README_BYTES = 500;

export function assertDistributionReadme(distPkgDir = DIST_PKG_DIR): void {
  const readmePath = join(distPkgDir, 'README.md');
  if (!existsSync(readmePath)) {
    throw new Error(`Missing ${readmePath}. Run: bun run release:dist`);
  }
  const bytes = readFileSync(readmePath).byteLength;
  if (bytes < MIN_README_BYTES) {
    throw new Error(`README too small (${bytes} bytes) — npm page will look empty.`);
  }
}

export function assertPackManifestIncludesReadme(packLog: string): void {
  if (!/README\.md/.test(packLog)) {
    throw new Error('README.md not listed in npm pack output');
  }
}

export function assertPackagedWebNext(packageDir: string): void {
  const webRuntimeDir = join(packageDir, 'dist', 'runtime', 'web');
  const webEntry =
    [join(webRuntimeDir, 'apps/web/server.js'), join(webRuntimeDir, 'server.js')].find((p) =>
      existsSync(p),
    ) ?? null;
  if (!webEntry) {
    throw new Error(`Web server entry not found under ${webRuntimeDir}`);
  }

  const nextPkg = join(webRuntimeDir, 'node_modules', 'next', 'package.json');
  if (!existsSync(nextPkg)) {
    throw new Error(`node_modules/next missing after install: ${nextPkg}`);
  }

  const webCwd = webEntry.includes(`${join('apps', 'web')}`)
    ? join(webRuntimeDir, 'apps/web')
    : dirname(webEntry);
  const nodePath = buildPackagedWebNodePath(webRuntimeDir);
  const resolved = spawnSync(process.execPath, ['-e', "require.resolve('next')"], {
    cwd: webCwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: nodePath },
  });
  if (resolved.status !== 0) {
    throw new Error(
      `Web runtime cannot resolve next:\n${resolved.stderr || resolved.stdout}`,
    );
  }
}

export async function waitForHttpOk(
  url: string,
  attempts: number,
  intervalMs: number,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.ok) return true;
      if (res.status < 500) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export function assertNoTransportErrors(stderr: string): void {
  if (/transport: unhandled error/.test(stderr)) {
    throw new Error('ujima start logged transport: unhandled error — see stderr above');
  }
}

export async function assertBootstrapEndpoints(options: {
  apiPort: string;
  webPort: string;
  bearerToken: string;
}): Promise<void> {
  const apiRes = await fetch(`http://127.0.0.1:${options.apiPort}/api/bootstrap`, {
    headers: { authorization: `Bearer ${options.bearerToken}` },
  });
  if (apiRes.status >= 500) {
    const body = await apiRes.text();
    throw new Error(`API /api/bootstrap returned ${apiRes.status}: ${body}`);
  }

  const webRes = await fetch(`http://127.0.0.1:${options.webPort}/api/bootstrap`);
  if (webRes.status >= 500) {
    const body = await webRes.text();
    throw new Error(`Web /api/bootstrap returned ${webRes.status}: ${body}`);
  }
}
