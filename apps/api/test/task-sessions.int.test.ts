import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '@ujima/context-store';
import { Repository } from '@ujima/runtime-core';
import {
  ConversationService,
  OnboardingService,
  TaskSessionService,
  createTeamStore,
} from '@ujima/orchestrator';
import { MessageCardSchema } from '@ujima/shared';

// Phase 1 of the unified task shell: integration coverage for the
// `TaskSessionService.create` lifecycle, the human-only origination
// invariant, the origin-link card on the source channel, the join
// system message inside the new task-run channel, and the generic
// `MessageCard` payload riding on `messages.tool_calls`.
//
// Worker / supervisor / promoter behaviours are explicitly out of
// scope for these tests — they ship in Phase 2/3.

function noopRealtime() {
  return { emit: () => undefined };
}

async function createFixture(opts: { agentNames?: string[] } = {}) {
  const archiveRoot = await mkdtemp(join(tmpdir(), 'ujima-task-shell-'));
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const teamStore = createTeamStore();
  const onboarding = new OnboardingService(repo, teamStore);
  const result = await onboarding.onboard({
    organizationName: 'Phase 1 Org',
    ownerName: 'Owner',
    ownerEmail: 'owner@example.com',
    ownerPassword: 'correct horse battery staple',
    workspaceRoot: archiveRoot,
    providerKeys: {},
    team: {
      channels: [
        { name: 'general', kind: 'general', topic: 'General' },
        { name: 'frontend', kind: 'group', topic: 'Frontend' },
      ],
      roles: [
        {
          name: 'frontend-engineer',
          title: 'Frontend Engineer',
          instructions: 'Build the frontend',
          workspaceScopes: ['apps/web'],
          tools: ['filesystem'],
          channels: ['general', 'frontend'],
        },
      ],
      agents: (opts.agentNames ?? ['frontend-alice', 'frontend-bob']).map((name) => ({
        name,
        roleName: 'frontend-engineer',
        personalityName: 'direct',
      })),
    },
  });
  const owner = result.members.find((m) => m.kind === 'human');
  if (!owner) throw new Error('owner missing');
  const conversations = new ConversationService(repo, noopRealtime());
  const taskSessions = new TaskSessionService(repo, conversations);
  return {
    archiveRoot,
    repo,
    conversations,
    taskSessions,
    organizationId: result.organization.id,
    ownerId: owner.id,
  };
}

