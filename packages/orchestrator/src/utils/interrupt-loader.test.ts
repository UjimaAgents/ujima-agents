import { encodeCursor } from '@ujima/shared';
import { describe, expect, it, vi } from 'vitest';
import { loadChannelInterruptModelMessages, loadInterruptModelMessages } from './interrupt-loader.js';

describe('interrupt-loader', () => {
  it('uses the encoded cursor for thread loads', () => {
    const listMessages = vi.fn(() => ({ data: [] }));
    loadInterruptModelMessages({
      repo: { listMessages } as never,
      organizationId: 'org-1',
      threadId: 'thread-1',
      agentId: 'agent-1',
      cursor: { createdAt: '2026-01-01T00:00:00.000Z', id: 'msg-1' },
      runId: 'run-1',
      limit: 20,
    });

    expect(listMessages).toHaveBeenCalledWith(
      'org-1',
      'thread-1',
      encodeCursor('2026-01-01T00:00:00.000Z', 'msg-1'),
      20,
    );
  });

  it('uses the encoded cursor for channel loads', () => {
    const listChannelMessages = vi.fn(() => ({ data: [] }));
    loadChannelInterruptModelMessages({
      repo: { listChannelMessages } as never,
      organizationId: 'org-1',
      channelId: 'channel-1',
      agentId: 'agent-1',
      cursor: { createdAt: '2026-01-01T00:00:00.000Z', id: 'msg-1' },
      runId: 'run-1',
      limit: 20,
    });

    expect(listChannelMessages).toHaveBeenCalledWith('org-1', 'channel-1', {
      cursor: encodeCursor('2026-01-01T00:00:00.000Z', 'msg-1'),
      limit: 20,
    });
  });
});
