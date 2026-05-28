import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertDistributionReadme, assertPackManifestIncludesReadme } from './pack-verify.ts';

describe('pack-verify', () => {
  it('assertDistributionReadme rejects missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ujima-readme-'));
    expect(() => assertDistributionReadme(dir)).toThrow(/Missing/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('assertDistributionReadme rejects tiny readme', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ujima-readme-'));
    writeFileSync(join(dir, 'README.md'), 'hi', 'utf8');
    expect(() => assertDistributionReadme(dir)).toThrow(/too small/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('assertPackManifestIncludesReadme requires README in pack log', () => {
    expect(() => assertPackManifestIncludesReadme('no docs here')).toThrow(/README/);
    expect(() => assertPackManifestIncludesReadme('npm notice 8.7kB README.md')).not.toThrow();
  });
});
