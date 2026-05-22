import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import type { LanguageModel } from 'ai';
import { TaskPromoterService, TaskSessionService } from '@ujima/orchestrator';
import { MessageCardSchema, MessageSchema } from '@ujima/shared';
import { makeFilesystemToolCallModel, makeTextModel } from './helpers/mock-language-models.js';
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

  it('aggregates active agents, token usage, and tool usage in run detail for spirit-backed runs', async () => {
    const fixture = await createFixture({
      modelResolver: () => makeFilesystemToolCallModel(),
    });
    tempDirs.push(fixture.archiveRoot);

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'Audit the README',
      team: ['frontend-alice'],
    });

    await fixture.taskSessions.start(fixture.organizationId, session.id, {
      runFirstTurn: true,
    });

    const spirit = fixture.repo.listSpiritsForSession(fixture.organizationId, session.id)[0];
    expect(spirit?.runId).toBeDefined();
    for (let index = 0; index < 505; index += 1) {
      fixture.conversations.publishMessage(
        MessageSchema.parse({
          id: `bulk-${index}`,
          organizationId: fixture.organizationId,
          threadId: session.channelId,
          channelId: session.channelId,
          senderId: fixture.ownerId,
          senderKind: 'human',
          kind: 'human',
          content: `bulk task history ${index}`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        }),
        [],
      );
    }

    const detail = fixture.runs.getRunDetail(fixture.organizationId, spirit!.runId!);
    expect(detail).not.toBeNull();
    expect(detail?.tokens.perMemberId['frontend-alice']).toBeGreaterThan(0);
    expect(detail?.tools.filesystem?.count).toBe(1);
    expect(detail?.tools.filesystem?.pending).toBe(0);
    expect(detail?.messages.some((message) => message.content === 'bulk task history 0')).toBe(true);
    expect(detail?.messages.some((message) => message.content === 'bulk task history 504')).toBe(true);
  });

  it('auto-promotes a confident human message into a task session and audits the decision', async () => {
    const fixture = await createFixture({
      promoterEvaluator: async () => ({
        decision: 'promote',
        confidence: 0.92,
        team: ['frontend-alice'],
        rationale: 'clear multi-step implementation request',
      }),
    });
    tempDirs.push(fixture.archiveRoot);

    const message = fixture.conversations.sendMessage({
      organizationId: fixture.organizationId,
      threadId: 'general',
      channelId: 'general',
      senderId: fixture.ownerId,
      content: 'Implement the new auth flow and report back',
    });

    const outcome = await fixture.taskPromoter.handlePostedMessage({
      organizationId: fixture.organizationId,
      messageId: message.id,
    });

    expect(outcome?.decision).toBe('promote');
    const sessions = fixture.repo.listTaskSessions(fixture.organizationId, { limit: 20 }).data;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.origin.messageId).toBe(message.id);

    const audit = fixture.repo
      .listAuditEvents(fixture.organizationId)
      .find((event) => event.action === 'audit.task_promoter');
    expect(audit?.metadata.decision).toBe('promote');
  });

  it('marks auto-started promoted sessions failed when start throws', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);
    const taskPromoter = new TaskPromoterService(fixture.repo, fixture.runs, {
      taskSessions: {
        create: fixture.taskSessions.create.bind(fixture.taskSessions),
        start: async () => {
          throw new Error('member retired before start');
        },
        updateStatus: fixture.taskSessions.updateStatus.bind(fixture.taskSessions),
      } as TaskSessionService,
      evaluator: async () => ({
        decision: 'promote',
        confidence: 0.93,
        team: ['frontend-alice'],
        rationale: 'clear implementation request',
      }),
      autoStart: true,
    });

    const message = fixture.conversations.sendMessage({
      organizationId: fixture.organizationId,
      threadId: 'general',
      channelId: 'general',
      senderId: fixture.ownerId,
      content: 'Implement the auth flow now',
    });

    const outcome = await taskPromoter.handlePostedMessage({
      organizationId: fixture.organizationId,
      messageId: message.id,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const session = fixture.taskSessions.get(fixture.organizationId, outcome!.taskSessionId!);
    expect(session?.status).toBe('failed');
    expect(session?.summary).toContain('member retired before start');
  });

  it('skips vague human chatter and never promotes agent-authored messages', async () => {
    const fixture = await createFixture({
      promoterEvaluator: async ({ message }) =>
        message.senderKind === 'agent'
          ? {
              decision: 'promote',
              confidence: 0.95,
              team: ['frontend-alice'],
              rationale: 'would promote if humans were allowed',
            }
          : {
              decision: 'skip',
              confidence: 0.12,
              rationale: 'too vague',
            },
    });
    tempDirs.push(fixture.archiveRoot);

    const humanMessage = fixture.conversations.sendMessage({
      organizationId: fixture.organizationId,
      threadId: 'general',
      channelId: 'general',
      senderId: fixture.ownerId,
      content: 'Maybe later we should think about auth',
    });
    const humanOutcome = await fixture.taskPromoter.handlePostedMessage({
      organizationId: fixture.organizationId,
      messageId: humanMessage.id,
    });
    expect(humanOutcome?.decision).toBe('skip');

    const agentMessage = fixture.conversations.sendMessage({
      organizationId: fixture.organizationId,
      threadId: 'general',
      channelId: 'general',
      senderId: 'frontend-alice',
      content: 'We should spin up a task for this',
    });
    const agentOutcome = await fixture.taskPromoter.handlePostedMessage({
      organizationId: fixture.organizationId,
      messageId: agentMessage.id,
    });
    expect(agentOutcome).toBeNull();
    expect(fixture.repo.listTaskSessions(fixture.organizationId, { limit: 20 }).data).toHaveLength(0);
  });

  it('treats /task run as an explicit fallback that creates a task session without the evaluator', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const message = fixture.conversations.sendMessage({
      organizationId: fixture.organizationId,
      threadId: 'general',
      channelId: 'general',
      senderId: fixture.ownerId,
      content: '/task run [frontend-alice] Implement the auth callbacks',
    });

    const outcome = await fixture.taskPromoter.handlePostedMessage({
      organizationId: fixture.organizationId,
      messageId: message.id,
    });

    expect(outcome?.decision).toBe('promote');
    const sessions = fixture.repo.listTaskSessions(fixture.organizationId, { limit: 20 }).data;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.teamMemberIds).toEqual(['frontend-alice']);
  });

  it('skips explicit task promotion when any provided team hint does not resolve', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const message = fixture.conversations.sendMessage({
      organizationId: fixture.organizationId,
      threadId: 'general',
      channelId: 'general',
      senderId: fixture.ownerId,
      content: '/task run [frontend-alice, frontedn] Implement the auth callbacks',
    });

    const outcome = await fixture.taskPromoter.handlePostedMessage({
      organizationId: fixture.organizationId,
      messageId: message.id,
    });

    expect(outcome?.decision).toBe('skip');
    expect(fixture.repo.listTaskSessions(fixture.organizationId, { limit: 20 }).data).toHaveLength(0);
    const audit = fixture.repo
      .listAuditEvents(fixture.organizationId)
      .find((event) => event.action === 'audit.task_promoter');
    expect(audit?.status).toBe('blocked');
    expect(audit?.metadata.rationale).toContain('frontedn');
  });
});
