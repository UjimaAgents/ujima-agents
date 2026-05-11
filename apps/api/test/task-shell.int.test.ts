import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import type { LanguageModel } from 'ai';
import { openDatabase } from '@ujima/context-store';
import { Repository } from '@ujima/runtime-core';
import {
  AiService,
  ConversationService,
  OnboardingService,
  RunService,
  SpiritService,
  TaskPromoterService,
  TaskSessionService,
  createTeamStore,
  type ModelResolver,
  type RealtimeService,
  type ToolService,
} from '@ujima/orchestrator';
import { MessageCardSchema } from '@ujima/shared';

function noopRealtime(): RealtimeService {
  return { emit: () => undefined };
}

function makeTextModel(text: string): LanguageModel {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream<LanguageModelV3StreamPart>({
        chunks: [
          { type: 'text-start', id: '1' },
          { type: 'text-delta', id: '1', delta: text },
          { type: 'text-end', id: '1' },
          {
            type: 'finish',
            usage: {
              inputTokens: { total: 11, noCache: 11, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 9, text: 9, reasoning: 0 },
              totalTokens: 20,
            },
            finishReason: { unified: 'stop' as const, raw: 'stop' },
          },
        ],
      }),
    }),
  }) as unknown as LanguageModel;
}

function makeToolCallModel(): LanguageModel {
  return new MockLanguageModelV3({
    doStream: async (options) => {
      const hasToolResults = options.prompt.some((message) =>
        Array.isArray(message.content)
          ? message.content.some((chunk: { type?: string }) => chunk.type === 'tool-result')
          : false,
      );
      if (!hasToolResults) {
        return {
          stream: simulateReadableStream<LanguageModelV3StreamPart>({
            chunks: [
              { type: 'text-start', id: '1' },
              { type: 'text-delta', id: '1', delta: 'Checking the file.' },
              { type: 'text-end', id: '1' },
              {
                type: 'tool-call',
                toolCallId: 'call-fs-1',
                toolName: 'filesystem',
                input: JSON.stringify({
                  action: 'read',
                  resourceType: 'file',
                  resourcePath: 'README.md',
                }),
              },
              {
                type: 'finish',
                usage: {
                  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 5, text: 5, reasoning: 0 },
                  totalTokens: 15,
                },
                finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' },
              },
            ],
          }),
        };
      }
      return {
        stream: simulateReadableStream<LanguageModelV3StreamPart>({
          chunks: [
            { type: 'text-start', id: '2' },
            { type: 'text-delta', id: '2', delta: 'Done — README looks good.' },
            { type: 'text-end', id: '2' },
            {
              type: 'finish',
              usage: {
                inputTokens: { total: 14, noCache: 14, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 8, text: 8, reasoning: 0 },
                totalTokens: 22,
              },
              finishReason: { unified: 'stop' as const, raw: 'stop' },
            },
          ],
        }),
      };
    },
  }) as unknown as LanguageModel;
}

interface FixtureOptions {
  modelResolver?: ModelResolver;
  promoterEvaluator?: ConstructorParameters<typeof TaskPromoterService>[2]['evaluator'];
  promoterAutoStart?: boolean;
}

async function createFixture(opts: FixtureOptions = {}) {
  const archiveRoot = await mkdtemp(join(tmpdir(), 'ujima-task-shell-phase3-'));
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const teamStore = createTeamStore();
  const onboarding = new OnboardingService(repo, teamStore);

  const onboarded = await onboarding.onboard({
    organizationName: 'Task Shell Org',
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
          tools: ['filesystem', 'channel.post', 'channel.read'],
          channels: ['general', 'frontend'],
        },
      ],
      agents: [
        { name: 'frontend-alice', roleName: 'frontend-engineer', personalityName: 'direct' },
        { name: 'frontend-bob', roleName: 'frontend-engineer', personalityName: 'direct' },
      ],
    },
  });

  const owner = onboarded.members.find((member) => member.kind === 'human');
  if (!owner) throw new Error('owner missing');

  const conversations = new ConversationService(repo, noopRealtime());
  const tools: ToolService = {
    allowRun: () => undefined,
    invoke: async () => ({ ok: true, output: { status: 'completed', result: 'ok' } }),
  };
  const spirits = new SpiritService(teamStore, repo, noopRealtime(), tools, {
    modelResolver: opts.modelResolver,
    conversations,
  });
  const taskSessions = new TaskSessionService(repo, conversations, spirits);
  const ai = new AiService(teamStore, repo, tools);
  const runs = new RunService(teamStore, repo, noopRealtime(), conversations, ai, tools);
  const taskPromoter = new TaskPromoterService(repo, runs, {
    teamStore,
    taskSessions,
    conversations,
    evaluator: opts.promoterEvaluator,
    autoStart: opts.promoterAutoStart ?? false,
  });

  return {
    archiveRoot,
    repo,
    conversations,
    taskSessions,
    taskPromoter,
    runs,
    organizationId: onboarded.organization.id,
    ownerId: owner.id,
  };
}

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
      modelResolver: () => makeToolCallModel(),
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

    const detail = fixture.runs.getRunDetail(fixture.organizationId, spirit!.runId!);
    expect(detail).not.toBeNull();
    expect(detail?.tokens.perMemberId['frontend-alice']).toBeGreaterThan(0);
    expect(detail?.tools.filesystem?.count).toBe(1);
    expect(detail?.tools.filesystem?.pending).toBe(0);
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

  it('skips explicit task promotion when provided team hints do not resolve', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const message = fixture.conversations.sendMessage({
      organizationId: fixture.organizationId,
      threadId: 'general',
      channelId: 'general',
      senderId: fixture.ownerId,
      content: '/task run [frontedn] Implement the auth callbacks',
    });

    const outcome = await fixture.taskPromoter.handlePostedMessage({
      organizationId: fixture.organizationId,
      messageId: message.id,
    });

    expect(outcome?.decision).toBe('skip');
    expect(fixture.repo.listTaskSessions(fixture.organizationId, { limit: 20 }).data).toHaveLength(0);
  });
});
