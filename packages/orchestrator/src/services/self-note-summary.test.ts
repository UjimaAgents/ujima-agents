import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateText, streamText } from 'ai';
import type { Message } from '@ujima/shared';
import {
  SELF_NOTE_SUMMARY_MARKER,
  buildConversationSummaryViaLlm,
  buildSelfNoteSummary,
  toReadableEnglishTimestamp,
} from './conversation-summary.js';

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

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
  afterEach(() => {
    vi.clearAllMocks();
  });

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

  it('uses streamText for Codex responses conversation summaries', async () => {
    vi.mocked(streamText).mockReturnValue({
      text: Promise.resolve(JSON.stringify({
        objective: ['fix compaction'],
        importantDetails: ['codex path'],
        completed: [],
        active: ['debugging'],
        blocked: [],
        nextActions: ['patch summary transport'],
      })),
    } as never);
    vi.mocked(generateText).mockRejectedValue(new Error('should not call generateText'));

    const summary = await buildConversationSummaryViaLlm({
      model: { provider: 'openai.responses' } as never,
      messages: [
        makeMessage('Compaction failed with Stream must be set to true.', '2026-05-08T09:41:00.000Z'),
      ],
    });

    expect(summary).toContain('fix compaction');
    expect(streamText).toHaveBeenCalledTimes(1);
    expect(generateText).not.toHaveBeenCalled();
  });

  it('passes the rolling previous summary back into later summary chunks', async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          objective: ['first chunk'],
          importantDetails: ['detail one'],
          completed: ['done one'],
          active: ['active one'],
          blocked: [],
          nextActions: ['next one'],
        }),
      } as never)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          objective: ['second chunk'],
          importantDetails: ['detail two'],
          completed: ['done two'],
          active: ['active two'],
          blocked: [],
          nextActions: ['next two'],
        }),
      } as never);

    await buildConversationSummaryViaLlm({
      model: { provider: 'anthropic' } as never,
      messages: Array.from({ length: 36 }, (_, index) =>
        makeMessage(`message-${index}`, `2026-05-08T09:${String(index).padStart(2, '0')}:00.000Z`),
      ),
    });

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(vi.mocked(generateText).mock.calls[0]?.[0].system).not.toContain('PREVIOUS summary');
    expect(vi.mocked(generateText).mock.calls[1]?.[0].system).toContain('PREVIOUS summary');
    expect(vi.mocked(generateText).mock.calls[1]?.[0].system).toContain('"objective"');
    expect(streamText).not.toHaveBeenCalled();
  });

});
