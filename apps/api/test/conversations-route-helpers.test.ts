import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '@ujima/context-store';
import { Repository } from '@ujima/runtime-core';
import { MessageSchema, OrganizationSchema, MemberSchema } from '@ujima/shared';
import { resolveDirectMessageThreadId } from '../src/transport/routes/conversations';

describe('resolveDirectMessageThreadId', () => {
  function seed() {
    const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
    const organizationId = randomUUID();
    repo.saveOrganization(
      OrganizationSchema.parse({
        id: organizationId,
        name: 'Self DM Org',
        workspace: { root: '/tmp/self-dm-org', roleScopes: {} },
      }),
    );
    const sender = MemberSchema.parse({
      id: 'sender-x',
      organizationId,
      name: 'Sender',
      kind: 'human',
      roleName: 'owner',
    });
    repo.saveMember(sender);
    return { repo, organizationId, senderId: sender.id };
  }

  it('returns `self:<senderId>` for recipientId === "self" with no parent', () => {
    const { repo, organizationId, senderId } = seed();
    expect(
      resolveDirectMessageThreadId(repo, organizationId, senderId, 'self'),
    ).toBe(`self:${senderId}`);
  });

  // Regression: pre-fix the helper checked `parentMessageId` BEFORE
  // `recipientId === 'self'`, so a retried self-message that carried
  // a stale parentMessageId routed dedupe + access-check against the
  // parent message's thread instead of `self:<senderId>`. That could
  // duplicate self-notes (parent thread is a different surface) or
  // spuriously 403 after the sender lost access to the parent thread.
  it('ignores parentMessageId when recipientId === "self"', () => {
    const { repo, organizationId, senderId } = seed();
    // Persist a parent message that lives on a DIFFERENT thread — if
    // the helper still preferred it, the assertion below would point
    // at `'general'` instead of `self:<senderId>`.
    const parent = MessageSchema.parse({
      id: 'parent-msg',
      organizationId,
      threadId: 'general',
      channelId: 'general',
      senderId,
      senderKind: 'human',
      kind: 'human',
      content: 'thread parent',
      mentions: [],
      createdAt: '2026-05-20T00:00:00.000Z',
    });
    repo.saveMessage(parent);

    expect(
      resolveDirectMessageThreadId(repo, organizationId, senderId, 'self', parent.id),
    ).toBe(`self:${senderId}`);
  });

  it('uses parentMessageId for non-self direct messages', () => {
    const { repo, organizationId, senderId } = seed();
    const parent = MessageSchema.parse({
      id: 'parent-dm',
      organizationId,
      threadId: 'dm:alpha:beta',
      channelId: 'dm:alpha:beta',
      senderId: 'other-member',
      senderKind: 'human',
      kind: 'human',
      content: 'dm parent',
      mentions: [],
      createdAt: '2026-05-20T00:00:00.000Z',
    });
    repo.saveMessage(parent);

    expect(
      resolveDirectMessageThreadId(
        repo,
        organizationId,
        senderId,
        'other-member',
        parent.id,
      ),
    ).toBe('dm:alpha:beta');
  });
});
