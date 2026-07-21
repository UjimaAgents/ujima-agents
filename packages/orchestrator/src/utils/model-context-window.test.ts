import { describe, expect, it } from 'vitest';
import type { Member } from '@ujima/shared';
import { conversationContextWindowTokens } from './model-context-window.js';

describe('conversationContextWindowTokens', () => {
  it('uses explicit member model when team cache is unavailable', () => {
    const member = {
      id: 'Quinn Mason',
      organizationId: 'org-1',
      name: 'Quinn Mason',
      kind: 'agent',
      roleName: 'backend-engineer',
      llm: 'deepseek',
      model: 'deepseek-v4-flash',
      presence: 'online',
    } satisfies Member;

    expect(conversationContextWindowTokens({
      team: null,
      members: [member],
      threadMemberIds: [member.id],
    })).toBe(1_000_000);
  });
});
