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
    expect(summary).not.toContain('README-style compact summary');
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
    expect(summary).not.toContain('- - Completed:');
    expect(streamText).toHaveBeenCalledTimes(1);
    expect(generateText).not.toHaveBeenCalled();
  });

  it('includes persisted tool work in conversation summaries', async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify({
        objective: ['fix billing'],
        importantDetails: ['BillingService inspected'],
        completed: ['read billing service'],
        active: [],
        blocked: [],
        nextActions: ['patch billing service'],
      }),
    } as never);

    await buildConversationSummaryViaLlm({
      model: { provider: 'anthropic' } as never,
      messages: [makeMessage('Working on billing.', '2026-05-08T09:41:00.000Z')],
      runSteps: [{
        id: 'step-1',
        organizationId: 'org-1',
        runId: 'run-1',
        threadId: 'self:agent-1',
        agentId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'filesystem.read',
        action: 'read',
        resourceType: 'file',
        resourcePath: 'billing_service.py',
        input: { path: 'billing_service.py' },
        output: { content: 'class BillingService' },
        status: 'ok',
        createdAt: '2026-05-08T09:41:01.000Z',
      }],
    });

    const prompt = vi.mocked(generateText).mock.calls[0]?.[0].prompt;
    expect(prompt).toContain('filesystem.read');
    expect(prompt).toContain('BillingService');
  });

  it('summarizes the whole context window in a single LLM call', async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify({
        objective: ['whole window'],
        importantDetails: ['detail one'],
        completed: ['done one'],
        active: ['active one'],
        blocked: [],
        nextActions: ['next one'],
      }),
    } as never);

    const summary = await buildConversationSummaryViaLlm({
      model: { provider: 'anthropic' } as never,
      messages: Array.from({ length: 200 }, (_, index) =>
        makeMessage(`message-${index}`, `2026-05-08T09:${String(index % 60).padStart(2, '0')}:00.000Z`),
      ),
    });

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generateText).mock.calls[0]?.[0].system).not.toContain('PREVIOUS summary');
    expect(vi.mocked(generateText).mock.calls[0]?.[0].prompt).toContain('message-199');
    expect(summary).toContain('whole window');
    expect(streamText).not.toHaveBeenCalled();
  });

  it('preserves every transcript entry when the full window overflows the summarizer', async () => {
    vi.mocked(generateText)
      .mockRejectedValueOnce(new Error('prompt is too long: 250000 tokens > 200000 maximum context length'))
      .mockResolvedValueOnce({
        text: JSON.stringify({
          objective: ['whole window'],
          importantDetails: ['early context'],
          completed: [],
          active: [],
          blocked: [],
          nextActions: [],
        }),
      } as never)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          objective: ['whole window'],
          importantDetails: ['late context'],
          completed: [],
          active: [],
          blocked: [],
          nextActions: [],
        }),
      } as never)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          objective: ['whole window'],
          importantDetails: ['early context', 'late context'],
          completed: [],
          active: [],
          blocked: [],
          nextActions: [],
        }),
      } as never);

    const summary = await buildConversationSummaryViaLlm({
      model: { provider: 'anthropic' } as never,
      messages: Array.from({ length: 200 }, (_, index) =>
        makeMessage(
          `message-${index}`,
          `2026-05-08T${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00.000Z`,
        ),
      ),
    });

    expect(generateText).toHaveBeenCalledTimes(4);
    const earlyPrompt = vi.mocked(generateText).mock.calls[1]?.[0].prompt ?? '';
    const latePrompt = vi.mocked(generateText).mock.calls[2]?.[0].prompt ?? '';
    const mergePrompt = vi.mocked(generateText).mock.calls[3]?.[0].prompt ?? '';
    expect(earlyPrompt).toContain('message-0');
    expect(latePrompt).toContain('message-199');
    expect(mergePrompt).toContain('early context');
    expect(mergePrompt).toContain('late context');
    expect(summary).toContain('early context');
    expect(summary).toContain('late context');
  });

  it('preserves every transcript entry when summary JSON is truncated', async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({
        text: '{ "objective": ["unfinished',
      } as never)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          objective: ['whole window'],
          importantDetails: ['early context'],
          completed: [],
          active: [],
          blocked: [],
          nextActions: [],
        }),
      } as never)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          objective: ['whole window'],
          importantDetails: ['late context'],
          completed: [],
          active: [],
          blocked: [],
          nextActions: [],
        }),
      } as never)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          objective: ['whole window'],
          importantDetails: ['early context', 'late context'],
          completed: [],
          active: [],
          blocked: [],
          nextActions: [],
        }),
      } as never);

    const summary = await buildConversationSummaryViaLlm({
      model: { provider: 'anthropic' } as never,
      messages: [
        makeMessage('early context', '2026-05-08T09:41:00.000Z'),
        makeMessage('late context', '2026-05-08T09:42:00.000Z'),
      ],
    });

    expect(generateText).toHaveBeenCalledTimes(4);
    expect(summary).toContain('early context');
    expect(summary).toContain('late context');
  });

  it('does not fall back on non-overflow summarizer failures', async () => {
    vi.mocked(generateText).mockRejectedValue(new Error('connection reset by peer'));

    await expect(buildConversationSummaryViaLlm({
      model: { provider: 'anthropic' } as never,
      messages: [makeMessage('hello', '2026-05-08T09:41:00.000Z')],
    })).rejects.toThrow('Conversation summarization failed');

    expect(generateText).toHaveBeenCalledTimes(1);
  });

});
