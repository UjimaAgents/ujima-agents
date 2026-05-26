import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DISTRIBUTION_PKG_JSON } from './paths.ts';

export type DistributionPackage = {
  name: string;
  version: string;
};

export function readDistributionPackage(): DistributionPackage {
  const pkg = JSON.parse(readFileSync(DISTRIBUTION_PKG_JSON, 'utf8')) as {
    name: string;
    version: string;
  };
  return { name: pkg.name, version: pkg.version };
}

/** npm pack filename for a workspace package (e.g. @ujima/distribution → ujima-distribution-1.0.0.tgz). */
export function packTarballFileName(name: string, version: string): string {
  const base = name.replace(/^@/, '').replace(/\//g, '-');
  return `${base}-${version}.tgz`;
}

/** Global/prefix install path under node_modules for the given package name. */
export function installedPackagePath(nodeModulesRoot: string, packageName: string): string {
  if (packageName.startsWith('@')) {
    const slash = packageName.indexOf('/');
    const scope = packageName.slice(0, slash);
    const base = packageName.slice(slash + 1);
    return join(nodeModulesRoot, scope, base);
  }
  return join(nodeModulesRoot, packageName);
}
