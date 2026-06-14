import { describe, expect, it } from 'vitest';
import { scanAssetReferences } from './mentions.js';

describe('scanAssetReferences', () => {
  it('recognizes task and culture references', () => {
    expect(scanAssetReferences('@task:Ship%20the%20card @culture:engineering-practices')).toEqual([
      { kind: 'task', path: 'Ship the card' },
      { kind: 'culture', path: 'engineering-practices' },
    ]);
  });

  it('stops at closing markup', () => {
    expect(scanAssetReferences('[@task:Ship-card]')).toEqual([
      { kind: 'task', path: 'Ship-card' },
    ]);
  });
});
