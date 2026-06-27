#!/usr/bin/env bun
import { $ } from "bun";
import {
  chmodSync, cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, DIST_OUT_DIR, RUNTIME_DIR } from "./lib/paths.ts";
import { readDistributionPackage } from "./lib/package.ts";

const NODE_VERSION = "22.14.0";

const PLATFORMS: Record<string, Record<string, { node: string; rust: string }>> = {
  darwin: { arm64: { node: "darwin-arm64", rust: "aarch64-apple-darwin" }, x86_64: { node: "darwin-x64", rust: "x86_64-apple-darwin" } },
  linux: { x86_64: { node: "linux-x64", rust: "x86_64-unknown-linux-gnu" }, arm64: { node: "linux-arm64", rust: "aarch64-unknown-linux-gnu" } },
  windows: { x86_64: { node: "win-x64", rust: "x86_64-pc-windows-msvc" }, arm64: { node: "win-arm64", rust: "aarch64-pc-windows-msvc" } },
};

const VENDOR_BIN_DIR = join(REPO_ROOT, "packages/orchestrator/bin");
const STAGING_DIR = join(DIST_OUT_DIR, "platform-staging");
const TARBALLS_DIR = join(DIST_OUT_DIR, "platform-tarballs");

function log(m: string) { console.log("[platform-tarballs] " + m); }

function tripleName(os: string, arch: string): string {
  const m: Record<string, Record<string, string>> = {
    darwin: { arm64: "darwin-arm64", x86_64: "darwin-x64" },
    linux: { x86_64: "linux-x64", arm64: "linux-arm64" },
    windows: { x86_64: "win-x64", arm64: "win-arm64" },
  };
  return m[os]?.[arch] ?? (() => { throw new Error("Unknown " + os + " " + arch); })();
}

async function downloadNode(stagingDir: string, nodeTriple: string) {
  const d = join(stagingDir, "node");
  if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  const isWin = nodeTriple.startsWith("win-");
  const ext = isWin ? "zip" : "tar.gz";
  const url = "https://nodejs.org/dist/v" + NODE_VERSION + "/node-v" + NODE_VERSION + "-" + nodeTriple + "." + ext;
  const archive = join(stagingDir, "node." + ext);
  log("Downloading Node.js " + NODE_VERSION + " for " + nodeTriple + "...");
  const dl = await $`curl -fsSL ${url} -o ${archive}`.nothrow();
  if (dl.exitCode !== 0) throw new Error("Failed to download Node.js from " + url);
  mkdirSync(d, { recursive: true });
  const e = join(stagingDir, "node-v" + NODE_VERSION + "-" + nodeTriple);
  if (isWin) {
    await $`unzip -o ${archive} -d ${stagingDir}`.nothrow();
    if (existsSync(e)) { if (existsSync(join(e, "node.exe"))) cpSync(join(e, "node.exe"), join(d, "node.exe")); rmSync(e, { recursive: true, force: true }); }
  } else {
    await $`tar xzf ${archive} -C ${stagingDir}`.nothrow();
    if (existsSync(e)) {
      for (const sub of ["bin", "lib"]) { const s = join(e, sub); if (existsSync(s)) cpSync(s, join(d, sub), { recursive: true }); }
      chmodSync(join(d, "bin", "node"), 0o755);
      rmSync(e, { recursive: true, force: true });
    }
  }
  rmSync(archive, { force: true });
  log("Node.js vendored at " + d);
}

function copyArtifacts(stagingDir: string, rustTriple: string) {
  const u = join(stagingDir, "ujima");
  mkdirSync(join(u, "cli"), { recursive: true });
  cpSync(join(DIST_OUT_DIR, "cli.js"), join(u, "cli", "cli.js"));
  cpSync(join(DIST_OUT_DIR, "manifest.json"), join(u, "cli", "manifest.json"));
  const api = join(RUNTIME_DIR, "api"); if (existsSync(api)) cpSync(api, join(u, "runtime", "api"), { recursive: true });
  const web = join(RUNTIME_DIR, "web"); if (existsSync(web)) cpSync(web, join(u, "runtime", "web"), { recursive: true });
  const bins = join(u, "bin");
  if (existsSync(VENDOR_BIN_DIR)) {
    mkdirSync(bins, { recursive: true });
    for (const t of ["rg", "fd"]) {
      const td = join(VENDOR_BIN_DIR, t, rustTriple);
      if (existsSync(td)) { const td2 = join(bins, t); mkdirSync(td2, { recursive: true }); cpSync(td, td2, { recursive: true }); }
    }
  }
  const isWin = rustTriple.includes("windows");
  if (isWin) {
    writeFileSync(join(u, "ujima.bat"), "@echo off\r\nset \"UJIMA_HOME=%~dp0\"\r\nset \"PATH=%UJIMA_HOME%node\\bin;%PATH%\"\r\n\"%UJIMA_HOME%node\\bin\\node.exe\" \"%UJIMA_HOME%cli\\cli.js\" %*\r\n");
    writeFileSync(join(u, "ujima.ps1"), "$UJIMA_HOME = $PSScriptRoot\r\n$env:PATH = \"$UJIMA_HOME\\node\\bin;$env:PATH\"\r\n& \"$UJIMA_HOME\\node\\bin\\node.exe\" \"$UJIMA_HOME\\cli\\cli.js\" @args\r\n");
  } else {
    const l = join(u, "ujima");
    writeFileSync(l, "#!/usr/bin/env bash\nset -euo pipefail\nUJIMA_HOME=\"$(cd \"$(dirname \"$0\")\" && pwd)\"\nexport PATH=\"$UJIMA_HOME/node/bin:$PATH\"\nexec \"$UJIMA_HOME/node/bin/node\" \"$UJIMA_HOME/cli/cli.js\" \"$@\"\n");
    chmodSync(l, 0o755);
  }
}

