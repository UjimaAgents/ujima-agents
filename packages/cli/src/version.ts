import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findMonorepoRoot } from './runtime-paths.js';

export function compareVersions(v1: string, v2: string): number {
  const parse = (v: string) => {
    const clean = (v.replace(/^v/, '').split('-')[0] as string) || '';
    return clean.split('.').map(Number);
  };

  const p1 = parse(v1);
  const p2 = parse(v2);

  for (let i = 0; i < 3; i++) {
    const n1 = p1[i] ?? 0;
    const n2 = p2[i] ?? 0;
    if (n1 !== n2) return n1 - n2;
  }
  return 0;
}

function tryReadVersion(path: string): string | null {
  try {
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown };
      if (typeof parsed.version === 'string') return parsed.version;
    }
  } catch {
    // Ignore error
  }
  return null;
}

export function getLocalVersion(): string {
  const v1 = tryReadVersion(join(__dirname, 'manifest.json'));
  if (v1) return v1;

  const v2 = tryReadVersion(join(__dirname, '..', 'package.json'));
  if (v2) return v2;

  const root = findMonorepoRoot(__dirname);
  if (root) {
    const v3 = tryReadVersion(join(root, 'packages', 'distribution', 'package.json'));
    if (v3) return v3;

    const v4 = tryReadVersion(join(root, 'package.json'));
    if (v4) return v4;
  }

  return '0.0.0-dev';
}
