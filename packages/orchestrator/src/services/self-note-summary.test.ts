import { describe, expect, it } from 'vitest';
import type { Message } from '@ujima/shared';
import {
  CONVERSATION_ARCHIVE_MARKER,
  CONVERSATION_COMPACTED_MARKER,
  CONVERSATION_SUMMARY_MARKER,
  SELF_NOTE_COMPACTED_MARKER,
  SELF_NOTE_SUMMARY_MARKER,
  buildConversationArchiveSummary,
  buildConversationSummary,
  buildStructuredConversationSummary,
  buildSelfNoteSummary,
  formatTimestampedContent,
  isArchivedConversation,
  isCompactedConversation,
  isCompactedSelfNote,
  isMessageWithMarker,
  isConversationSummary,
  isSelfSummaryNote,
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

  it('prefixes self note content with readable timestamp', () => {
    const text = formatTimestampedContent('remember this', '2026-05-08T09:41:00.000Z');
    expect(text).toContain('remember this');
    expect(text.startsWith('[')).toBe(true);
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

  it('builds general conversation summaries for non-self contexts', () => {
    const summary = buildStructuredConversationSummary({
      title: 'Compacted support-thread conversation.',
      marker: '[[CONVERSATION_SUMMARY_V1]]',
      messages: [makeMessage('Customer asked about invoice reconciliation.', '2026-05-08T09:40:00.000Z')],
      sections: [
        { heading: 'Current goals', bullets: ['Resolve issue without escalating unnecessarily.'] },
        { heading: 'Decisions', bullets: ['Request account id before actioning credits.'] },
      ],
    });
    expect(summary).toContain('[[CONVERSATION_SUMMARY_V1]]');
    expect(summary).toContain('# Compacted support-thread conversation.');
    expect(summary).toContain('## Current goals');
    expect(summary).toContain('## Decisions');
    expect(summary).toContain('Customer asked about invoice reconciliation.');
  });

  it('builds conversation archive summaries with dedicated markers', () => {
    const summary = buildConversationArchiveSummary([
      makeMessage('Conversation cleared for a fresh start.', '2026-05-08T09:40:00.000Z'),
    ]);
    expect(summary.startsWith(CONVERSATION_ARCHIVE_MARKER)).toBe(true);
    expect(summary).toContain('Archived 1 earlier messages.');
  });

  it('builds rolling conversation summaries with dedicated markers', () => {
    const summary = buildConversationSummary([
      makeMessage('Decision: keep the latest request visible.', '2026-05-08T09:40:00.000Z'),
      makeMessage('Need to verify approval errors in the UI.', '2026-05-08T09:41:00.000Z'),
    ]);
    expect(summary.startsWith(CONVERSATION_SUMMARY_MARKER)).toBe(true);
    expect(summary).toContain('Compacted 2 earlier messages.');
    expect(summary).toContain('Decision: keep the latest request visible.');
    expect(summary).toContain('Need to verify approval errors in the UI.');
  });

  it('detects summary and compacted markers', () => {
    expect(isSelfSummaryNote(makeMessage(`${SELF_NOTE_SUMMARY_MARKER} summary`, '2026-05-08T09:41:00.000Z'))).toBe(true);
    expect(isCompactedSelfNote(makeMessage(`${SELF_NOTE_COMPACTED_MARKER} compacted`, '2026-05-08T09:41:00.000Z'))).toBe(true);
    expect(isConversationSummary(makeMessage(`${CONVERSATION_SUMMARY_MARKER} summary`, '2026-05-08T09:41:00.000Z'))).toBe(true);
    expect(isCompactedConversation(makeMessage(`${CONVERSATION_COMPACTED_MARKER} compacted`, '2026-05-08T09:41:00.000Z'))).toBe(true);
    expect(isArchivedConversation(makeMessage(`${CONVERSATION_ARCHIVE_MARKER} archived`, '2026-05-08T09:41:00.000Z'))).toBe(true);
    expect(isMessageWithMarker(makeMessage('[[X]] anything', '2026-05-08T09:41:00.000Z'), '[[X]]')).toBe(true);
  });
});
