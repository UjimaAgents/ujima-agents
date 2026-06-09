import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { formatPruneStats, pruneWebRuntimeNodeModules } from './prune-web-runtime.ts';

/**
 * Keep Next.js standalone's traced `.bun/` store (minimal runtime deps).
 * Do not reinstall from package.json — app deps are bundled into `.next/`.
 */
export async function prepareTracedStandaloneNodeModules(
  webRuntimeDir: string,
): Promise<void> {
  const nodeModulesDir = join(webRuntimeDir, 'node_modules');
  const bunStore = join(nodeModulesDir, '.bun');

  if (!existsSync(bunStore)) {
    throw new Error(
      `Missing ${bunStore}. Build apps/web with RELEASE=1 and output: "standalone".`,
    );
  }

  const pruned = pruneWebRuntimeNodeModules(nodeModulesDir);
  console.log(`[release:dist] Pruned traced web runtime: ${formatPruneStats(pruned)}.`);
}

/** @deprecated Use prepareTracedStandaloneNodeModules — full npm install bloats the tarball. */
export async function materializeWebStandaloneDependencies(
  webRuntimeDir: string,
): Promise<void> {
  await prepareTracedStandaloneNodeModules(webRuntimeDir);
}
