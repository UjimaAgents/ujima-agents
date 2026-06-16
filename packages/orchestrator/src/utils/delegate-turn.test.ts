import { describe, expect, it } from 'vitest';
import {
  DELEGATE_TURN_USER_MESSAGE,
  buildDelegateTurnContextMessages,
  filterDelegateTurnToolSet,
  getDelegateKind,
} from './delegate-turn.js';

describe('DELEGATE_TURN_USER_MESSAGE', () => {
  it('tells subagents to stay narrow and return only final text', () => {
    expect(DELEGATE_TURN_USER_MESSAGE).toContain('You are a subagent handling one bounded agent.delegate task.');
    expect(DELEGATE_TURN_USER_MESSAGE).toContain('Do not delegate again.');
    expect(DELEGATE_TURN_USER_MESSAGE).toContain('Return only final assistant text.');
  });

  it('keeps explorer delegates read only', () => {
    expect(
      filterDelegateTurnToolSet(
        {
          view: {},
          edit: {},
          'channel.read': {},
          shell: {},
          web_search: {},
          'channel.reply': {},
          'agent.delegate': {},
          'mcp__foo__bar': {},
        } as never,
        'explorer',
      ),
    ).toEqual({
      view: {},
      'channel.read': {},
      web_search: {},
    });
  });

  it('builds the kind prompt and defaults kind to worker', () => {
    expect(getDelegateKind({ metadata: { delegate: {} } })).toBe('worker');
    expect(buildDelegateTurnContextMessages('explorer')).toHaveLength(2);
  });
});
