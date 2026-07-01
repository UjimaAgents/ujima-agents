import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  hydrateTracedBunStorePackages,
  materializePackableVendorPackages,
  materializeTopLevelNodeModules,
} from './repair-standalone-node-modules.ts';
import { REPO_ROOT, WEB_VENDOR_DIR } from './paths.ts';
import { formatPruneStats, pruneWebRuntimeNodeModules } from './prune-web-runtime.ts';

/**
 * Prepare Next.js standalone's traced Bun `.bun/` store for npm publish:
 * hydrate package.json-only stubs, materialize top-level node_modules, prune.
 */
export async function prepareTracedStandaloneNodeModules(
  webRuntimeDir: string,
  monorepoRoot = REPO_ROOT,
): Promise<void> {
  const nodeModulesDir = join(webRuntimeDir, 'node_modules');
  const bunStore = join(nodeModulesDir, '.bun');

  if (!existsSync(bunStore)) {
    throw new Error(
      `Missing ${bunStore}. Build apps/web with RELEASE=1 and output: "standalone".`,
    );
  }

  const hydrated = hydrateTracedBunStorePackages(nodeModulesDir, monorepoRoot);
  if (hydrated > 0) {
    console.log(`[release:dist] Hydrated ${hydrated} incomplete traced package(s) from monorepo.`);
  }

  const pruned = pruneWebRuntimeNodeModules(nodeModulesDir);
  console.log(`[release:dist] Pruned traced web runtime: ${formatPruneStats(pruned)}.`);

  // Materialize after prune so top-level copies come from the intact .bun store.
  const materialized = materializeTopLevelNodeModules(nodeModulesDir);
  if (materialized > 0) {
    console.log(`[release:dist] Materialized ${materialized} top-level node_modules package(s).`);
  }

  const vendored = materializePackableVendorPackages(nodeModulesDir, WEB_VENDOR_DIR);
  if (vendored > 0) {
    console.log(`[release:dist] Vendored ${vendored} web runtime package(s).`);
  }
}

/** @deprecated Use prepareTracedStandaloneNodeModules — full npm install bloats the tarball. */
export async function materializeWebStandaloneDependencies(
  webRuntimeDir: string,
): Promise<void> {
  await prepareTracedStandaloneNodeModules(webRuntimeDir);
}
