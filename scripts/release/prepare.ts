#!/usr/bin/env bun
/**
 * Bump packages/distribution version and move CHANGELOG [Unreleased] → [vX.Y.Z].
 *
 * Usage: bun scripts/release/prepare.ts <semver>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { CHANGELOG_PATH, DISTRIBUTION_PKG_JSON } from './lib/paths.ts';

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function usage(): never {
  console.error('Usage: bun run release:prepare <semver>');
  console.error('Example: bun run release:prepare 0.2.0');
  process.exit(1);
}

const version = process.argv[2];
if (!version || process.argv[3]) usage();
if (!semverPattern.test(version)) {
  console.error(`Invalid semver: ${version}`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(DISTRIBUTION_PKG_JSON, 'utf8')) as {
  version: string;
  name: string;
};
const previous = pkg.version;
pkg.version = version;
writeFileSync(DISTRIBUTION_PKG_JSON, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

let changelog = readFileSync(CHANGELOG_PATH, 'utf8');
const unreleasedHeader = '## [Unreleased]';
const unreleasedIdx = changelog.indexOf(unreleasedHeader);
if (unreleasedIdx === -1) {
  console.error(`CHANGELOG.md is missing "${unreleasedHeader}"`);
  process.exit(1);
}

const afterUnreleased = changelog.slice(unreleasedIdx + unreleasedHeader.length);
const nextSectionMatch = afterUnreleased.match(/\n## \[/);
const unreleasedBodyEnd =
  nextSectionMatch?.index !== undefined
    ? unreleasedIdx + unreleasedHeader.length + nextSectionMatch.index
    : changelog.length;

const unreleasedBody = changelog.slice(
  unreleasedIdx + unreleasedHeader.length,
  unreleasedBodyEnd,
);

const newSection = `## [${version}] - ${new Date().toISOString().slice(0, 10)}${unreleasedBody}`;
const updatedChangelog =
  changelog.slice(0, unreleasedIdx) +
  unreleasedHeader +
  '\n\n' +
  newSection +
  changelog.slice(unreleasedBodyEnd);

writeFileSync(CHANGELOG_PATH, updatedChangelog, 'utf8');

console.log(`Prepared release ${version} (was ${previous}).`);
console.log('');
console.log('Next steps:');
console.log(`  git add packages/distribution/package.json CHANGELOG.md`);
console.log(`  git commit -m "chore(release): v${version}"`);
console.log(`  git tag v${version}`);
console.log(`  git push origin main && git push origin v${version}`);
