import { describe, expect, it } from 'vitest';
import {
  getDirectMessageThreadId,
  isDirectMessageThread,
  orgWorkspaceId,
  organizationIdFromWorkspaceId,
  parseDmThreadId,
  resolveDmPeerMemberId,
} from './conversations.js';

describe('workspace ids', () => {
  it('round-trips organization id through ws_ prefix', () => {
    expect(orgWorkspaceId('org-abc')).toBe('ws_org-abc');
    expect(organizationIdFromWorkspaceId('ws_org-abc')).toBe('org-abc');
  });
});

describe('direct message threads', () => {
  it('builds stable dm thread ids', () => {
    expect(getDirectMessageThreadId('b', 'a')).toBe('dm:a:b');
  });

  it('parses dm thread participants', () => {
    expect(parseDmThreadId('dm:agent-1:human-2')).toEqual({
      participantA: 'agent-1',
      participantB: 'human-2',
    });
  });

  it('resolves peer member id for current user', () => {
    expect(resolveDmPeerMemberId('dm:agent-1:human-2', 'human-2')).toBe('agent-1');
  });

  it('detects dm threads', () => {
    expect(isDirectMessageThread('dm:a:b')).toBe(true);
    expect(isDirectMessageThread('thread-1')).toBe(false);
  });
});