async function installNative(ujimaDir: string, nodeDir: string) {
  const nodeExe = existsSync(join(nodeDir, "bin", "node.exe")) ? join(nodeDir, "bin", "node.exe") : join(nodeDir, "bin", "node");
  if (!existsSync(nodeExe)) return;
  const runtimeDir = join(ujimaDir, "runtime");
  if (!existsSync(runtimeDir)) return;
  mkdirSync(join(runtimeDir, "node_modules"), { recursive: true });
  const npm = join(nodeDir, "lib/node_modules/npm/bin/npm-cli.js");
  if (!existsSync(npm)) { log("npm not found, skipping native install"); return; }
  for (const dep of ["better-sqlite3@^12.9.0", "onnxruntime-node@^1.20.0"]) {
    log("Installing " + dep + "...");
    const r = await $`${nodeExe} ${npm} install ${dep} --no-save --ignore-scripts --prefix ${runtimeDir}`.cwd(runtimeDir).nothrow();
    if (r.exitCode !== 0) console.warn(dep + " failed (" + r.exitCode + "), skipping");
    else log(dep + " installed");
  }
}

async function makeTarball(stagingDir: string, triple: string, version: string) {
  mkdirSync(TARBALLS_DIR, { recursive: true });
  const name = "ujima-" + version + "-" + triple + ".tar.gz";
  const p = join(TARBALLS_DIR, name);
  log("Creating " + name + "...");
  const r = await $`tar czf ${p} -C ${stagingDir} ujima`.nothrow();
  if (r.exitCode !== 0) throw new Error("tar failed for " + name);
  const sha = await $`shasum -a 256 ${p} | cut -d' ' -f1`.nothrow();
  if (sha.exitCode === 0) { writeFileSync(p + ".sha256", sha.stdout.toString().trim()); }
  log("Created " + name + " (" + (statSync(p).size / 1024 / 1024).toFixed(1) + " MB)");
}

async function assemble(os: string, arch: string, version: string) {
  const cfg = PLATFORMS[os]?.[arch];
  if (!cfg) throw new Error("Unsupported: " + os + " " + arch);
  const triple = tripleName(os, arch);
  const sd = join(STAGING_DIR, triple);
  if (existsSync(sd)) rmSync(sd, { recursive: true, force: true });
  mkdirSync(sd, { recursive: true });
  log("Assembling " + triple + "...");
  await downloadNode(sd, cfg.node);
  copyArtifacts(sd, cfg.rust);
  writeFileSync(join(sd, "ujima", "package.json"), JSON.stringify({ name: "ujima-agents", version, private: true, engines: { node: ">=" + NODE_VERSION } }, null, 2) + "\n");
  await installNative(join(sd, "ujima"), join(sd, "node"));
  await makeTarball(sd, triple, version);
  return triple;
}

async function main() {
  const version = readDistributionPackage().version;
  if (!existsSync(DIST_OUT_DIR)) { console.error("Run release:dist first"); process.exit(1); }
  if (!existsSync(VENDOR_BIN_DIR)) { console.error("Run vendor-binaries.sh all first"); process.exit(1); }
  const args = process.argv.slice(2);
  const platforms: [string, string][] = args.length >= 2 ? [[args[0], args[1]]] : [["darwin", "arm64"], ["darwin", "x86_64"], ["linux", "x86_64"], ["linux", "arm64"], ["windows", "x86_64"], ["windows", "arm64"]];
  const results: string[] = [];
  for (const [os, arch] of platforms) {
    try { results.push(await assemble(os, arch, version)); }
    catch (e) { console.error("Failed " + os + " " + arch + ":", e); }
  }
  log("Done. " + results.length + "/" + platforms.length + " tarballs.");
  for (const t of results) log("  ujima-" + version + "-" + t + ".tar.gz");
}

await main();
