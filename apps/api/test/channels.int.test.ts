import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '@ujima/context-store';
import {
  ConversationService,
  OnboardingService,
  SettingsService,
  createTeamStore,
} from '@ujima/orchestrator';
import { ChannelRetentionService } from '../../../packages/orchestrator/src/services/channel-retention.js';
import { Repository } from '@ujima/runtime-core';
import { MessageSchema } from '@ujima/shared';

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
  const archiveRoot = options.archiveRoot ?? (await mkdtemp(join(tmpdir(), 'ujima-e3-archive-')));
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const teamStore = createTeamStore();
  const onboarding = new OnboardingService(repo, teamStore);
  const settings = new SettingsService(repo, teamStore);
  const result = await onboarding.onboard({
    organizationName: options.organizationName ?? 'E3 Org',
    ownerName: 'Owner',
    workspaceRoot: archiveRoot,
    providerKeys: {},
    team: {
      name: options.organizationName ?? 'E3 Org',
      channels: [
        { name: 'general', kind: 'general', topic: 'General' },
        { name: 'frontend', kind: 'group', topic: 'Frontend' },
      ],
      roles: [
        {
          name: 'frontend-engineer',
          title: 'Frontend Engineer',
          instructions: 'Build frontend',
          workspaceScopes: ['apps/web'],
          tools: ['filesystem'],
          channels: ['general', 'frontend'],
        },
      ],
      agents: (options.agentNames ?? []).map((name) => ({
        name,
        roleName: 'frontend-engineer',
        personalityName: 'direct',
      })),
    },
  });

  const owner = result.members.find((member) => member.kind === 'human');
  if (!owner) {
    throw new Error('owner missing from onboarding result');
  }

  return {
    archiveRoot,
    repo,
    teamStore,
    onboarding,
    settings,
    organizationId: result.organization.id,
    ownerId: owner.id,
  };
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

  it('fans out mentions, wakes only the mentioned agent, and replies in the same channel', async () => {
    const fixture = await createFixture({ agentNames: ['frontend-alice', 'frontend-bob'] });
    tempDirs.push(fixture.archiveRoot);
    const realtime = createRealtimeCollector();
    const alerted: string[] = [];
    let conversations!: ConversationService;
    conversations = new ConversationService(fixture.repo, realtime, {
      onMemberAlerted: async (input) => {
        alerted.push(input.memberId);
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
      expect(messages).toHaveLength(2);
      expect(messages.some((message) => message.senderId === 'frontend-alice')).toBe(true);
      expect(messages.some((message) => message.content === 'ack from frontend-alice')).toBe(true);
    });

    expect(alerted).toEqual(['frontend-alice']);
    const mentions = fixture.repo.listMessageMentions(initial.id);
    expect(mentions).toHaveLength(1);
    expect(mentions[0]?.memberId).toBe('frontend-alice');
    expect(realtime.events.some((event) => event.event === 'member.alerted')).toBe(true);
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
});
