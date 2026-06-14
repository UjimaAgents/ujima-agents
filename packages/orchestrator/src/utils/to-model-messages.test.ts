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

  it('preserves assistant tool calls and results as structured model messages', () => {
    const messages: Message[] = [
      {
        id: 'agent-1',
        organizationId: 'org-1',
        threadId: 'thread-1',
        senderId: 'agent-1',
        senderKind: 'agent',
        kind: 'agent',
        content: 'Checking the file.',
        mentions: [],
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'shell',
            args: { command: 'ls' },
            result: { stdout: 'app\n' },
            isError: false,
          },
        ],
        attachments: [],
        createdAt: '2026-06-07T00:00:01.000Z',
      },
    ];

    expect(toModelMessages(messages, 'agent-1')).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checking the file.' },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'shell',
            input: { command: 'ls' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'shell',
            output: { type: 'json', value: { stdout: 'app\n' } },
          },
        ],
      },
    ]);
  });

  it('omits reasoning by default and keeps it when asked', () => {
    const messages: Message[] = [
      {
        id: 'agent-1',
        organizationId: 'org-1',
        threadId: 'thread-1',
        senderId: 'agent-1',
        senderKind: 'agent',
        kind: 'agent',
        content: 'Done.',
        reasoningContent: 'private trace',
        mentions: [],
        toolCalls: [],
        attachments: [],
        createdAt: '2026-06-07T00:00:01.000Z',
      },
    ];

    expect(toModelMessages(messages, 'agent-1')).toEqual([
      {
        role: 'assistant',
        content: 'Done.',
      },
    ]);
    expect(toModelMessages(messages, 'agent-1', { includeReasoning: true })).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'private trace' },
          { type: 'text', text: 'Done.' },
        ],
      },
    ]);
  });
});
