import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Monorepo root — keeps standalone output from pulling absolute host paths into the npm tarball. */
const monorepoRoot = join(import.meta.dirname, "../..");

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
  output: process.env.RELEASE === "1" ? "standalone" : undefined,
  productionBrowserSourceMaps: false,
  outputFileTracingRoot: monorepoRoot,
  env: {
    NEXT_PUBLIC_UJIMA_VERSION: readUjimaVersion(),
  },
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
