#!/usr/bin/env bun
/**
 * Assemble packages/distribution/dist for npm publish (compiled runtime only).
 */
import {build} from "esbuild";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {join, dirname} from "node:path";
import {createRequire} from "node:module";
import {$} from "bun";
import {bannerCdnUrl} from "./lib/banner-cdn.ts";
import {copyApiBinariesToRuntime} from "./lib/copy-api-binaries.ts";
import {prepareTracedStandaloneNodeModules} from "./lib/materialize-web-deps.ts";
import {
  API_RUNTIME_DIR,
  DIST_OUT_DIR,
  DIST_PKG_DIR,
  BANNER_PATH,
  DISTRIBUTION_PKG_JSON,
  LICENSE_PATH,
  README_PATH,
  REPO_ROOT,
  RUNTIME_DIR,
  WEB_RUNTIME_DIR,
} from "./lib/paths.ts";

const require = createRequire(join(REPO_ROOT, "apps/api/package.json"));

const dryRun = process.argv.includes("--dry-run");

function log(message: string): void {
  console.log(`[release:dist] ${message}`);
}

function removeTree(path: string): void {
  const attempts = process.platform === "win32" ? 8 : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 150);
    }
  }
}

async function copyTree(source: string, destination: string): Promise<void> {
  if (process.platform !== "win32") {
    cpSync(source, destination, { recursive: true, dereference: true });
    return;
  }
  mkdirSync(destination, { recursive: true });
  const result =
    await $`robocopy ${source} ${destination} /E /SL /XJ /R:2 /W:1 /NFL /NDL /NJH /NJS /NP`
      .quiet()
      .nothrow();
  // Robocopy uses non-zero exit codes for successful copy states.
  if ((result.exitCode ?? 16) >= 8) {
    const stderr = result.stderr.toString();
    const stdout = result.stdout.toString();
    console.error(stderr || stdout);
    throw new Error(`robocopy failed for ${source} -> ${destination}`);
  }
}

function ensureCleanDist(): void {
  if (existsSync(DIST_OUT_DIR)) {
    removeTree(DIST_OUT_DIR);
  }
  mkdirSync(RUNTIME_DIR, {recursive: true});
}

async function buildWebStandalone(): Promise<void> {
  log("Building Next.js standalone web (RELEASE=1)…");
  const result = await $`bun run build`
    .cwd(join(REPO_ROOT, "apps/web"))
    .env({
      ...process.env,
      RELEASE: "1",
    })
    .nothrow();
  if (result.exitCode !== 0) {
    console.error(result.stderr.toString());
    process.exit(result.exitCode ?? 1);
  }
}

function copySwaggerUiStatic(): void {
  const swaggerUiPkgJson = require.resolve("@fastify/swagger-ui/package.json");
  const swaggerStatic = join(dirname(swaggerUiPkgJson), "static");
  if (!existsSync(swaggerStatic)) {
    console.error(`Missing @fastify/swagger-ui static dir: ${swaggerStatic}`);
    process.exit(1);
  }
  log("Copying @fastify/swagger-ui static assets…");
  cpSync(swaggerStatic, join(API_RUNTIME_DIR, "static"), {recursive: true});
}

async function bundleApi(): Promise<void> {
  log("Bundling API runtime…");
  mkdirSync(API_RUNTIME_DIR, {recursive: true});
  await build({
    entryPoints: [join(REPO_ROOT, "apps/api/src/main.ts")],
    outfile: join(API_RUNTIME_DIR, "main.js"),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    sourcemap: false,
    minify: true,
    logLevel: "info",
    external: ["better-sqlite3"],
  });
  copySwaggerUiStatic();
  log("Vendoring rg/fd for all platforms and copying into API runtime…");
  await copyApiBinariesToRuntime(API_RUNTIME_DIR);
}

async function copyWebStandalone(): Promise<void> {
  const webRoot = join(REPO_ROOT, "apps/web");
  const standaloneRoot = join(webRoot, ".next/standalone");
  if (!existsSync(standaloneRoot)) {
    console.error(
      `Missing ${standaloneRoot}. Run RELEASE=1 next build in apps/web first.`
    );
    process.exit(1);
  }

  log("Copying Next.js standalone web…");
  await copyTree(standaloneRoot, WEB_RUNTIME_DIR);

  const staticSrc = join(webRoot, ".next/static");
  const staticCandidates = [
    join(WEB_RUNTIME_DIR, ".next/static"),
    join(WEB_RUNTIME_DIR, "apps/web/.next/static"),
  ];
  if (existsSync(staticSrc)) {
    for (const dest of staticCandidates) {
      mkdirSync(dirname(dest), {recursive: true});
      await copyTree(staticSrc, dest);
    }
  }

  const publicSrc = join(webRoot, "public");
  const publicCandidates = [
    join(WEB_RUNTIME_DIR, "public"),
    join(WEB_RUNTIME_DIR, "apps/web/public"),
  ];
  if (existsSync(publicSrc)) {
    for (const dest of publicCandidates) {
      mkdirSync(dirname(dest), {recursive: true});
      await copyTree(publicSrc, dest);
    }
  }

  await prepareWebStandaloneDeps();
}

