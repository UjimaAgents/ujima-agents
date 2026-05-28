import { describe, expect, it } from 'vitest';
import { bunFolderToPackageName } from './repair-standalone-node-modules.ts';

describe('bunFolderToPackageName', () => {
  it('maps plain package folders', () => {
    expect(bunFolderToPackageName('next@16.2.4+d84480edb43e4669')).toBe('next');
  });

  it('maps scoped package folders', () => {
    expect(bunFolderToPackageName('@next+env@16.2.4')).toBe('@next/env');
    expect(bunFolderToPackageName('@swc+helpers@0.5.15')).toBe('@swc/helpers');
  });
});
