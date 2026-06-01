import type { NextConfig } from "next";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Monorepo root — keeps standalone output from pulling absolute host paths into the npm tarball. */
const appRoot = dirname(fileURLToPath(import.meta.url));
const monorepoRoot = join(appRoot, "../..");
const isReleaseBuild = process.env.RELEASE === "1";

const nextConfig: NextConfig = {
  output: isReleaseBuild ? "standalone" : undefined,
  productionBrowserSourceMaps: false,
  outputFileTracingRoot: monorepoRoot,
  // In dev, scope Turbopack to apps/web so the first browser load does not scan the
  // entire monorepo (which can peg CPU/RAM on Windows). Release builds keep the repo root.
  turbopack: {
    root: isReleaseBuild ? monorepoRoot : appRoot,
  },
};

export default nextConfig;
