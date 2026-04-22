#!/usr/bin/env node
// Inject better-sqlite3 (with its native .node binary) into the packaged .vsix.
// vsce --no-dependencies skips node_modules entirely, but we need
// node_modules/better-sqlite3/ alongside dist/extension.js at runtime so
// require('better-sqlite3') resolves and bindings finds the .node.
// .vsix is a zip; we stage a clean copy and append it.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readlinkSync, rmSync, lstatSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rebuild } from '@electron/rebuild';

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(here, '..');
const vsix = resolve(pluginRoot, 'ujima.vsix');
const stageRoot = resolve(pluginRoot, '.stage');
const stageNodeModules = resolve(stageRoot, 'extension/node_modules');

const PACKAGES = ['better-sqlite3', 'bindings', 'file-uri-to-path'];
const TRIM_BETTER_SQLITE = [
  'build/Debug',
  'build/Release/obj',
  'build/Release/obj.target',
  'build/Release/.deps',
  'build/Release/sqlite3.a',
  'build/Release/test_extension.node',
  'build/binding.Makefile',
  'build/config.gypi',
  'build/gyp-mac-tool',
  'build/Makefile',
  'build/better_sqlite3.target.mk',
  'build/test_extension.target.mk',
  'build/deps',
  'deps',
  'src',
  'docs',
  'test',
  '.github',
];

if (!existsSync(vsix)) {
  console.error(`[bundle-native] missing ${vsix} — run "vsce package" first`);
  process.exit(1);
}

if (existsSync(stageRoot)) rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(stageNodeModules, { recursive: true });

for (const pkg of PACKAGES) {
  const linkPath = resolve(pluginRoot, '../../node_modules', pkg);
  let source = linkPath;
  if (!existsSync(linkPath)) {
    const found = locateInNodeModules(pkg);
    if (!found) {
      console.error(`[bundle-native] could not locate ${pkg} in workspace node_modules`);
      process.exit(1);
    }
    source = found;
  } else if (lstatSync(linkPath).isSymbolicLink()) {
    source = resolve(dirname(linkPath), readlinkSync(linkPath));
  }
  const dest = resolve(stageNodeModules, pkg);
  cpSync(source, dest, { recursive: true, dereference: true });
  console.log(`[bundle-native] staged ${pkg} from ${source}`);
}

const stageBetter = resolve(stageNodeModules, 'better-sqlite3');
const stageExtension = resolve(stageRoot, 'extension');

// @electron/rebuild requires a package.json at buildPath to locate modules.
writeFileSync(
  resolve(stageExtension, 'package.json'),
  JSON.stringify({ name: 'ujima-stage', version: '0.0.0', dependencies: { 'better-sqlite3': '*' } }),
);

// Rebuild better-sqlite3 from source against Electron's Node headers.
// No prebuilts are published for electron-v136, so source build is required.
// Override Electron target via UJIMA_ELECTRON_VERSION env var.
const electronTarget = process.env.UJIMA_ELECTRON_VERSION ?? '37.0.0';
console.log(`[bundle-native] rebuilding better-sqlite3 against electron@${electronTarget}…`);
try {
  await rebuild({
    buildPath: stageExtension,
    electronVersion: electronTarget,
    onlyModules: ['better-sqlite3'],
    force: true,
  });
} catch (err) {
  console.error(
    `[bundle-native] @electron/rebuild failed for electron@${electronTarget}.\n` +
      `Set UJIMA_ELECTRON_VERSION to match the Electron version VS Code ships.`,
  );
  throw err;
}

for (const rel of TRIM_BETTER_SQLITE) {
  const p = resolve(stageBetter, rel);
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

execFileSync(
  'zip',
  ['-r', vsix, ...PACKAGES.map((p) => `extension/node_modules/${p}`)],
  { cwd: stageRoot, stdio: 'inherit' },
);

rmSync(stageRoot, { recursive: true, force: true });
console.log(`[bundle-native] injected ${PACKAGES.join(', ')} → ${vsix}`);

function locateInNodeModules(pkg) {
  const candidates = [
    resolve(pluginRoot, '../../node_modules', pkg),
    resolve(pluginRoot, '../../node_modules/.bun/node_modules', pkg),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
