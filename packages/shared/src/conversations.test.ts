import { describe, expect, it } from 'vitest';
import { isOneToOneThread, isPrivateTaskThread, resolveChannelMemberIds } from './conversations.js';

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

describe('thread surface classifiers', () => {
  it('treats private task command threads as one-to-one surfaces', () => {
    expect(isPrivateTaskThread('task:d2518425-9d92-4834-ae50-434b8bb02665:p')).toBe(true);
    expect(isOneToOneThread('task:d2518425-9d92-4834-ae50-434b8bb02665:p')).toBe(true);
    expect(isOneToOneThread('task:org:slug')).toBe(false);
  });
});
