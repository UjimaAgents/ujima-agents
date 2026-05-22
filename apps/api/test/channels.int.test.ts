import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { ConversationService, SettingsService } from '@ujima/orchestrator';
import { ChannelRetentionService } from '../../../packages/orchestrator/src/services/channel-retention.js';
import { MessageSchema } from '@ujima/shared';
import { createOnboardedFixture } from './helpers/create-onboarded-fixture.js';

function createRealtimeCollector() {
  const events: Array<{ event: string; payload: Record<string, unknown>; rooms: string[] }> = [];
  return {
    events,
    emit(event: string, payload: { organizationId: string } & Record<string, unknown>, rooms: string[] = []) {
      events.push({ event, payload, rooms });
    },
  };
}

async function waitFor(assertion: () => void | Promise<void>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }
      await delay(20);
    }
  }
}

async function createFixture(
  options: { agentNames?: string[]; archiveRoot?: string; organizationName?: string } = {},
) {
  const base = await createOnboardedFixture({
    organizationName: options.organizationName ?? 'E3 Org',
    archiveRoot: options.archiveRoot,
    agentNames: options.agentNames,
  });
  const settings = new SettingsService(base.repo, base.teamStore);
  return { ...base, settings };
}

describe('E3 channels and mentions', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('creates self-channels on member spawn, auto-joins default channels, and hides other self channels from channel.list(all)', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);
    const agent = fixture.settings.addMember({
      organizationId: fixture.organizationId,
      name: 'frontend-alice',
      kind: 'agent',
      roleName: 'frontend-engineer',
    });

    const selfChannel = fixture.repo.getChannel(fixture.organizationId, `self:${agent.id}`);
    expect(selfChannel?.kind).toBe('self');
    expect(selfChannel?.memberIds).toEqual([agent.id]);
    expect(fixture.repo.getChannel(fixture.organizationId, 'general')?.memberIds).toContain(agent.id);
    expect(fixture.repo.getChannel(fixture.organizationId, 'frontend')?.memberIds).toContain(agent.id);

    const realtime = createRealtimeCollector();
    const conversations = new ConversationService(fixture.repo, realtime);
    conversations.sendSelfNote({
      organizationId: fixture.organizationId,
      memberId: agent.id,
      body: 'private thinking',
    });

    const selfMessages = fixture.repo.listChannelMessages(fixture.organizationId, `self:${agent.id}`, {
      limit: 10,
    }).data;
    expect(selfMessages.map((message) => message.content)).toContain('private thinking');

    const visibleToOwner = conversations.listVisibleChannels({
      organizationId: fixture.organizationId,
      memberId: fixture.ownerId,
      scope: 'all',
    });
    expect(visibleToOwner.some((channel) => channel.id === `self:${agent.id}`)).toBe(false);
  });

  it('lazy-creates DM channels on first send and reuses them on second send', async () => {
    const fixture = await createFixture({ agentNames: ['frontend-alice'] });
    tempDirs.push(fixture.archiveRoot);
    const realtime = createRealtimeCollector();
    const conversations = new ConversationService(fixture.repo, realtime);

    const first = conversations.sendDirectMessage({
      organizationId: fixture.organizationId,
      senderId: fixture.ownerId,
      recipientId: 'frontend-alice',
      content: 'first dm',
    });
    const second = conversations.sendDirectMessage({
      organizationId: fixture.organizationId,
      senderId: fixture.ownerId,
      recipientId: 'frontend-alice',
      content: 'second dm',
    });

    expect(first.channelId).toBe(second.channelId);
    const dmChannels = fixture.repo
      .listAllChannels(fixture.organizationId)
      .filter((channel) => channel.kind === 'dm');
    expect(dmChannels).toHaveLength(1);
    const dmMessages = fixture.repo.listChannelMessages(fixture.organizationId, first.channelId!, {
      limit: 10,
    }).data;
    expect(dmMessages).toHaveLength(2);
  });

  it('keeps DMs private to their participants in list, read, and post paths', async () => {
    const fixture = await createFixture({ agentNames: ['frontend-alice', 'frontend-bob'] });
    tempDirs.push(fixture.archiveRoot);
    const realtime = createRealtimeCollector();
    const conversations = new ConversationService(fixture.repo, realtime);

    const dm = conversations.sendDirectMessage({
      organizationId: fixture.organizationId,
      senderId: 'frontend-alice',
      recipientId: 'frontend-bob',
      content: 'private dm',
    });
    const dmChannelId = dm.channelId!;

    const ownerVisible = conversations.listVisibleChannels({
      organizationId: fixture.organizationId,
      memberId: fixture.ownerId,
      scope: 'all',
    });
    const aliceVisible = conversations.listVisibleChannels({
      organizationId: fixture.organizationId,
      memberId: 'frontend-alice',
      scope: 'all',
    });

    expect(ownerVisible.some((channel) => channel.id === dmChannelId)).toBe(false);
    expect(aliceVisible.some((channel) => channel.id === dmChannelId)).toBe(true);

    await expect(
      conversations.readChannel({
        organizationId: fixture.organizationId,
        memberId: fixture.ownerId,
        channelId: dmChannelId,
        limit: 10,
      }),
    ).rejects.toThrow(/channel not found/i);

    expect(() =>
      conversations.postToChannel({
        organizationId: fixture.organizationId,
        senderId: fixture.ownerId,
        channelId: dmChannelId,
        body: 'should not land',
      }),
    ).toThrow(/channel not found/i);
  });

  it('fans out mentions, wakes channel readers, and replies in the same channel', async () => {
    const fixture = await createFixture({ agentNames: ['frontend-alice', 'frontend-bob'] });
    tempDirs.push(fixture.archiveRoot);
    const realtime = createRealtimeCollector();
    const alerted: Array<{ memberId: string; wakeReason?: string }> = [];
    let conversations!: ConversationService;
    conversations = new ConversationService(fixture.repo, realtime, {
      onMemberAlerted: async (input) => {
        alerted.push({ memberId: input.memberId, wakeReason: input.wakeReason });
        await conversations.postToChannel({
          organizationId: input.organizationId,
          senderId: input.memberId,
          channelId: input.channelId ?? 'general',
          body: `ack from ${input.memberId}`,
        });
      },
    });

    const initial = conversations.postToChannel({
      organizationId: fixture.organizationId,
      senderId: fixture.ownerId,
      channelId: 'general',
      body: '@frontend-alice please take a look',
    });

    await waitFor(() => {
      const messages = fixture.repo.listChannelMessages(fixture.organizationId, 'general', { limit: 10 }).data;
      expect(messages).toHaveLength(3);
      expect(messages.some((message) => message.senderId === 'frontend-alice')).toBe(true);
      expect(messages.some((message) => message.senderId === 'frontend-bob')).toBe(true);
      expect(messages.some((message) => message.content === 'ack from frontend-alice')).toBe(true);
      expect(messages.some((message) => message.content === 'ack from frontend-bob')).toBe(true);
    });

    expect(alerted).toEqual([
      { memberId: 'frontend-alice', wakeReason: 'mention' },
      { memberId: 'frontend-bob', wakeReason: 'channel-read' },
    ]);
    const mentions = fixture.repo.listMessageMentions(initial.id);
    expect(mentions).toHaveLength(1);
    expect(mentions[0]?.memberId).toBe('frontend-alice');
    expect(realtime.events.some((event) => event.event === 'member.alerted')).toBe(true);
  });

  // Regression: mention fan-out used to wake any mentioned agent regardless
  // of whether they were a member of the channel where the message was
  // posted. Inside a DM that meant `@frontend-charlie` (not a participant)
  // would be woken and handed the private DM thread via onMemberAlerted —
  // a clear leak of a private 2-person conversation.
  it('does not wake non-participant agents from a mention inside a DM', async () => {
    const fixture = await createFixture({
      agentNames: ['frontend-alice', 'frontend-bob', 'frontend-charlie'],
    });
    tempDirs.push(fixture.archiveRoot);
    const realtime = createRealtimeCollector();
    const alerted: string[] = [];
    const conversations = new ConversationService(fixture.repo, realtime, {
      onMemberAlerted: async (input) => {
        alerted.push(input.memberId);
      },
    });

    // Alice opens a DM with Bob (membership: alice + bob).
    const dm = conversations.sendDirectMessage({
      organizationId: fixture.organizationId,
      senderId: 'frontend-alice',
      recipientId: 'frontend-bob',
      content: 'opening dm',
    });
    const dmChannelId = dm.channelId!;

    // Alice posts inside that DM and `@mentions` Charlie — who is NOT a
    // participant. Pre-fix, Charlie would have been alerted and the
    // onMemberAlerted callback would have handed her the DM channel id +
    // thread, leaking the conversation.
    conversations.postToChannel({
      organizationId: fixture.organizationId,
      senderId: 'frontend-alice',
      channelId: dmChannelId,
      body: '@frontend-charlie come look',
    });

    // Give the async fan-out a tick to complete (or fail to complete).
    await delay(50);

    expect(alerted).not.toContain('frontend-charlie');
    expect(
      realtime.events.some(
        (event) =>
          event.event === 'member.alerted' && event.payload.memberId === 'frontend-charlie',
      ),
    ).toBe(false);

    // Sanity: a same-channel mention to Bob (who IS a participant) still
    // works — we didn't accidentally suppress all DM mentions.
    conversations.postToChannel({
      organizationId: fixture.organizationId,
      senderId: 'frontend-alice',
      channelId: dmChannelId,
      body: '@frontend-bob ping',
    });
    await delay(50);
    expect(alerted).toContain('frontend-bob');
  });

  // Regression: a mention inside an agent's self-channel must never wake
  // anyone — self-channels are private scratchpads.
  it('does not wake anyone from a mention inside a self channel', async () => {
    const fixture = await createFixture({ agentNames: ['frontend-alice', 'frontend-bob'] });
    tempDirs.push(fixture.archiveRoot);
    const realtime = createRealtimeCollector();
    const alerted: string[] = [];
    const conversations = new ConversationService(fixture.repo, realtime, {
      onMemberAlerted: async (input) => {
        alerted.push(input.memberId);
      },
    });

    const aliceSelf = conversations
      .listVisibleChannels({
        organizationId: fixture.organizationId,
        memberId: 'frontend-alice',
        scope: 'all',
      })
      .find((channel) => channel.kind === 'self');
    expect(aliceSelf).toBeDefined();

    conversations.postToChannel({
      organizationId: fixture.organizationId,
      senderId: 'frontend-alice',
      channelId: aliceSelf!.id,
      body: '@frontend-bob shouldnt be alerted from my notes',
    });
    await delay(50);

    expect(alerted).toEqual([]);
  });

  it('throttles the 11th mention in 60 seconds and posts a system message to general', async () => {
    const fixture = await createFixture({ agentNames: ['frontend-alice'] });
    tempDirs.push(fixture.archiveRoot);
    const realtime = createRealtimeCollector();
    const alerted: string[] = [];
    const conversations = new ConversationService(fixture.repo, realtime, {
      onMemberAlerted: async (input) => {
        alerted.push(input.memberId);
      },
    });

    for (let index = 0; index < 11; index += 1) {
      conversations.postToChannel({
        organizationId: fixture.organizationId,
        senderId: fixture.ownerId,
        channelId: 'general',
        body: `@frontend-alice ping ${index}`,
      });
    }

    await waitFor(() => {
      const generalMessages = fixture.repo.listChannelMessages(fixture.organizationId, 'general', {
        limit: 20,
      }).data;
      expect(generalMessages.some((message) => message.kind === 'system')).toBe(true);
    });

    expect(alerted).toHaveLength(10);
    const throttled = fixture.repo.listChannelMessages(fixture.organizationId, 'general', {
      limit: 20,
    }).data.find((message) => message.kind === 'system');
    expect(throttled?.content).toMatch(/member\.alert_throttled/i);
  });

  it('archives retained messages and channel.read search still finds archived rows', async () => {
    const fixture = await createFixture({ agentNames: ['frontend-alice'] });
    tempDirs.push(fixture.archiveRoot);
    const realtime = createRealtimeCollector();
    const retention = new ChannelRetentionService(fixture.repo, fixture.archiveRoot);
    const conversations = new ConversationService(fixture.repo, realtime, {
      archiveStore: retention,
    });

    fixture.repo.ensureThread({
      id: 'general',
      organizationId: fixture.organizationId,
      channelId: 'general',
      title: 'general',
      memberIds: [fixture.ownerId, 'frontend-alice'],
      createdAt: new Date().toISOString(),
    });

    conversations.publishMessage(
      MessageSchema.parse({
        id: randomUUID(),
        organizationId: fixture.organizationId,
        threadId: 'general',
        channelId: 'general',
        senderId: fixture.ownerId,
        senderKind: 'human',
        kind: 'human',
        content: 'archived needle',
        createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      [],
    );
    conversations.postToChannel({
      organizationId: fixture.organizationId,
      senderId: fixture.ownerId,
      channelId: 'general',
      body: 'recent hay',
    });

    const archiveResult = await retention.archiveExpiredMessages(fixture.organizationId, new Date());
    expect(archiveResult.archivedMessages).toBe(1);
    expect(fixture.repo.listChannelMessages(fixture.organizationId, 'general', { limit: 10 }).data).toHaveLength(1);

    const search = await conversations.readChannel({
      organizationId: fixture.organizationId,
      memberId: fixture.ownerId,
      channelId: 'general',
      query: 'needle',
      limit: 10,
    });
    expect(search.data.some((message) => message.content.includes('archived needle'))).toBe(true);
  });

  it('searches live channel messages through FTS', async () => {
    const fixture = await createFixture({ agentNames: ['frontend-alice'] });
    tempDirs.push(fixture.archiveRoot);
    const realtime = createRealtimeCollector();
    const conversations = new ConversationService(fixture.repo, realtime);

    fixture.repo.ensureThread({
      id: 'general',
      organizationId: fixture.organizationId,
      channelId: 'general',
      title: 'general',
      memberIds: [fixture.ownerId, 'frontend-alice'],
      createdAt: new Date().toISOString(),
    });

    conversations.postToChannel({
      organizationId: fixture.organizationId,
      senderId: fixture.ownerId,
      channelId: 'general',
      body: 'release search needle',
    });

    const search = await conversations.readChannel({
      organizationId: fixture.organizationId,
      memberId: fixture.ownerId,
      channelId: 'general',
      query: 'needle',
      limit: 10,
    });

    expect(search.data.map((message) => message.content)).toContain('release search needle');
  });

  it('keeps retained archives isolated by organization even when channel ids match', async () => {
    const sharedArchiveRoot = await mkdtemp(join(tmpdir(), 'ujima-e3-shared-archive-'));
    tempDirs.push(sharedArchiveRoot);

    const first = await createFixture({
      archiveRoot: sharedArchiveRoot,
      organizationName: 'Org One',
    });
    const second = await createFixture({
      archiveRoot: sharedArchiveRoot,
      organizationName: 'Org Two',
    });

    const firstRetention = new ChannelRetentionService(first.repo, sharedArchiveRoot);
    const secondRetention = new ChannelRetentionService(second.repo, sharedArchiveRoot);

    first.repo.ensureThread({
      id: 'general',
      organizationId: first.organizationId,
      channelId: 'general',
      title: 'general',
      memberIds: [first.ownerId],
      createdAt: new Date().toISOString(),
    });
    second.repo.ensureThread({
      id: 'general',
      organizationId: second.organizationId,
      channelId: 'general',
      title: 'general',
      memberIds: [second.ownerId],
      createdAt: new Date().toISOString(),
    });

    first.repo.saveMessage(
      MessageSchema.parse({
        id: randomUUID(),
        organizationId: first.organizationId,
        threadId: 'general',
        channelId: 'general',
        senderId: first.ownerId,
        senderKind: 'human',
        kind: 'human',
        content: 'org-one-only needle',
        createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    );
    second.repo.saveMessage(
      MessageSchema.parse({
        id: randomUUID(),
        organizationId: second.organizationId,
        threadId: 'general',
        channelId: 'general',
        senderId: second.ownerId,
        senderKind: 'human',
        kind: 'human',
        content: 'org-two-only needle',
        createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    );

    await firstRetention.archiveExpiredMessages(first.organizationId, new Date());
    await secondRetention.archiveExpiredMessages(second.organizationId, new Date());

    const firstSearch = await firstRetention.searchChannelMessages({
      organizationId: first.organizationId,
      channelId: 'general',
      query: 'needle',
      limit: 10,
    });
    const secondSearch = await secondRetention.searchChannelMessages({
      organizationId: second.organizationId,
      channelId: 'general',
      query: 'needle',
      limit: 10,
    });

    expect(firstSearch.data.map((message) => message.content)).toEqual(['org-one-only needle']);
    expect(secondSearch.data.map((message) => message.content)).toEqual(['org-two-only needle']);
  });

  it('recomputes typed mentions when a message body is edited', async () => {
    const fixture = await createFixture({ agentNames: ['frontend-alice', 'frontend-bob'] });
    tempDirs.push(fixture.archiveRoot);
    const realtime = createRealtimeCollector();
    const conversations = new ConversationService(fixture.repo, realtime);

    fixture.repo.ensureThread({
      id: 'general',
      organizationId: fixture.organizationId,
      channelId: 'general',
      title: 'general',
      memberIds: [fixture.ownerId, 'frontend-alice', 'frontend-bob'],
      createdAt: new Date().toISOString(),
    });

    const message = conversations.postToChannel({
      organizationId: fixture.organizationId,
      senderId: fixture.ownerId,
      channelId: 'general',
      body: '@frontend-alice first draft',
    });
    expect(fixture.repo.listMessageMentions(message.id).map((mention) => mention.memberId)).toEqual([
      'frontend-alice',
    ]);

    const edited = conversations.editMessage({
      organizationId: fixture.organizationId,
      messageId: message.id,
      editorId: fixture.ownerId,
      content: '@frontend-bob revised draft',
    });

    expect(edited.mentions).toEqual(['frontend-bob']);
    expect(fixture.repo.getMessage(fixture.organizationId, message.id)?.mentions).toEqual([
      'frontend-bob',
    ]);
    expect(fixture.repo.listMessageMentions(message.id).map((mention) => mention.memberId)).toEqual([
      'frontend-bob',
    ]);
  });

  it('edits and deletes with tombstones while preserving immutable tool-call cards', async () => {
    const fixture = await createFixture({ agentNames: ['frontend-alice'] });
    tempDirs.push(fixture.archiveRoot);
    const realtime = createRealtimeCollector();
    const conversations = new ConversationService(fixture.repo, realtime);

    fixture.repo.ensureThread({
      id: 'general',
      organizationId: fixture.organizationId,
      channelId: 'general',
      title: 'general',
      memberIds: [fixture.ownerId, 'frontend-alice'],
      createdAt: new Date().toISOString(),
    });

    const message = conversations.publishMessage(
      MessageSchema.parse({
        id: randomUUID(),
        organizationId: fixture.organizationId,
        threadId: 'general',
        channelId: 'general',
        senderId: fixture.ownerId,
        senderKind: 'human',
        kind: 'human',
        content: 'original',
        toolCalls: [
          {
            toolCallId: 'tc-1',
            toolName: 'filesystem',
            args: { path: 'apps/web/index.ts' },
          },
        ],
        createdAt: new Date().toISOString(),
      }),
      [],
    );

    const edited = conversations.editMessage({
      organizationId: fixture.organizationId,
      messageId: message.id,
      editorId: fixture.ownerId,
      content: 'edited',
    });
    expect(edited.content).toBe('edited');
    expect(edited.editedAt).toBeTruthy();
    expect(edited.toolCalls).toEqual(message.toolCalls);

    const deleted = conversations.deleteMessage({
      organizationId: fixture.organizationId,
      messageId: message.id,
      deletedBy: fixture.ownerId,
    });
    expect(deleted.deletedAt).toBeTruthy();
    expect(deleted.toolCalls).toEqual(message.toolCalls);
    expect(fixture.repo.getMessage(fixture.organizationId, message.id)?.toolCalls).toEqual(message.toolCalls);
  });

  // Regression: ChannelRetentionService used to build archive paths with
  // `path.join(archiveRoot, 'archives', 'channels', orgId, channelId)`
  // without sanitization. `IdSchema` only requires a non-empty string, so
  // a config-supplied channel id like `../../../tmp/pwn` would let
  // appendFile/readdir operate on attacker-chosen filesystem locations
  // outside `archiveRoot`. The fix sanitizes each segment AND asserts the
  // resolved path stays under `<archiveRoot>/archives/channels/`.
  it('rejects archive operations whose channel id contains path-separator characters', async () => {
    const fixture = await createFixture({ agentNames: ['frontend-alice'] });
    tempDirs.push(fixture.archiveRoot);
    const retention = new ChannelRetentionService(fixture.repo, fixture.archiveRoot);

    const malicious = ['../escape', '..', '.hidden', 'foo/bar', 'foo\\bar'];

    for (const channelId of malicious) {
      // Read paths swallow the rejection and return an empty page (a
      // malformed read shouldn't 500 the daemon).
      const empty = await retention.listChannelMessages({
        organizationId: fixture.organizationId,
        channelId,
        limit: 10,
      });
      expect(empty.data).toEqual([]);
      expect(empty.hasMore).toBe(false);

      const search = await retention.searchChannelMessages({
        organizationId: fixture.organizationId,
        channelId,
        query: 'anything',
        limit: 10,
      });
      expect(search.data).toEqual([]);
    }

    // The archive write path doesn't take a caller-supplied channel id
    // directly — it iterates `repo.listAllChannels`. We plant an evil
    // channel + thread + expired message in the DB to trigger the write
    // path and confirm the sanitizer throws (instead of silently writing
    // outside `<archiveRoot>/archives/channels/`).
    const evilChannelId = '../../tmp/pwn-' + randomUUID();
    fixture.repo.saveChannel({
      id: evilChannelId,
      organizationId: fixture.organizationId,
      name: 'evil',
      kind: 'general',
      topic: '',
      memberIds: [],
    });
    fixture.repo.ensureThread({
      id: evilChannelId,
      organizationId: fixture.organizationId,
      channelId: evilChannelId,
      title: 'evil-thread',
      memberIds: [],
      createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
    });
    fixture.repo.saveMessage(
      MessageSchema.parse({
        id: randomUUID(),
        organizationId: fixture.organizationId,
        threadId: evilChannelId,
        channelId: evilChannelId,
        senderId: fixture.ownerId,
        senderKind: 'human',
        kind: 'human',
        content: 'should never reach disk outside archiveRoot',
        createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    );

    await expect(
      retention.archiveExpiredMessages(fixture.organizationId),
    ).rejects.toThrow(/illegal path separator|cannot start with|archive path escape/i);
  });

  // Regression: mergePaginatedMessages used to emit `nextCursor =
  // data[0].createdAt` and sort the merged live+archived stream by
  // timestamp only. Two messages sharing the same millisecond — one live,
  // one archived — could fall on opposite sides of the page boundary, and
  // the bare-timestamp cursor would skip whichever landed on the boundary
  // row's id-tail. Composite `${createdAt}|${id}` cursors + (createdAt, id)
  // sort fix the gap, mirroring the SQL paginators.
  it('readChannel page boundary across live + archived messages preserves same-millisecond rows', async () => {
    const fixture = await createFixture({ agentNames: ['frontend-alice'] });
    tempDirs.push(fixture.archiveRoot);
    const realtime = createRealtimeCollector();

    const sharedTs = '2026-04-27T08:00:00.000Z';

    fixture.repo.ensureThread({
      id: 'general',
      organizationId: fixture.organizationId,
      channelId: 'general',
      title: 'general',
      memberIds: [fixture.ownerId],
      createdAt: sharedTs,
    });

    // Two live messages on the same millisecond.
    const liveA = MessageSchema.parse({
      id: 'msg-live-a',
      organizationId: fixture.organizationId,
      threadId: 'general',
      channelId: 'general',
      senderId: fixture.ownerId,
      senderKind: 'human',
      kind: 'human',
      content: 'live a',
      mentions: [],
      createdAt: sharedTs,
    });
    const liveB = MessageSchema.parse({
      id: 'msg-live-b',
      organizationId: fixture.organizationId,
      threadId: 'general',
      channelId: 'general',
      senderId: fixture.ownerId,
      senderKind: 'human',
      kind: 'human',
      content: 'live b',
      mentions: [],
      createdAt: sharedTs,
    });
    fixture.repo.saveMessage(liveA);
    fixture.repo.saveMessage(liveB);

    // One archived message on the same millisecond — surfaced by a tiny
    // stub archive store so this test stays focused on the merger.
    const archivedC = MessageSchema.parse({
      id: 'msg-archived-c',
      organizationId: fixture.organizationId,
      threadId: 'general',
      channelId: 'general',
      senderId: fixture.ownerId,
      senderKind: 'human',
      kind: 'human',
      content: 'archived c',
      mentions: [],
      createdAt: sharedTs,
    });
    const archiveStore = {
      async listChannelMessages() {
        return { data: [archivedC], hasMore: false, nextCursor: undefined };
      },
      async searchChannelMessages() {
        return { data: [archivedC], hasMore: false, nextCursor: undefined };
      },
    };

    const conversations = new ConversationService(fixture.repo, realtime, {
      archiveStore,
    });

    const page1 = await conversations.readChannel({
      organizationId: fixture.organizationId,
      memberId: fixture.ownerId,
      channelId: 'general',
      limit: 2,
    });
    expect(page1.data).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeDefined();
    // Composite cursor format — `${createdAt}|${id}`.
    expect(page1.nextCursor).toMatch(/\|/);

    const page2 = await conversations.readChannel({
      organizationId: fixture.organizationId,
      memberId: fixture.ownerId,
      channelId: 'general',
      limit: 2,
      cursor: page1.nextCursor,
    });

    const allIds = [...page1.data.map((m) => m.id), ...page2.data.map((m) => m.id)].sort();
    expect(allIds).toEqual(['msg-archived-c', 'msg-live-a', 'msg-live-b']);
  });

  // Race-safety regression: when two concurrent POSTs share a
  // clientMessageId, `findMessageByClientId` may report "no existing"
  // for both. The first commit wins migration 021's UNIQUE partial
  // index; the second's saveMessage recovers by returning the WINNER
  // row (different `id`, since the request gets a fresh server-side
  // uuid). publishMessage must detect that dedupe and return early
  // — otherwise mention replacement, attachment linking, realtime
  // emit, and wake fanout all reference an id that was never
  // persisted, and worse, double-notify agents whose first wake
  // already fired for the winner.
  it('publishMessage skips realtime emit + side effects on a clientMessageId dedupe', async () => {
    const fixture = await createFixture({ agentNames: ['frontend-alice'] });
    tempDirs.push(fixture.archiveRoot);
    const realtime = createRealtimeCollector();
    const conversations = new ConversationService(fixture.repo, realtime);

    fixture.repo.ensureThread({
      id: 'general',
      organizationId: fixture.organizationId,
      channelId: 'general',
      title: 'general',
      memberIds: [fixture.ownerId, 'frontend-alice'],
      createdAt: new Date().toISOString(),
    });

    const sharedClientMessageId = 'retry-token-race';

    const winner = conversations.publishMessage(
      MessageSchema.parse({
        id: 'msg-winner',
        organizationId: fixture.organizationId,
        threadId: 'general',
        channelId: 'general',
        senderId: fixture.ownerId,
        senderKind: 'human',
        kind: 'human',
        content: 'first to commit',
        mentions: [],
        clientMessageId: sharedClientMessageId,
        createdAt: '2026-05-04T19:07:01.000Z',
      }),
      [],
    );
    const eventsAfterWinner = realtime.events.length;
    expect(winner.id).toBe('msg-winner');
    expect(eventsAfterWinner).toBeGreaterThan(0);

    // Second arrival with the SAME idempotency key but a fresh
    // server-generated id — emulates the loser of a concurrent retry.
    const loser = conversations.publishMessage(
      MessageSchema.parse({
        id: 'msg-loser',
        organizationId: fixture.organizationId,
        threadId: 'general',
        channelId: 'general',
        senderId: fixture.ownerId,
        senderKind: 'human',
        kind: 'human',
        content: 'second arrival',
        mentions: [],
        clientMessageId: sharedClientMessageId,
        createdAt: '2026-05-04T19:07:01.050Z',
      }),
      [],
    );

    // The dedupe must return the winner row (not the loser's payload).
    expect(loser.id).toBe('msg-winner');
    expect(loser.content).toBe('first to commit');
    // No additional realtime emit fired for the deduped attempt —
    // agents that already woke for the winner must NOT be re-woken.
    expect(realtime.events.length).toBe(eventsAfterWinner);
    // Only one persisted row — the winner.
    expect(fixture.repo.getMessage(fixture.organizationId, 'msg-loser')).toBeNull();
    expect(fixture.repo.getMessage(fixture.organizationId, 'msg-winner')?.content).toBe(
      'first to commit',
    );
  });

  // Access-control regression: the clientMessageId fast-path used to
  // return the cached row BEFORE any writable-channel / thread-access
  // validation ran. A member who posted with key X, then lost channel
  // access (member removed, channel archived), could re-POST the same
  // key and still receive the cached message — an access-control
  // leak. Now `requireWritableChannel` runs FIRST, so the second send
  // rejects with the same error a fresh send would, regardless of
  // whether a cached row exists under that key.
  it('rejects a clientMessageId replay against a channel that has since been archived', async () => {
    const fixture = await createFixture({ agentNames: ['frontend-alice'] });
    tempDirs.push(fixture.archiveRoot);
    const realtime = createRealtimeCollector();
    const conversations = new ConversationService(fixture.repo, realtime);

    fixture.repo.ensureThread({
      id: 'general',
      organizationId: fixture.organizationId,
      channelId: 'general',
      title: 'general',
      memberIds: [fixture.ownerId, 'frontend-alice'],
      createdAt: new Date().toISOString(),
    });

    const sharedClientMessageId = 'retry-after-archive';

    const first = conversations.sendMessage({
      organizationId: fixture.organizationId,
      threadId: 'general',
      channelId: 'general',
      senderId: fixture.ownerId,
      content: 'before archive',
      clientMessageId: sharedClientMessageId,
    });
    expect(first.content).toBe('before archive');

    // Archive the channel — `requireActiveChannel` rejects archived
    // channels, which is what `requireWritableChannel` reaches before
    // the dedupe shortcut now runs.
    const general = fixture.repo.getChannel(fixture.organizationId, 'general')!;
    fixture.repo.saveChannel({
      ...general,
      archivedAt: new Date().toISOString(),
    });

    // The retry must NOT hand back the cached row. Pre-fix the
    // shortcut returned `first` here; post-fix the writability check
    // throws before the lookup runs.
    expect(() =>
      conversations.sendMessage({
        organizationId: fixture.organizationId,
        threadId: 'general',
        channelId: 'general',
        senderId: fixture.ownerId,
        content: 'after archive',
        clientMessageId: sharedClientMessageId,
      }),
    ).toThrow(/Channel is archived/);
  });
});
