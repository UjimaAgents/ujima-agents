import { describe, expect, it } from 'vitest';
import type { Message } from '@ujima/shared';
import { toModelMessages } from './to-model-messages.js';

describe('toModelMessages', () => {
  it('drops trace-only rows before building prompt messages', () => {
    const messages: Message[] = [
      {
        id: 'human-1',
        organizationId: 'org-1',
        threadId: 'thread-1',
        senderId: 'human-1',
        senderKind: 'human',
        kind: 'human',
        content: 'hello',
        mentions: [],
        toolCalls: [],
        attachments: [],
        createdAt: '2026-06-07T00:00:00.000Z',
      },
      {
        id: 'trace-1',
        organizationId: 'org-1',
        threadId: 'thread-1',
        senderId: 'agent-1',
        senderKind: 'agent',
        kind: 'agent',
        content: '',
        reasoningContent: 'secret',
        mentions: [],
        toolCalls: [],
        attachments: [],
        metadata: { traceOnly: true },
        createdAt: '2026-06-07T00:00:01.000Z',
      },
    ];

    expect(toModelMessages(messages, 'agent-1')).toEqual([
      {
        role: 'user',
        content: 'hello',
      },
    ]);
  });
});
