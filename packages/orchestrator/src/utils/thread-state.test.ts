import { describe, expect, it } from 'vitest';
import { buildThreadStateBlock } from './thread-state.js';
import { MemberSchema, MessageSchema, type Member, type Message } from '@ujima/shared';

function buildMessage(overrides: Partial<Message>): Message {
  return MessageSchema.parse({
    id: 'msg',
    organizationId: 'org-1',
    threadId: 'thread-1',
    senderId: 'human-1',
    senderKind: 'human',
    kind: 'human',
    content: '',
    mentions: [],
    toolCalls: [],
    attachments: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  });
}

function buildMember(overrides: Partial<Member>): Member {
  return MemberSchema.parse({
    id: 'm',
    organizationId: 'org-1',
    name: 'Member',
    kind: 'agent',
    roleName: 'engineer',
    presence: 'online',
    ...overrides,
  });
}

describe('buildThreadStateBlock', () => {
  const members = [
    buildMember({ id: 'human-1', name: 'Oluwaseyi', kind: 'human', roleName: 'lead' }),
    buildMember({ id: 'agent-ada', name: 'Ada', kind: 'agent', roleName: 'engineer' }),
    buildMember({ id: 'agent-bob', name: 'Bob', kind: 'agent', roleName: 'engineer' }),
    buildMember({ id: 'agent-cleo', name: 'Cleo', kind: 'agent', roleName: 'qa' }),
  ];

  it('returns null when there are no messages', () => {
    const block = buildThreadStateBlock({
      messages: [],
      currentMember: { id: 'agent-ada', name: 'Ada' },
      members,
    });
    expect(block).toBeNull();
  });

  it('marks the agent as explicitly addressed when included in mentions', () => {
    const source = buildMessage({
      id: 'msg-1',
      content: 'hey Ada take a look',
      mentions: ['agent-ada'],
      createdAt: '2026-05-19T10:00:00.000Z',
    });
    const block = buildThreadStateBlock({
      messages: [source],
      currentMember: { id: 'agent-ada', name: 'Ada' },
      sourceMessageId: 'msg-1',
      members,
    });
    expect(block).toContain('<you-explicitly-addressed>true</you-explicitly-addressed>');
  });

  it('lists agents who have responded since the source message', () => {
    const source = buildMessage({
      id: 'msg-1',
      content: 'who can ship?',
      createdAt: '2026-05-19T10:00:00.000Z',
    });
    const bobReply = buildMessage({
      id: 'msg-2',
      senderId: 'agent-bob',
      senderKind: 'agent',
      kind: 'agent',
      content: 'I will ship at 3pm.',
      createdAt: '2026-05-19T10:05:00.000Z',
    });
    const block = buildThreadStateBlock({
      messages: [source, bobReply],
      currentMember: { id: 'agent-ada', name: 'Ada' },
      sourceMessageId: 'msg-1',
      members,
    });
    expect(block).toContain('<agents-who-already-responded>Bob</agents-who-already-responded>');
    // not-yet-responded should include the remaining agents (Cleo), exclude self
    expect(block).toMatch(/<agents-not-yet-responded>[^<]*Cleo[^<]*<\/agents-not-yet-responded>/);
  });

});
