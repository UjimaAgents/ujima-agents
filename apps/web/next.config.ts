import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Monorepo root — keeps standalone output from pulling absolute host paths into the npm tarball. */
const appRoot = dirname(fileURLToPath(import.meta.url));
const monorepoRoot = join(appRoot, "../..");
const isReleaseBuild = process.env.RELEASE === "1";

function readUjimaVersion(): string {
  try {
    const pkgPath = join(monorepoRoot, "packages/distribution/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
    if (typeof pkg.version === "string" && pkg.version.trim()) return pkg.version;
  } catch {
    // Standalone npm installs may not ship the monorepo tree.
  }
  return process.env.NEXT_PUBLIC_UJIMA_VERSION?.trim() || "0.0.0-dev";
}

const nextConfig: NextConfig = {
  output: isReleaseBuild ? "standalone" : undefined,
  productionBrowserSourceMaps: false,
  outputFileTracingRoot: monorepoRoot,
  env: {
    NEXT_PUBLIC_UJIMA_VERSION: readUjimaVersion(),
    NEXT_PUBLIC_SITE_BASE_PATH: process.env.SITE_BASE_PATH ?? "",
  },
  // In dev, scope Turbopack to apps/web so the first browser load does not scan the
  // entire monorepo (which can peg CPU/RAM on Windows). Release builds keep the repo root.
  turbopack: {
    root: isReleaseBuild ? monorepoRoot : appRoot,
  },
};

export default nextConfig;
