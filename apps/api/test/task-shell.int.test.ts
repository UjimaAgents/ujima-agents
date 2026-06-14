import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import type { LanguageModel } from 'ai';
import { MessageCardSchema } from '@ujima/shared';
import { makeTextModel } from './helpers/mock-language-models.js';
import { createTaskShellFixture as createFixture } from './helpers/task-shell-fixture.js';

describe('task shell integrations', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('posts task summary cards and link-backs when a task session completes', async () => {
    const fixture = await createFixture({
      modelResolver: () => makeTextModel('Ship the auth flow changes.'),
    });
    tempDirs.push(fixture.archiveRoot);

    const general = fixture.repo.getChannel(fixture.organizationId, 'general');
    expect(general).toBeDefined();

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'Ship the auth flow changes',
      team: ['frontend-alice'],
      origin: { channelId: general!.id },
    });

    const started = await fixture.taskSessions.start(fixture.organizationId, session.id, {
      runFirstTurn: true,
    });
    expect(started.session.status).toBe('completed');

    const taskMessages = fixture.repo.listChannelMessages(fixture.organizationId, session.channelId, {
      limit: 50,
    }).data;
    const summaryMessage = taskMessages.find((message) =>
      message.toolCalls.some((toolCall) => {
        try {
          return MessageCardSchema.parse(toolCall.args).kind === 'task.summary';
        } catch {
          return false;
        }
      }),
    );
    expect(summaryMessage).toBeDefined();
    const summaryCard = MessageCardSchema.parse(summaryMessage!.toolCalls[0]!.args);
    expect(summaryCard.kind).toBe('task.summary');
    if (summaryCard.kind === 'task.summary') {
      expect(summaryCard.outcome).toBe('completed');
      expect(summaryCard.taskSlug).toBe(session.slug);
    }

    const generalMessages = fixture.repo.listChannelMessages(fixture.organizationId, general!.id, {
      limit: 50,
    }).data;
    expect(generalMessages.some((message) => message.content.includes(`Task #${session.slug} completed`))).toBe(
      true,
    );
  });

  it('marks the session failed and posts a failed summary card when the worker model errors', async () => {
    const fixture = await createFixture({
      modelResolver: () =>
        new MockLanguageModelV3({
          doStream: async () => {
            throw new Error('provider unavailable');
          },
        }) as unknown as LanguageModel,
    });
    tempDirs.push(fixture.archiveRoot);

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'Fail loudly',
      team: ['frontend-alice'],
    });

    await expect(
      fixture.taskSessions.start(fixture.organizationId, session.id, { runFirstTurn: true }),
    ).rejects.toThrow();

    const refreshed = fixture.taskSessions.get(fixture.organizationId, session.id);
    expect(refreshed?.status).toBe('failed');

    const taskMessages = fixture.repo.listChannelMessages(fixture.organizationId, session.channelId, {
      limit: 50,
    }).data;
    const failedSummary = taskMessages.find((message) =>
      message.toolCalls.some((toolCall) => {
        try {
          const card = MessageCardSchema.parse(toolCall.args);
          return card.kind === 'task.summary' && card.outcome === 'failed';
        } catch {
          return false;
        }
      }),
    );
    expect(failedSummary).toBeDefined();
  });

});
