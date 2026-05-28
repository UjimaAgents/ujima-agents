import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $ } from 'bun';

/**
 * Replace Bun-traced `.bun/` trees (broken symlinks + stubs after npm pack) with a real
 * npm `node_modules` install for Next standalone runtime dependencies.
 */
export async function materializeWebStandaloneDependencies(
  webRuntimeDir: string,
): Promise<void> {
  const appPkgPath = join(webRuntimeDir, 'apps/web/package.json');
  if (!existsSync(appPkgPath)) {
    throw new Error(`Missing ${appPkgPath}`);
  }

  const appPkg = JSON.parse(readFileSync(appPkgPath, 'utf8')) as {
    dependencies?: Record<string, string>;
  };

  const dependencies: Record<string, string> = {};
  for (const [name, version] of Object.entries(appPkg.dependencies ?? {})) {
    if (name.startsWith('@ujima/')) continue;
    dependencies[name] = version;
  }

  const nodeModulesDir = join(webRuntimeDir, 'node_modules');
  if (existsSync(nodeModulesDir)) {
    rmSync(nodeModulesDir, { recursive: true, force: true });
  }

  const runtimePkg = {
    name: 'ujima-web-runtime',
    private: true,
    dependencies,
  };
  writeFileSync(
    join(webRuntimeDir, 'package.json'),
    `${JSON.stringify(runtimePkg, null, 2)}\n`,
    'utf8',
  );

  const install = await $`npm install --omit=dev --ignore-scripts --no-package-lock`
    .cwd(webRuntimeDir)
    .nothrow();
  if (install.exitCode !== 0) {
    console.error(install.stderr.toString());
    throw new Error('npm install failed for web standalone runtime');
  }

  const nextPkg = join(nodeModulesDir, 'next', 'package.json');
  if (!existsSync(nextPkg)) {
    throw new Error(`Missing ${nextPkg} after materializing web dependencies`);
  }
}