async function prepareWebStandaloneDeps(): Promise<void> {
  log("Preparing traced web runtime node_modules…");
  try {
    await prepareTracedStandaloneNodeModules(WEB_RUNTIME_DIR);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  log("Web runtime node_modules ready.");
}

async function bundleCli(): Promise<void> {
  log("Bundling CLI…");
  await build({
    entryPoints: [join(REPO_ROOT, "packages/cli/src/cli.ts")],
    outfile: join(DIST_OUT_DIR, "cli.js"),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    sourcemap: false,
    minify: true,
    logLevel: "info",
  });
}

function copyLicense(): void {
  cpSync(LICENSE_PATH, join(DIST_PKG_DIR, "LICENSE"));
}

function copyBannerForPublish(): void {
  if (!existsSync(BANNER_PATH)) {
    console.error(`Missing banner asset: ${BANNER_PATH}`);
    process.exit(1);
  }
  const assetsDir = join(DIST_PKG_DIR, "assets");
  mkdirSync(assetsDir, {recursive: true});
  cpSync(BANNER_PATH, join(assetsDir, "banner.webp"));
  log(`Copied banner.webp for npm (README references ${bannerCdnUrl()}).`);
}

/** npm displays README.md from packages/distribution — not the monorepo root. */
function copyReadmeForPublish(): void {
  const bannerUrl = bannerCdnUrl();

  let readme = readFileSync(README_PATH, "utf8");
  // Public CDN only — private GitHub raw/blob URLs do not render on npm.
  readme = readme.replace(
    /!\[Ujima Agents Banner\]\([^)]+\)/,
    `![Ujima Agents Banner](${bannerUrl})`,
  );
  // Keep ./LICENSE — LICENSE ships in the tarball. Do not rewrite to GitHub while the repo is private.

  writeFileSync(join(DIST_PKG_DIR, "README.md"), readme, "utf8");
  log(`Copied root README for npm (banner → ${bannerUrl}).`);
}

/** Remove stray source maps from the publishable tree (Next chunks, tooling, etc.). */
function stripSourceMaps(dir: string): number {
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      removed += stripSourceMaps(fullPath);
    } else if (entry.name.endsWith(".map") || entry.name.endsWith(".map.gz")) {
      removeTree(fullPath);
      removed += 1;
    }
  }
  return removed;
}

function writeDistManifest(): void {
  const pkg = JSON.parse(
    readFileSync(join(DIST_PKG_DIR, "package.json"), "utf8")
  ) as Record<string, unknown>;
  writeFileSync(
    join(DIST_OUT_DIR, "manifest.json"),
    `${JSON.stringify(
      {
        name: "@ujima/agents",
        workspaceName: pkg.name,
        version: pkg.version,
        builtAt: new Date().toISOString(),
        runtime: {
          api: "runtime/api/main.js",
          web: "runtime/web",
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function main(): Promise<void> {
  if (dryRun) {
    log("--dry-run: validating build pipeline only (no publish).");
  }

  ensureCleanDist();
  log("Bootstrapping workspace builds…");
  const build = await $`bun run build`.cwd(REPO_ROOT).nothrow();
  if (build.exitCode !== 0) {
    console.error(build.stderr.toString());
    process.exit(build.exitCode ?? 1);
  }
  await buildWebStandalone();
  await bundleApi();
  await copyWebStandalone();
  await bundleCli();
  copyLicense();
  copyBannerForPublish();
  copyReadmeForPublish();
  writeDistManifest();

  const mapsRemoved = stripSourceMaps(DIST_OUT_DIR);
  if (mapsRemoved > 0) {
    log(`Removed ${mapsRemoved} source map file(s) from distribution.`);
  }

  log(`Distribution assembled at ${DIST_OUT_DIR}`);
  if (dryRun) {
    log("Dry run complete.");
  }
}

await main();
