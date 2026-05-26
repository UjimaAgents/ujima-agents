import { describe, expect, it } from 'vitest';
import { MessageSchema } from '@ujima/shared';
import { CONVERSATION_SUMMARY_MARKER } from '../services/conversation-summary.js';
import { toModelMessages } from './to-model-messages.js';

describe('toModelMessages system filtering', () => {
  const createdAt = '2026-01-01T00:00:00.000Z';

  it('drops approval relay system rows', () => {
    const approval = MessageSchema.parse({
      id: 'm-a',
      organizationId: 'org',
      threadId: 'th',
      senderId: 'system',
      senderKind: 'human',
      kind: 'system',
      content: '[Approval needed] Shell\nCwd: /tmp\nCommand: pwd',
      mentions: [],
      createdAt,
    });
    expect(toModelMessages([approval])).toEqual([]);
  });

  it('keeps compaction summary system rows as model system turns', () => {
    const summary = MessageSchema.parse({
      id: 'm-s',
      organizationId: 'org',
      threadId: 'th',
      senderId: 'system',
      senderKind: 'human',
      kind: 'system',
      content: `${CONVERSATION_SUMMARY_MARKER} # Title\n\nBody`,
      mentions: [],
      createdAt,
    });
    const out = toModelMessages([summary]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      role: 'system',
      content: summary.content,
    });
  });

  it('replays persisted tool results into model context', () => {
    const message = MessageSchema.parse({
      id: 'm-tool',
      organizationId: 'org',
      threadId: 'th',
      senderId: 'agent-1',
      senderKind: 'agent',
      kind: 'agent',
      content: 'Checked the file.',
      toolCalls: [
        {
          toolCallId: 'tool-1',
          toolName: 'view',
          args: { path: 'README.md' },
          result: { content: 'Important persisted output.' },
        },
      ],
      mentions: [],
      createdAt,
    });

    const content = toModelMessages([message], 'agent-1')[0]?.content;
    expect(typeof content).toBe('string');
    expect(content).toContain('Tool results:');
    expect(content).toContain('Important persisted output.');
  });
});
