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

    it('flags failure when agent name appears as standalone token in source body', () => {
      const source = buildMessage({
        id: 'msg-1',
        content: 'Hey ada, can you take a look?',
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
      expect(result.verified).toBe(false);
      expect(result.failureKinds).toContain('not_addressed_to_me_but_name_referenced');
    });

    it('flags failure when pass is claimed in a direct message from the peer', () => {
      const source = buildMessage({
        id: 'msg-1',
        senderId: 'human-1',
        content: 'review the frontend and critique the UX',
      });
      const result = verifyChannelPass(
        {
          organizationId: 'org-1',
          agentId: 'agent-ada',
          threadId: 'dm:agent-ada:human-1',
          reason: 'not_addressed_to_me',
          sourceMessageId: 'msg-1',
        },
        buildRepo([source]),
      );
      expect(result.verified).toBe(false);
      expect(result.failureKinds).toContain('not_addressed_to_me_in_direct_message');
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
  });

  describe('already_handled', () => {
    it('flags failure when no other agent has posted since the source message', () => {
      const source = buildMessage({
        id: 'msg-1',
        content: 'who can ship this?',
        createdAt: '2026-05-19T10:00:00.000Z',
      });
      const result = verifyChannelPass(
        {
          organizationId: 'org-1',
          agentId: 'agent-ada',
          threadId: 'thread-1',
          reason: 'already_handled',
          citedMessageIds: ['msg-fake'],
          sourceMessageId: 'msg-1',
        },
        buildRepo([source]),
      );
      expect(result.verified).toBe(false);
      expect(result.failureKinds).toContain('already_handled_but_no_prior_responder');
      expect(result.failureKinds).toContain('already_handled_cited_message_not_found');
    });

    it('flags failure when quoted text is not a substring of any cited message', () => {
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
          quotedText: 'I will deploy tomorrow',
          sourceMessageId: 'msg-1',
        },
        buildRepo([source, responder]),
      );
      expect(result.verified).toBe(false);
      expect(result.failureKinds).toContain('already_handled_quoted_text_not_present');
    });

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

  describe('duplicate_reply', () => {
    it('flags failure when this agent has no prior message in the thread', () => {
      const source = buildMessage({ id: 'msg-1', content: 'hey' });
      const result = verifyChannelPass(
        {
          organizationId: 'org-1',
          agentId: 'agent-ada',
          threadId: 'thread-1',
          reason: 'duplicate_reply',
          citedMessageIds: ['msg-fake'],
          sourceMessageId: 'msg-1',
        },
        buildRepo([source]),
      );
      expect(result.verified).toBe(false);
      expect(result.failureKinds).toContain('duplicate_reply_but_no_prior_self_message');
    });
  });

  describe('awaiting_human', () => {
    it('flags failure when the last message in the thread is itself a human message', () => {
      const source = buildMessage({
        id: 'msg-1',
        content: 'team status?',
        createdAt: '2026-05-19T10:00:00.000Z',
      });
      const result = verifyChannelPass(
        {
          organizationId: 'org-1',
          agentId: 'agent-ada',
          threadId: 'thread-1',
          reason: 'awaiting_human',
          sourceMessageId: 'msg-1',
        },
        buildRepo([source]),
      );
      expect(result.verified).toBe(false);
      expect(result.failureKinds).toContain('awaiting_human_but_last_message_was_human');
    });
  });

  describe('out_of_scope', () => {
    it('always verifies (heuristic, not factually checkable from thread state)', () => {
      const source = buildMessage({ id: 'msg-1', content: 'team status?' });
      const result = verifyChannelPass(
        {
          organizationId: 'org-1',
          agentId: 'agent-ada',
          threadId: 'thread-1',
          reason: 'out_of_scope',
          sourceMessageId: 'msg-1',
        },
        buildRepo([source]),
      );
      expect(result.verified).toBe(true);
      expect(result.failureKinds).toEqual([]);
    });
  });
});
