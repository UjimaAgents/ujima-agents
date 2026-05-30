import { describe, expect, it } from 'vitest';
import { slugifyMemberId } from './slugify-member-id.js';

describe('slugifyMemberId', () => {
  it('slugifies display names', () => {
    expect(slugifyMemberId('Frontend Bot')).toBe('frontend-bot');
    expect(slugifyMemberId('  PM  ')).toBe('pm');
  });

  it('returns empty string for non-alphanumeric input', () => {
    expect(slugifyMemberId('!!!')).toBe('');
  });
});
