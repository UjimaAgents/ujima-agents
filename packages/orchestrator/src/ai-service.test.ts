import { describe, expect, it } from 'vitest';
import { AGENT_KIND, type Message } from '@ujima/shared';
import { AiService } from './ai-service.js';
import { createMessageCursor } from './utils/message-interrupts.js';

function message(input: {
  id: string;
  threadId: string;
  senderId: string;
  kind?: 'human' | 'agent' | 'system';
  createdAt: string;
}): Message {
  return {
    id: input.id,
    organizationId: 'org-1',
    threadId: input.threadId,
    senderId: input.senderId,
    senderKind: input.kind === 'agent' ? AGENT_KIND : 'human',
    kind: input.kind ?? 'human',
    content: input.id,
    mentions: [],
    toolCalls: [],
    attachments: [],
    createdAt: input.createdAt,
  };
}

describe('AiService run interrupts', () => {
  it('loads only newer human messages from the active run thread', () => {
    const initial = [
      message({ id: 'm1', threadId: 'thread-1', senderId: 'human-1', createdAt: '2026-05-14T09:00:00.000Z' }),
    ];
    const latest = [
      ...initial,
      message({ id: 'm2', threadId: 'thread-1', senderId: 'agent-1', kind: 'agent', createdAt: '2026-05-14T09:00:01.000Z' }),
      message({ id: 'm3', threadId: 'thread-1', senderId: 'human-1', createdAt: '2026-05-14T09:00:02.000Z' }),
    ];
    const requestedThreads: string[] = [];
    const service = new AiService(
      {} as never,
      {
        listMessages: (_organizationId: string, threadId: string) => {
          requestedThreads.push(threadId);
          return { data: latest, hasMore: false };
        },
      } as never,
      {} as never,
    );

    const interrupts = (service as unknown as {
      loadRunInterrupts: (
        input: { organizationId: string; agentId: string; threadId: string },
        cursor: ReturnType<typeof createMessageCursor>,
      ) => Message[];
    }).loadRunInterrupts(
      { organizationId: 'org-1', agentId: 'agent-1', threadId: 'thread-1' },
      createMessageCursor(initial),
    );

    expect(requestedThreads).toEqual(['thread-1']);
    expect(interrupts.map((item) => item.id)).toEqual(['m3']);
  });

  it('does not consume messages from another thread for the same agent', () => {
    const initial = [
      message({ id: 'm1', threadId: 'thread-1', senderId: 'human-1', createdAt: '2026-05-14T09:00:00.000Z' }),
    ];
    const service = new AiService(
      {} as never,
      {
        listMessages: (_organizationId: string, threadId: string) => ({
          data:
            threadId === 'thread-1'
              ? initial
              : [
                  message({
                    id: 'other-thread',
                    threadId: 'thread-2',
                    senderId: 'human-1',
                    createdAt: '2026-05-14T09:00:02.000Z',
                  }),
                ],
          hasMore: false,
        }),
      } as never,
      {} as never,
    );

    const interrupts = (service as unknown as {
      loadRunInterrupts: (
        input: { organizationId: string; agentId: string; threadId: string },
        cursor: ReturnType<typeof createMessageCursor>,
      ) => Message[];
    }).loadRunInterrupts(
      { organizationId: 'org-1', agentId: 'agent-1', threadId: 'thread-1' },
      createMessageCursor(initial),
    );

    expect(interrupts).toEqual([]);
  });
});
