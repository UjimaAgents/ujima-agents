import { describe, expect, it } from 'vitest';
import {
  buildPassDenialReason,
  buildWakeRunScaffold,
  filterToolsForWakeReplyPolicy,
  resolveWakeReplyPolicy,
} from './wake-reply-policy.js';

describe('resolveWakeReplyPolicy', () => {
  it('mention wake on channel thread suppresses pass', () => {
    const policy = resolveWakeReplyPolicy({
      threadId: 'thread-general',
      wakeReason: 'mention',
    });
    expect(policy.conversationKind).toBe('channel');
    expect(policy.mandatoryReply).toBe(true);
    expect(policy.suppressPassTool).toBe(true);
    expect(policy.scaffoldBlock).toContain('channel.pass');
    expect(policy.scaffoldBlock).not.toContain('direct message (1:1)');
  });

  it('dm thread suppresses pass with standard dm wake', () => {
    const policy = resolveWakeReplyPolicy({
      threadId: 'dm:agent-a:human-b',
      wakeReason: 'dm',
    });
    expect(policy.conversationKind).toBe('dm');
    expect(policy.mandatoryReply).toBe(false);
    expect(policy.suppressPassTool).toBe(true);
    expect(policy.scaffoldBlock).toContain('direct message (1:1)');
  });

  it('dm thread allows pass when wake reason is channel-read (backpressure demoted)', () => {
    const policy = resolveWakeReplyPolicy({
      threadId: 'dm:agent-a:human-b',
      wakeReason: 'channel-read',
    });
    expect(policy.conversationKind).toBe('dm');
    expect(policy.mandatoryReply).toBe(false);
    expect(policy.suppressPassTool).toBe(false);
    expect(policy.scaffoldBlock).toContain('pairwise mention cap');
    expect(policy.scaffoldBlock).not.toMatch(/rate limit/i);
  });

  it('channel non-mention wake leaves pass available in palette policy', () => {
    const policy = resolveWakeReplyPolicy({
      threadId: 'thread-general',
      wakeReason: 'channel-read',
    });
    expect(policy.suppressPassTool).toBe(false);
    expect(filterToolsForWakeReplyPolicy(['channel.pass', 'channel.reply'], policy)).toEqual([
      'channel.pass',
      'channel.reply',
    ]);
  });
});

describe('buildWakeRunScaffold', () => {
  it('prepends anti-mirror line for fragile models', () => {
    const policy = resolveWakeReplyPolicy({ threadId: 'thread-1' });
    const scaffold = buildWakeRunScaffold({ policy, mirrorFragile: true });
    expect(scaffold.startsWith('IMPORTANT — anti-mirror rule')).toBe(true);
  });
});

describe('buildPassDenialReason', () => {
  it('matches mandatory-reply strings used by checkToolPolicy', () => {
    const policy = resolveWakeReplyPolicy({ threadId: 'thread-1', wakeReason: 'mention' });
    expect(buildPassDenialReason(policy)).toMatch(/mandatory-reply/);
  });

  it('matches direct-message strings for dm threads', () => {
    const policy = resolveWakeReplyPolicy({ threadId: 'dm:a:b' });
    expect(buildPassDenialReason(policy)).toMatch(/direct-message/);
  });
});
