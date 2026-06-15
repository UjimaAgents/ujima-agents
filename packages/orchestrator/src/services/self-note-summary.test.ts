import { describe, expect, it } from 'vitest';
import type { Message } from '@ujima/shared';
import {
  SELF_NOTE_SUMMARY_MARKER,
  buildSelfNoteSummary,
  toReadableEnglishTimestamp,
} from './conversation-summary.js';

function makeMessage(content: string, createdAt: string): Message {
  return {
    id: `msg-${createdAt}-${content}`,
    organizationId: 'org-1',
    threadId: 'self:agent-1',
    channelId: 'self:agent-1',
    senderId: 'agent-1',
    senderKind: 'agent',
    kind: 'agent',
    content,
    mentions: [],
    toolCalls: [],
    attachments: [],
    createdAt,
  };
}

describe('conversation-summary', () => {
  it('formats ISO timestamps to readable English', () => {
    const text = toReadableEnglishTimestamp('2026-05-08T09:41:00.000Z');
    expect(text).toMatch(/[A-Za-z]+,\s[A-Za-z]+\s\d{1,2},\s\d{4}\sat\s\d{1,2}:\d{2}\s(?:AM|PM)/);
  });

  it('builds a structured summary with marker and sections', () => {
    const summary = buildSelfNoteSummary([
      makeMessage('Decision: keep raw recency.', '2026-05-08T09:40:00.000Z'),
      makeMessage('Preference: short answers.', '2026-05-08T09:41:00.000Z'),
    ]);
    expect(summary.startsWith(SELF_NOTE_SUMMARY_MARKER)).toBe(true);
    expect(summary).toContain('# Compacted 2 earlier self notes.');
    expect(summary).toContain('> README-style compact summary -- your durable context from earlier in the conversation.');
    expect(summary).toContain("> Treat these notes as your own continuity. Details that don't carry forward are safe to forget.");
    expect(summary).toContain('## What I was working on');
    expect(summary).toContain('## Decisions I made');
    expect(summary).toContain('## Important facts');
  });

});
