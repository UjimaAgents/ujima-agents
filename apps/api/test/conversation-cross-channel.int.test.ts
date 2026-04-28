import { describe, expect, it } from 'vitest';
import { openDatabase } from '@ujima/context-store';
import {
  MemberSchema,
  MessageSchema,
  OrganizationSchema,
  type SocketEventName,
} from '@ujima/shared';
import { Repository } from '@ujima/runtime-core';
import { ConversationService } from '@ujima/orchestrator';
import type { RealtimeService } from '@ujima/orchestrator';
import { randomUUID } from 'node:crypto';

function newRepo(): Repository {
  return new Repository(openDatabase({ dbPath: ':memory:' }));
}

const fakeRealtime: RealtimeService = {
  emit<_T extends SocketEventName>(): void {
    /* no-op */
  },
};

function seedOrg(repo: Repository) {
  const orgId = randomUUID();
  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Conv Org',
      workspace: { root: '/tmp/conv-org', roleScopes: {} },
    }),
  );
  const sender = MemberSchema.parse({
    id: 'alex',
    organizationId: orgId,
    name: 'Alex',
    kind: 'agent',
    roleName: 'backend-engineer',
  });
  repo.saveMember(sender);
  return { orgId, senderId: sender.id };
}

function seedChannel(
  repo: Repository,
  orgId: string,
  channelId: string,
  memberIds: string[] = [],
) {
  repo.saveChannel({
    id: channelId,
    organizationId: orgId,
    name: channelId,
    kind: 'general',
    topic: '',
    memberIds,
  });
  repo.ensureThread({
    id: channelId,
    organizationId: orgId,
    channelId,
    title: channelId,
    memberIds,
    createdAt: new Date().toISOString(),
  });
}

describe('ConversationService.postToChannel — reply_to is channel-scoped', () => {
  it('rejects a reply whose parent lives in a different channel', () => {
    const repo = newRepo();
    const svc = new ConversationService(repo, fakeRealtime);
    const { orgId, senderId } = seedOrg(repo);

    seedChannel(repo, orgId, 'general', [senderId]);
    seedChannel(repo, orgId, 'frontend', [senderId]);

    // Parent message lives in #general.
    const parent = MessageSchema.parse({
      id: randomUUID(),
      organizationId: orgId,
      threadId: 'general',
      channelId: 'general',
      senderId,
      senderKind: 'agent',
      kind: 'agent',
      content: 'parent in general',
      mentions: [],
      createdAt: new Date().toISOString(),
    });
    repo.saveMessage(parent);

    // Pre-fix: this would post into #frontend while threading under
    // #general's conversation, leaking the reply across channel boundaries.
    expect(() =>
      svc.postToChannel({
        organizationId: orgId,
        senderId,
        channelId: 'frontend',
        body: 'cross-channel reply',
        replyTo: parent.id,
      }),
    ).toThrow(/Cannot reply across channels/);
  });

  it('allows a reply whose parent is in the same channel', () => {
    const repo = newRepo();
    const svc = new ConversationService(repo, fakeRealtime);
    const { orgId, senderId } = seedOrg(repo);

    seedChannel(repo, orgId, 'general', [senderId]);

    const parent = MessageSchema.parse({
      id: randomUUID(),
      organizationId: orgId,
      threadId: 'general',
      channelId: 'general',
      senderId,
      senderKind: 'agent',
      kind: 'agent',
      content: 'parent',
      mentions: [],
      createdAt: new Date().toISOString(),
    });
    repo.saveMessage(parent);

    const reply = svc.postToChannel({
      organizationId: orgId,
      senderId,
      channelId: 'general',
      body: 'in-channel reply',
      replyTo: parent.id,
    });

    expect(reply.channelId).toBe('general');
    expect(reply.threadId).toBe('general');
  });

  it('top-level posts (no reply_to) still work', () => {
    const repo = newRepo();
    const svc = new ConversationService(repo, fakeRealtime);
    const { orgId, senderId } = seedOrg(repo);

    seedChannel(repo, orgId, 'general', [senderId]);

    const posted = svc.postToChannel({
      organizationId: orgId,
      senderId,
      channelId: 'general',
      body: 'hello',
    });

    expect(posted.channelId).toBe('general');
    expect(posted.threadId).toBe('general');
  });
});
