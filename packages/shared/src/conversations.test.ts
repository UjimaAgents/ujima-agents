import { describe, expect, it } from 'vitest';
import { resolveChannelMemberIds } from './conversations.js';

describe('resolveChannelMemberIds', () => {
  it('drops ids that are not in the active roster', () => {
    const active = new Set(['a', 'b', 'c']);
    expect(resolveChannelMemberIds(['a', 'retired-1', 'b', 'missing', 'c'], active)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('deduplicates and sorts', () => {
    const active = new Set(['z', 'a']);
    expect(resolveChannelMemberIds(['z', 'a', 'z'], active)).toEqual(['a', 'z']);
  });
});
