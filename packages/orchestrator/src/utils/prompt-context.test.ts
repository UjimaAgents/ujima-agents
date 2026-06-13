import { describe, expect, it } from 'vitest';
import type { Message } from '@ujima/shared';
import { CONVERSATION_SUMMARY_MARKER, buildConversationSummary } from '../services/conversation-summary.js';
import { selectPromptContextMessages } from './prompt-context.js';

describe('selectPromptContextMessages', () => {
  it('keeps the latest compaction summary plus the newest raw messages after it', () => {
    const summary: Message = {
      id: 'summary-1',
      organizationId: 'org-1',
      threadId: 'thread-1',
      senderId: 'system',
      senderKind: 'human',
      kind: 'system',
      content: buildConversationSummary([
        {
          id: 'old-1',
          organizationId: 'org-1',
          threadId: 'thread-1',
          senderId: 'human-1',
          senderKind: 'human',
          kind: 'human',
          content: 'old',
          mentions: [],
          toolCalls: [],
          attachments: [],
          createdAt: '2026-06-01T00:00:00.000Z',
        },
      ]),
      mentions: [],
      toolCalls: [],
      attachments: [],
      createdAt: '2026-06-01T00:00:01.000Z',
    };
    const rawMessages: Message[] = Array.from({ length: 5 }, (_, index) => ({
      id: `raw-${index + 1}`,
      organizationId: 'org-1',
      threadId: 'thread-1',
      senderId: 'human-1',
      senderKind: 'human',
      kind: 'human',
      content: `raw-${index + 1}`,
      mentions: [],
      toolCalls: [],
      attachments: [],
      createdAt: `2026-06-01T00:00:0${index + 2}.000Z`,
    }));

    const selected = selectPromptContextMessages([summary, ...rawMessages], 2);
    expect(selected.map((message) => message.id)).toEqual(['summary-1', 'raw-4', 'raw-5']);
    expect(selected[0]?.content.startsWith(CONVERSATION_SUMMARY_MARKER)).toBe(true);
  });
});
