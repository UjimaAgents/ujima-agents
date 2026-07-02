import { describe, expect, it } from 'vitest';
import {
  filterToolsForWakeReplyPolicy,
  isAgentOnlyDmThread,
  resolveWakeReplyPolicy,
} from './wake-reply-policy.js';
import { filterDeprecatedToolIds } from '../tools/index.js';

const CHANNEL_THREAD = 'channel-general';
const DM_THREAD = 'dm:agent-1:agent-2';

describe('isAgentOnlyDmThread', () => {
  it('is true when both DM participants are agents', () => {
    expect(isAgentOnlyDmThread(DM_THREAD, () => true)).toBe(true);
  });

  it('is false when the peer is a human', () => {
    const agents = new Set(['agent-1']);
    expect(isAgentOnlyDmThread('dm:agent-1:human-9', (id) => agents.has(id))).toBe(false);
  });

  it('is false for a non-DM thread id', () => {
    expect(isAgentOnlyDmThread(CHANNEL_THREAD, () => true)).toBe(false);
  });
});

describe('resolveWakeReplyPolicy — suppressPassTool matrix', () => {
  it('channel wake never suppresses pass', () => {
    expect(resolveWakeReplyPolicy({ threadId: CHANNEL_THREAD }).suppressPassTool).toBe(false);
  });

  it('@mention always suppresses pass (even agent DM)', () => {
    expect(
      resolveWakeReplyPolicy({
        threadId: DM_THREAD,
        wakeReason: 'mention',
        dmPeerIsAgent: true,
      }).suppressPassTool,
    ).toBe(true);
  });

  it('human DM suppresses pass (forced reply contract)', () => {
    expect(
      resolveWakeReplyPolicy({ threadId: DM_THREAD, dmPeerIsAgent: false }).suppressPassTool,
    ).toBe(true);
  });

  it('agent↔agent DM uses channel.close so the loop can terminate', () => {
    const policy = resolveWakeReplyPolicy({ threadId: DM_THREAD, dmPeerIsAgent: true });
    expect(policy.suppressPassTool).toBe(false);
    expect(policy.scaffoldBlock).toContain('channel.close');
    expect(policy.scaffoldBlock).toContain('ANOTHER AGENT');
  });

  it('omitting dmPeerIsAgent preserves the legacy human-DM behaviour', () => {
    expect(resolveWakeReplyPolicy({ threadId: DM_THREAD }).suppressPassTool).toBe(true);
  });
});

describe('filterToolsForWakeReplyPolicy', () => {
  const palette = ['channel.reply', 'channel.dm', 'channel.close', 'view'];

  it('strips channel.dm on a channel wake (keep conversations in the channel)', () => {
    const policy = resolveWakeReplyPolicy({ threadId: CHANNEL_THREAD });
    expect(filterToolsForWakeReplyPolicy(palette, policy)).not.toContain('channel.dm');
  });

  it('keeps channel.dm on a DM wake', () => {
    const policy = resolveWakeReplyPolicy({ threadId: DM_THREAD, dmPeerIsAgent: true });
    expect(filterToolsForWakeReplyPolicy(palette, policy)).toContain('channel.dm');
  });

  it('keeps channel.close when the policy suppresses old pass', () => {
    const policy = resolveWakeReplyPolicy({ threadId: DM_THREAD, dmPeerIsAgent: false });
    expect(filterToolsForWakeReplyPolicy(palette, policy)).toContain('channel.close');
  });
});

describe('filterDeprecatedToolIds — message tool removed', () => {
  it('drops the legacy message tool even when a role lists it', () => {
    expect(filterDeprecatedToolIds(['channel.reply', 'message', 'view'])).toEqual([
      'channel.reply',
      'view',
    ]);
  });
});
