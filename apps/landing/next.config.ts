import type { NextConfig } from "next";
import { join } from "node:path";

const basePath = process.env.SITE_BASE_PATH ?? "";
const monorepoRoot = join(import.meta.dirname, "../..");

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: basePath || undefined,
  productionBrowserSourceMaps: false,
  env: {
    NEXT_PUBLIC_SITE_BASE_PATH: basePath,
  },
  images: {
    unoptimized: true,
  },
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
