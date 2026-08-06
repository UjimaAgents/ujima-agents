import { describe, expect, it } from 'vitest';
import type { Message } from '@ujima/shared';
import {
  CONVERSATION_ARCHIVE_MARKER,
  CONVERSATION_COMPACTED_MARKER,
  CONVERSATION_SUMMARY_MARKER,
} from './conversation-summary.js';
import {
  estimatePromptReplayTokens,
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
      batchSize: 100,
      mode: 'archive',
    });

    expect(batch.activeSummaries.map((message) => message.id)).toEqual(['archive-1']);
    expect(batch.compactable).toHaveLength(40);
    expect(batch.compactable[0]?.id).toBe('msg-1');
    expect(batch.compactable[39]?.id).toBe('msg-40');
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

  it('preserves whole recent incoming turns, not just the last raw messages', () => {
    const messages = [
      makeMessage('user-1', { id: 'user-1', senderId: 'human-1', senderKind: 'human', kind: 'human' }),
      makeMessage('assistant-1', { id: 'assistant-1', senderId: 'agent-1', senderKind: 'agent', kind: 'agent', metadata: { runId: 'run-1' } }),
      makeMessage('user-2', { id: 'user-2', senderId: 'human-1', senderKind: 'human', kind: 'human' }),
      makeMessage('assistant-2', { id: 'assistant-2', senderId: 'agent-1', senderKind: 'agent', kind: 'agent', metadata: { runId: 'run-2' } }),
      makeMessage('user-3', { id: 'user-3', senderId: 'human-1', senderKind: 'human', kind: 'human' }),
    ];

    const batch = selectCompactionBatch({
      messages,
      summaryMarker: CONVERSATION_SUMMARY_MARKER,
      compactedMarker: CONVERSATION_COMPACTED_MARKER,
      batchSize: 100,
      mode: 'summary',
      tailTurns: 2,
      selfMemberId: 'agent-1',
    });

    expect(batch.compactable.map((message) => message.id)).toEqual(['user-1', 'assistant-1']);
  });

  it('counts visible run-step replay payloads in prompt token estimates', () => {
    const bigOutput = 'x'.repeat(8_000);
    const messages = [
      makeMessage('agent used a tool', {
        id: 'agent-msg',
        senderId: 'agent-1',
        senderKind: 'agent',
        kind: 'agent',
        metadata: { runId: 'run-1' },
      }),
    ];

    const estimate = estimatePromptReplayTokens(
      {
        listRunSteps: () => [
          {
            id: 'step-1',
            organizationId: 'org-1',
            runId: 'run-1',
            threadId: 'dm:agent-1:human-1',
            agentId: 'agent-1',
            toolCallId: 'call-1',
            toolId: 'channel.read',
            action: 'read',
            resourceType: 'message',
            resourcePath: 'dm:agent-1:human-1',
            input: { channel_id: 'dm:agent-1:human-1' },
            output: { data: [{ content: bigOutput }] },
            status: 'ok',
            createdAt: '2026-05-08T09:41:01.000Z',
          },
        ],
      },
      'org-1',
      messages,
    );

    expect(estimate).toBeGreaterThan(2_000);
  });

  it('does not double-count run steps already stored on message tool calls', () => {
    const message = makeMessage('agent used a tool', {
      id: 'agent-msg',
      senderId: 'agent-1',
      senderKind: 'agent',
      kind: 'agent',
      metadata: { runId: 'run-1' },
      toolCalls: [
        {
          toolCallId: 'call-1',
          toolName: 'channel.read',
          args: {},
          result: { data: [{ content: 'short' }] },
          isError: false,
        },
      ],
    });

    const estimate = estimatePromptReplayTokens(
      {
        listRunSteps: () => [
          {
            id: 'step-1',
            organizationId: 'org-1',
            runId: 'run-1',
            threadId: 'dm:agent-1:human-1',
            agentId: 'agent-1',
            toolCallId: 'call-1',
            toolId: 'channel.read',
            action: 'read',
            resourceType: 'message',
            resourcePath: 'dm:agent-1:human-1',
            input: {},
            output: { data: [{ content: 'x'.repeat(8_000) }] },
            status: 'ok',
            createdAt: '2026-05-08T09:41:01.000Z',
          },
        ],
      },
      'org-1',
      [message],
    );

    expect(estimate).toBeLessThan(200);
  });

  it('uses replay content instead of cumulative request usage', () => {
    const messages = [
      makeMessage('user message 1', {
        id: 'msg-1',
        senderId: 'human-1',
        senderKind: 'human',
        kind: 'human',
        content: 'hello',
      }),
      makeMessage('assistant response 1', {
        id: 'msg-2',
        senderId: 'agent-1',
        senderKind: 'agent',
        kind: 'agent',
        content: 'hi there',
        inputTokens: 1000,
        outputTokens: 50,
      }),
      makeMessage('user message 2', {
        id: 'msg-3',
        senderId: 'human-1',
        senderKind: 'human',
        kind: 'human',
        content: 'how are you?',
      }),
    ];

    const estimate = estimatePromptReplayTokens(
      { listRunSteps: () => [] },
      'org-1',
      messages,
    );

    expect(estimate).toBe(1_055);
  });

});
