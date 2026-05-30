import { describe, expect, it, vi } from 'vitest';
import { resolveAgentMemberId } from './member-id.js';

describe('resolveAgentMemberId', () => {
  it('returns slugified id when no active collision', () => {
    const repo = { getMember: vi.fn(() => null) };
    expect(resolveAgentMemberId(repo, 'org-1', 'Frontend Bot')).toBe('frontend-bot');
  });

  it('rejects empty slug', () => {
    const repo = { getMember: vi.fn(() => null) };
    expect(() => resolveAgentMemberId(repo, 'org-1', '!!!')).toThrow(/letter or number/);
  });

  it('rejects active agent with same id', () => {
    const repo = {
      getMember: vi.fn(() => ({
        id: 'frontend-bot',
        kind: 'agent',
        retiredAt: undefined,
      })),
    };
    expect(() => resolveAgentMemberId(repo, 'org-1', 'Frontend Bot')).toThrow(/already exists/);
  });

  it('allows slug when only a retired agent holds it', () => {
    const repo = {
      getMember: vi.fn(() => ({
        id: 'frontend-bot',
        kind: 'agent',
        retiredAt: '2020-01-01T00:00:00.000Z',
      })),
    };
    expect(resolveAgentMemberId(repo, 'org-1', 'Frontend Bot')).toBe('frontend-bot');
  });
});
