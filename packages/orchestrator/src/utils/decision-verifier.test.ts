import { describe, expect, it } from 'vitest';
import { verifyChannelPass } from './decision-verifier.js';
import type { ConversationRepository } from '../services/repository-reader.js';
import type { Message } from '@ujima/shared';

function buildMessage(overrides: Partial<Message>): Message {
  return {
    id: overrides.id ?? 'msg-default',
    organizationId: overrides.organizationId ?? 'org-1',
    threadId: overrides.threadId ?? 'thread-1',
    senderId: overrides.senderId ?? 'human-1',
    senderKind: overrides.senderKind ?? 'human',
    kind: overrides.kind ?? 'human',
    content: overrides.content ?? '',
    mentions: overrides.mentions ?? [],
    toolCalls: [],
    attachments: [],
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    ...(overrides.parentMessageId ? { parentMessageId: overrides.parentMessageId } : {}),
    ...(overrides.channelId ? { channelId: overrides.channelId } : {}),
  } as Message;
}

function buildRepo(messages: Message[]): ConversationRepository {
  return {
    listMessages: (_org: string, _thread: string, _cursor?: string, _limit?: number) => ({
      data: messages,
      hasMore: false,
      nextCursor: undefined,
    }),
    getMessage: (_org: string, id: string) => messages.find((m) => m.id === id) ?? null,
  } as unknown as ConversationRepository;
}

describe('verifyChannelPass — shadow-mode verifier', () => {
  describe('not_addressed_to_me', () => {
    it('flags failure when agent was explicitly mentioned in the source message', () => {
      const source = buildMessage({
        id: 'msg-1',
        content: 'Hey Ada can you take a look',
        mentions: ['agent-ada'],
      });
      const result = verifyChannelPass(
        {
          organizationId: 'org-1',
          agentId: 'agent-ada',
          threadId: 'thread-1',
          reason: 'not_addressed_to_me',
          sourceMessageId: 'msg-1',
        },
        buildRepo([source]),
      );
      expect(result.verified).toBe(false);
      expect(result.failureKinds).toContain('not_addressed_to_me_but_self_was_mentioned');
    });

    it('verifies when neither mention nor name reference applies', () => {
      const source = buildMessage({
        id: 'msg-1',
        content: 'Hey bob, can you ship the deploy?',
      });
      const result = verifyChannelPass(
        {
          organizationId: 'org-1',
          agentId: 'agent-ada',
          agentName: 'Ada',
          threadId: 'thread-1',
          reason: 'not_addressed_to_me',
          sourceMessageId: 'msg-1',
        },
        buildRepo([source]),
      );
      expect(result.verified).toBe(true);
    });

    it('does not invent a source message when sourceMessageId is missing', () => {
      const source = buildMessage({
        id: 'msg-1',
        content: 'Hey Ada can you take a look',
        mentions: ['agent-ada'],
      });
      const result = verifyChannelPass(
        {
          organizationId: 'org-1',
          agentId: 'agent-ada',
          threadId: 'thread-1',
          reason: 'not_addressed_to_me',
        },
        buildRepo([source]),
      );
      expect(result.verified).toBe(true);
    });
  });

  describe('already_handled', () => {
    it('verifies when another agent has posted and the citation+quote check out', () => {
      const source = buildMessage({
        id: 'msg-1',
        content: 'who can ship?',
        createdAt: '2026-05-19T10:00:00.000Z',
      });
      const responder = buildMessage({
        id: 'msg-2',
        senderId: 'agent-bob',
        senderKind: 'agent',
        kind: 'agent',
        content: 'I will ship at 3pm.',
        createdAt: '2026-05-19T10:05:00.000Z',
      });
      const result = verifyChannelPass(
        {
          organizationId: 'org-1',
          agentId: 'agent-ada',
          threadId: 'thread-1',
          reason: 'already_handled',
          citedMessageIds: ['msg-2'],
          quotedText: 'I will ship at 3pm',
          sourceMessageId: 'msg-1',
        },
        buildRepo([source, responder]),
      );
      expect(result.verified).toBe(true);
    });
  });

});