describe('TaskSessionService — Phase 1 task shell', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('creates a task-run channel + auto-joins members + posts a join system card', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const { session, channel } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'Wire up the new sign-up flow',
      team: ['frontend-alice', 'frontend-bob'],
    });

    // 1. Session row persisted with the right shape.
    expect(session.status).toBe('queued');
    expect(session.executionMode).toBe('concurrent');
    expect(session.teamMemberIds.sort()).toEqual(['frontend-alice', 'frontend-bob']);
    expect(session.channelId).toBe(channel?.id);

    // 2. Task-run channel exists and is auto-joined by everyone.
    expect(channel?.kind).toBe('task-run');
    expect(channel?.memberIds.sort()).toEqual(
      [fixture.ownerId, 'frontend-alice', 'frontend-bob'].sort(),
    );
    expect(channel?.name).toBe(`#${session.slug}`);

    // 3. Join system message lives in the new channel and carries a
    //    valid `task.join` MessageCard payload on `tool_calls[0].args`.
    const messages = fixture.repo.listChannelMessages(fixture.organizationId, session.channelId, {
      limit: 50,
    }).data;
    expect(messages.length).toBe(1);
    const joinMessage = messages[0]!;
    expect(joinMessage.kind).toBe('system');
    expect(joinMessage.content).toContain('joined');
    expect(joinMessage.toolCalls).toHaveLength(1);

    const card = MessageCardSchema.parse(joinMessage.toolCalls[0]!.args);
    expect(card.kind).toBe('task.join');
    if (card.kind === 'task.join') {
      expect(card.taskSessionId).toBe(session.id);
      expect(card.memberIds.sort()).toEqual(channel!.memberIds.sort());
    }
  });

  it('rejects agent-originated task sessions (only humans can originate)', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    expect(() =>
      fixture.taskSessions.create({
        organizationId: fixture.organizationId,
        requestedBy: 'frontend-alice',
        prompt: 'Trying to spawn a task as an agent',
        team: ['frontend-bob'],
      }),
    ).toThrow(/only human members can originate tasks/i);

    // No task-run channel should have been created on the failed call.
    const channels = fixture.repo.listAllChannels(fixture.organizationId);
    expect(channels.some((c) => c.kind === 'task-run')).toBe(false);
  });

  it('posts an origin link-back card in the source channel when origin is supplied', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const general = fixture.repo.getChannel(fixture.organizationId, 'general')!;

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'From a #general thread',
      team: ['frontend-alice'],
      origin: { channelId: general.id },
    });

    const generalMessages = fixture.repo.listChannelMessages(fixture.organizationId, general.id, {
      limit: 50,
    }).data;
    const linkBack = generalMessages.find((m) => m.kind === 'system');
    expect(linkBack).toBeDefined();
    expect(linkBack!.content).toContain(session.slug);

    const card = MessageCardSchema.parse(linkBack!.toolCalls[0]!.args);
    expect(card.kind).toBe('task.origin-link');
    if (card.kind === 'task.origin-link') {
      expect(card.taskChannelId).toBe(session.channelId);
      expect(card.taskSlug).toBe(session.slug);
    }
  });

  it('rejects retired team members and unknown ids before creating the channel', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    // Unknown id
    expect(() =>
      fixture.taskSessions.create({
        organizationId: fixture.organizationId,
        requestedBy: fixture.ownerId,
        prompt: 'p',
        team: ['ghost-agent'],
      }),
    ).toThrow(/team member not found/i);

    // Retired member
    const alice = fixture.repo.getMember(fixture.organizationId, 'frontend-alice')!;
    fixture.repo.saveMember({ ...alice, retiredAt: new Date().toISOString() });

    expect(() =>
      fixture.taskSessions.create({
        organizationId: fixture.organizationId,
        requestedBy: fixture.ownerId,
        prompt: 'p',
        team: ['frontend-alice'],
      }),
    ).toThrow(/cannot include retired member/i);

    // Neither failed call should have left a task-run channel behind.
    const channels = fixture.repo.listAllChannels(fixture.organizationId);
    expect(channels.some((c) => c.kind === 'task-run')).toBe(false);
  });

  it('list() returns sessions newest-first with pagination + status filter', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const slugs: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const { session } = fixture.taskSessions.create({
        organizationId: fixture.organizationId,
        requestedBy: fixture.ownerId,
        prompt: `task ${i}`,
        team: ['frontend-alice'],
        slug: `task-${i}`,
      });
      slugs.push(session.slug);
      // Same-millisecond writes need a deterministic tiebreaker — leaning
      // on the (createdAt, id) composite cursor that listTaskSessions
      // emits. A small wait keeps the order test deterministic without
      // relying on the cursor logic.
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const all = fixture.taskSessions.list(fixture.organizationId, { limit: 10 });
    expect(all.data.map((s) => s.slug)).toEqual([...slugs].reverse());

    // Status filter only includes matching rows.
    fixture.taskSessions.updateStatus(
      fixture.organizationId,
      all.data[1]!.id,
      'completed',
      { summary: 'done', completedAt: new Date().toISOString() },
    );
    const completed = fixture.taskSessions.list(fixture.organizationId, { status: 'completed' });
    expect(completed.data.map((s) => s.status)).toEqual(['completed']);

    // Pagination boundary.
    const page1 = fixture.taskSessions.list(fixture.organizationId, { limit: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeDefined();
    const page2 = fixture.taskSessions.list(fixture.organizationId, {
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.data).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
  });

  it('slug collision falls through to a suffixed slug instead of throwing', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'Wire up auth',
      team: ['frontend-alice'],
      slug: 'wire-up-auth',
    });
    const second = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'Wire up auth',
      team: ['frontend-bob'],
      slug: 'wire-up-auth',
    });

    expect(second.session.slug).not.toBe('wire-up-auth');
    expect(second.session.slug.startsWith('wire-up-auth-')).toBe(true);
  });
});
