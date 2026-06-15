import { describe, expect, it } from 'vitest';
import type { Message } from '@ujima/shared';
import {
  CONVERSATION_ARCHIVE_MARKER,
  CONVERSATION_COMPACTED_MARKER,
  CONVERSATION_SUMMARY_MARKER,
} from './conversation-summary.js';
import {
  listActiveCompactionSummaries,
  listUncompactedConversationMessages,
  selectCompactionBatch,
} from './conversation-compact.js';

function makeMessage(
  content: string,
  overrides: Partial<Message> = {},
): Message {
  return {
    id: `msg-${content}`,
    organizationId: 'org-1',
    threadId: 'dm:agent-1:human-1',
    channelId: 'dm:agent-1:human-1',
    senderId: 'human-1',
    senderKind: 'human',
    kind: 'human',
    content,
    mentions: [],
    toolCalls: [],
    attachments: [],
    createdAt: '2026-05-08T09:41:00.000Z',
    ...overrides,
  };
}

describe('conversation-compact selection', () => {
  it('keeps only visible rolling summaries in activeSummaries', () => {
    const folded = makeMessage(`${CONVERSATION_ARCHIVE_MARKER} folded`, {
      id: 'summary-folded',
      kind: 'system',
      metadata: { compactedInto: 'summary-new' },
    });
    const active = makeMessage(`${CONVERSATION_ARCHIVE_MARKER} active`, {
      id: 'summary-active',
      kind: 'system',
    });

    expect(listActiveCompactionSummaries([folded, active], CONVERSATION_ARCHIVE_MARKER)).toEqual([
      active,
    ]);
  });

  it('clears in bounded batches while folding prior archive summaries', () => {
    const priorArchive = makeMessage(`${CONVERSATION_ARCHIVE_MARKER} pass-1`, {
      id: 'archive-1',
      kind: 'system',
    });
    const messages = [
      priorArchive,
      ...Array.from({ length: 40 }, (_, index) =>
        makeMessage(`msg-${index + 1}`, { id: `msg-${index + 1}` }),
      ),
    ];

    const batch = selectCompactionBatch({
      messages,
      summaryMarker: CONVERSATION_ARCHIVE_MARKER,
      compactedMarker: CONVERSATION_ARCHIVE_MARKER,
      keepRawCount: 0,
      batchSize: 35,
      mode: 'archive',
    });

    expect(batch.activeSummaries.map((message) => message.id)).toEqual(['archive-1']);
    expect(batch.compactable).toHaveLength(35);
    expect(batch.compactable[0]?.id).toBe('msg-1');
    expect(batch.compactable[34]?.id).toBe('msg-35');
  });

  it('does not treat compacted source markers as uncompacted chat', () => {
    const compacted = makeMessage(`${CONVERSATION_COMPACTED_MARKER} hidden`);
    const human = makeMessage('visible');

    const uncompacted = listUncompactedConversationMessages(
      [compacted, human],
      {
        summaryMarker: CONVERSATION_SUMMARY_MARKER,
        compactedMarker: CONVERSATION_COMPACTED_MARKER,
        mode: 'summary',
      },
    );

    expect(uncompacted.map((message) => message.id)).toEqual(['msg-visible']);
  });

});

