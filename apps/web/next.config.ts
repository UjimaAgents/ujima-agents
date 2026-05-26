import type { NextConfig } from "next";
import { join } from "node:path";

/** Monorepo root — keeps standalone output from pulling absolute host paths into the npm tarball. */
const monorepoRoot = join(import.meta.dirname, "../..");

const nextConfig: NextConfig = {
  output: process.env.RELEASE === "1" ? "standalone" : undefined,
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
