import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createFileSecretStore } from './secret-store.js';

test('file secret store round-trips values from a temporary home dir', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'ujima-secret-store-'));

  try {
    const store = createFileSecretStore({ homeDir });
    const keyRef = store.write('top-secret');

    expect(store.read(keyRef)).toBe('top-secret');

    store.delete(keyRef);
    expect(store.read(keyRef)).toBeNull();
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
