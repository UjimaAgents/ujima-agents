import { describe, expect, it } from 'vitest';
import type { Message } from '@ujima/shared';
import {
  CONVERSATION_ARCHIVE_MARKER,
  CONVERSATION_SUMMARY_MARKER,
} from '../services/conversation-summary.js';
import {
  PROMPT_CONTEXT_CHAR_BUDGET,
  PROMPT_MESSAGE_CHAR_LIMIT,
  selectPromptContextMessages,
} from './prompt-context.js';

describe('selectPromptContextMessages', () => {
  it('keeps the latest compaction summary plus the newest raw messages after it', () => {
    const summary: Message = {
      id: 'summary-1',
      organizationId: 'org-1',
      threadId: 'thread-1',
      senderId: 'system',
      senderKind: 'human',
      kind: 'system',
      content: `${CONVERSATION_SUMMARY_MARKER} # Compacted earlier messages.`,
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

  it('uses the latest archive as durable context and ignores older summaries', () => {
    const base = (id: string, content: string, createdAt: string, kind: Message['kind'] = 'human'): Message => ({
      id,
      organizationId: 'org-1',
      threadId: 'thread-1',
      senderId: kind === 'system' ? 'system' : 'human-1',
      senderKind: 'human',
      kind,
      content,
      mentions: [],
      toolCalls: [],
      attachments: [],
      createdAt,
    });
    const summary = base(
      'summary',
      `${CONVERSATION_SUMMARY_MARKER} # Compacted earlier messages.`,
      '2026-06-01T00:00:01.000Z',
      'system',
    );
    const archive = base(
      'archive',
      `${CONVERSATION_ARCHIVE_MARKER} # Archived earlier messages.`,
      '2026-06-01T00:00:03.000Z',
      'system',
    );
    const latest = base('latest', 'new request', '2026-06-01T00:00:04.000Z');

    const selected = selectPromptContextMessages([summary, archive, latest]);

    expect(selected.map((message) => message.id)).toEqual(['archive', 'latest']);
    expect(selected[0]?.content.startsWith(CONVERSATION_ARCHIVE_MARKER)).toBe(true);
  });

  it('bounds oversized history while preserving the newest message', () => {
    const messages: Message[] = Array.from({ length: 20 }, (_, index) => ({
      id: `message-${index}`,
      organizationId: 'org-1',
      threadId: 'thread-1',
      senderId: 'human-1',
      senderKind: 'human',
      kind: 'human',
      content: `${index}:${'x'.repeat(20_000)}`,
      mentions: [],
      toolCalls: [],
      attachments: [],
      createdAt: `2026-06-01T00:00:${String(index).padStart(2, '0')}.000Z`,
    }));

    const selected = selectPromptContextMessages(messages);

    expect(selected.at(-1)?.id).toBe('message-19');
    expect(selected.every((message) => message.content.length <= PROMPT_MESSAGE_CHAR_LIMIT)).toBe(true);
    expect(selected.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(
      PROMPT_CONTEXT_CHAR_BUDGET,
    );
  });
});
