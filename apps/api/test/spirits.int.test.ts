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
  ActiveSpiritRegistry,
  ALWAYS_AVAILABLE_AGENT_TOOLS,
  ConversationService,
  ORCHESTRATOR_TOOLS,
  OnboardingService,
  SUPERVISOR_TOOL_ALLOWLIST,
  SpiritService,
  SupervisorService,
  SupervisorTodoService,
  TaskSessionService,
  ToolServiceImpl,
  createTeamStore,
  pickProviderModel,
  type ApiRepository,
  type ApprovalRequester,
  type ModelResolver,
  type RealtimeService,
  type ToolService,
} from '@ujima/orchestrator';
import { MessageCardSchema } from '@ujima/shared';

// ---------------------------------------------------------------------
// Phase 2.A–C — spirits + supervisor.todo.* + supervisor (lazy split).
// ---------------------------------------------------------------------

function noopRealtime(): RealtimeService {
  return { emit: () => undefined };
}

function v3Usage(inputTotal: number, outputTotal: number) {
  return {
    inputTokens: { total: inputTotal, noCache: inputTotal, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTotal, text: outputTotal, reasoning: 0 },
    totalTokens: inputTotal + outputTotal,
  };
}

function makeStreamingModel(parts: LanguageModelV3StreamPart[]): LanguageModel {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream<LanguageModelV3StreamPart>({ chunks: parts }),
    }),
  }) as unknown as LanguageModel;
}

function makeTextOnlyModel(text: string): LanguageModel {
  return makeStreamingModel([
    { type: 'text-start', id: '1' },
    { type: 'text-delta', id: '1', delta: text },
    { type: 'text-end', id: '1' },
    {
      type: 'finish',
      usage: v3Usage(11, 7),
      finishReason: { unified: 'stop' as const, raw: 'stop' },
    },
  ]);
}

interface FixtureOptions {
  modelByCall?: LanguageModel[];
  staticModel?: LanguageModel;
  agentNames?: string[];
  /** Use the real ToolServiceImpl path (with allowlist enforcement). */
  realToolPipeline?: boolean;
}

interface ModelCall {
  organizationId: string;
  memberId: string;
  role: 'worker' | 'supervisor';
}

interface Fixture {
  archiveRoot: string;
  repo: ApiRepository;
  conversations: ConversationService;
  spirits: SpiritService;
  supervisor: SupervisorService;
  supervisorTodos: SupervisorTodoService;
  taskSessions: TaskSessionService;
  registry: ActiveSpiritRegistry;
  tools: ToolService;
  organizationId: string;
  ownerId: string;
  modelCalls: { input: ModelCall; resolved: LanguageModel }[];
}

async function createFixture(opts: FixtureOptions = {}): Promise<Fixture> {
  const archiveRoot = await mkdtemp(join(tmpdir(), 'ujima-phase2-'));
  const db = openDatabase({ dbPath: ':memory:' });
  const repo = new Repository(db);
  const teamStore = createTeamStore();
  const onboarding = new OnboardingService(repo, teamStore);

  await onboarding.onboard({
    organizationName: 'Phase 2 Org',
    ownerName: 'Owner',
    workspaceRoot: archiveRoot,
    providerKeys: { local: 'sk-test' },
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
          provider: 'local',
          model: 'mock-worker-v1',
        },
      ],
      providers: {
        local: {
          kind: 'openai',
          defaultModel: 'mock-worker-v1',
        },
      },
      agents: (opts.agentNames ?? ['frontend-alice']).map((name) => ({
        name,
        roleName: 'frontend-engineer',
        personalityName: 'direct',
      })),
    },
  });

  const owner = repo
    .listMembers(repo.getLatestOrganization()!.id)
    .find((m) => m.kind === 'human')!;
  const organizationId = owner.organizationId;

  const conversations = new ConversationService(repo, noopRealtime());
  const supervisorTodos = new SupervisorTodoService(repo);

  const modelCalls: { input: ModelCall; resolved: LanguageModel }[] = [];
  let queueIndex = 0;
  const modelResolver: ModelResolver = (input) => {
    let resolved: LanguageModel;
    if (opts.modelByCall && opts.modelByCall.length > 0) {
      resolved = opts.modelByCall[queueIndex % opts.modelByCall.length]!;
      queueIndex += 1;
    } else if (opts.staticModel) {
      resolved = opts.staticModel;
    } else {
      resolved = makeTextOnlyModel('default');
    }
    modelCalls.push({ input, resolved });
    return resolved;
  };

  let tools: ToolService;
  if (opts.realToolPipeline) {
    // Real pipeline so SUPERVISOR_TOOL_ALLOWLIST enforcement runs.
    const approvalRequester: ApprovalRequester = {
      requestApproval: () => ({ id: 'fake-approval-id' }),
    };
    tools = new ToolServiceImpl(
      teamStore,
      repo,
      approvalRequester,
      conversations,
      noopRealtime(),
      supervisorTodos,
    );
  } else {
    // Stub: bypass policy + IAM. Used by tests that only care about the
    // spirit/supervisor flow, not the tool gate.
    tools = {
      invoke: async () => ({ ok: true, output: { status: 'completed', result: 'noop' } }),
      allowRun: () => undefined,
    };
  }

  const registry = new ActiveSpiritRegistry();
  const spirits = new SpiritService(teamStore, repo, noopRealtime(), tools, {
    modelResolver,
    maxIterationsPerRun: 8,
    registry,
  });
  const supervisor = new SupervisorService(
    repo,
    noopRealtime(),
    conversations,
    spirits,
    registry,
    {
      debounceMs: 0,
      turnCapPerSession: 3,
    },
  );
  const taskSessions = new TaskSessionService(repo, conversations, spirits);

  return {
    archiveRoot,
    repo,
    conversations,
    spirits,
    supervisor,
    supervisorTodos,
    taskSessions,
    registry,
    tools,
    organizationId,
    ownerId: owner.id,
    modelCalls,
  };
}

// =====================================================================
// Phase 2.A — SpiritService lifecycle
// =====================================================================

describe('SpiritService — Phase 2.A lifecycle', () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('spawn is idempotent per (session, member, role) triple and registers in ActiveSpiritRegistry', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'Wire up the new sign-up flow',
      team: ['frontend-alice'],
    });

    const first = fixture.spirits.spawn({
      organizationId: fixture.organizationId,
      taskSessionId: session.id,
      memberId: 'frontend-alice',
    });
    const second = fixture.spirits.spawn({
      organizationId: fixture.organizationId,
      taskSessionId: session.id,
      memberId: 'frontend-alice',
    });

    expect(first.id).toBe(second.id);
    expect(first.role).toBe('worker');
    expect(first.runId).toBeDefined();

    expect(fixture.spirits.list(fixture.organizationId, session.id)).toHaveLength(1);
    expect(fixture.registry.hasActiveForMember(fixture.organizationId, 'frontend-alice')).toBe(
      true,
    );
    const active = fixture.registry.getActiveForMember(fixture.organizationId, 'frontend-alice');
    expect(active).toHaveLength(1);
    expect(active[0]?.spiritId).toBe(first.id);
  });

  it('updateStatus moves a spirit to a non-alive status and unregisters it', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'p',
      team: ['frontend-alice'],
    });
    const spirit = fixture.spirits.spawn({
      organizationId: fixture.organizationId,
      taskSessionId: session.id,
      memberId: 'frontend-alice',
    });
    expect(fixture.registry.hasActiveForMember(fixture.organizationId, 'frontend-alice')).toBe(
      true,
    );

    const failed = fixture.spirits.updateStatus(
      fixture.organizationId,
      spirit.id,
      'failed',
      { error: 'simulated' },
    );
    expect(failed?.status).toBe('failed');
    expect(failed?.lastError).toBe('simulated');
    expect(fixture.registry.hasActiveForMember(fixture.organizationId, 'frontend-alice')).toBe(
      false,
    );
  });

  it('retire flips status to cancelled, sets endedAt, unregisters, and cancels the paired RunState', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'p',
      team: ['frontend-alice'],
    });
    const spirit = fixture.spirits.spawn({
      organizationId: fixture.organizationId,
      taskSessionId: session.id,
      memberId: 'frontend-alice',
    });

    const retired = fixture.spirits.retire(fixture.organizationId, spirit.id, 'user cancelled');
    expect(retired?.status).toBe('cancelled');
    expect(retired?.endedAt).toBeDefined();
    expect(retired?.lastError).toBe('user cancelled');
    expect(fixture.registry.hasActiveForMember(fixture.organizationId, 'frontend-alice')).toBe(
      false,
    );

    const run = fixture.repo.getRun(fixture.organizationId, retired!.runId!);
    expect(run?.status).toBe('cancelled');
    expect(run?.endedAt).toBeDefined();
  });

  it('bootstrap recovers active spirits into the registry from DB on cold start', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'p',
      team: ['frontend-alice'],
    });
    fixture.spirits.spawn({
      organizationId: fixture.organizationId,
      taskSessionId: session.id,
      memberId: 'frontend-alice',
    });

    // Simulate a daemon restart: a fresh registry on a fresh service
    // wired to the same repo. Without bootstrap() the gate would
    // misfire (no in-memory entries).
    const freshRegistry = new ActiveSpiritRegistry();
    const freshSpirits = new SpiritService(
      createTeamStore(),
      fixture.repo,
      noopRealtime(),
      fixture.tools,
      { registry: freshRegistry, modelResolver: () => makeTextOnlyModel('x') },
    );
    expect(freshRegistry.hasActiveForMember(fixture.organizationId, 'frontend-alice')).toBe(false);
    freshSpirits.bootstrap(fixture.organizationId);
    expect(freshRegistry.hasActiveForMember(fixture.organizationId, 'frontend-alice')).toBe(true);
  });

  it('multi-turn run drives streamText and persists agent messages with tool.call cards', async () => {
    const fixture = await createFixture({
      modelByCall: [
        new MockLanguageModelV3({
          doStream: async (options) => {
            const hasToolResults = options.prompt.some((m) =>
              Array.isArray(m.content)
                ? m.content.some((c: { type?: string }) => c.type === 'tool-result')
                : false,
            );
            if (!hasToolResults) {
              return {
                stream: simulateReadableStream<LanguageModelV3StreamPart>({
                  chunks: [
                    { type: 'text-start', id: '1' },
                    { type: 'text-delta', id: '1', delta: 'Reading the file…' },
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
                      usage: v3Usage(15, 9),
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
                    usage: v3Usage(20, 12),
                    finishReason: { unified: 'stop' as const, raw: 'stop' },
                  },
                ],
              }),
            };
          },
        }) as unknown as LanguageModel,
      ],
    });
    tempDirs.push(fixture.archiveRoot);

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'Audit the README',
      team: ['frontend-alice'],
    });

    const outcome = await fixture.spirits.run({
      organizationId: fixture.organizationId,
      taskSessionId: session.id,
      memberId: 'frontend-alice',
    });

    expect(outcome.iterations).toBeGreaterThanOrEqual(2);
    expect(outcome.toolCalls).toBe(1);
    expect(outcome.finalText).toContain('Done');
    expect(outcome.spirit.status).toBe('completed');
    // After completion the spirit is removed from the active registry.
    expect(fixture.registry.hasActiveForMember(fixture.organizationId, 'frontend-alice')).toBe(
      false,
    );

    const messages = fixture.repo
      .listChannelMessages(fixture.organizationId, session.channelId, { limit: 50 })
      .data
      .slice()
      .reverse();
    const agentMessages = messages.filter((m) => m.kind === 'agent');
    expect(agentMessages.length).toBeGreaterThanOrEqual(2);

    const toolMessage = agentMessages.find((m) => m.toolCalls.length > 0)!;
    expect(toolMessage).toBeDefined();
    const card = MessageCardSchema.parse(toolMessage.toolCalls[0]!.result);
    expect(card.kind).toBe('tool.call');
    if (card.kind === 'tool.call') {
      expect(card.toolName).toBe('filesystem');
      expect(card.taskSessionId).toBe(session.id);
    }

    const run = fixture.repo.getRun(fixture.organizationId, outcome.spirit.runId!);
    expect(run?.status).toBe('completed');
  });

  it('TaskSessionService.start provisions one spirit per team member', async () => {
    const fixture = await createFixture({
      agentNames: ['frontend-alice', 'frontend-bob'],
      staticModel: makeTextOnlyModel('Working.'),
    });
    tempDirs.push(fixture.archiveRoot);

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'Cooperate',
      team: ['frontend-alice', 'frontend-bob'],
    });

    const result = await fixture.taskSessions.start(fixture.organizationId, session.id);
    expect(result.spirits).toHaveLength(2);
    expect(result.spirits.map((s) => s.memberId).sort()).toEqual([
      'frontend-alice',
      'frontend-bob',
    ]);
    expect(result.session.status).toBe('running');
  });
});

// =====================================================================
// Phase 2.B — supervisor.todo.* round-trip via SupervisorTodoService
// =====================================================================

describe('supervisor.todo.* (Phase 2.B)', () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('add → list round-trip is scoped per task session via SupervisorTodoService', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const { session: sessionA } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'Task A',
      team: ['frontend-alice'],
      slug: 'task-a',
    });
    const { session: sessionB } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'Task B',
      team: ['frontend-alice'],
      slug: 'task-b',
    });

    const callTool = async (
      toolId: string,
      taskSessionId: string,
      input: Record<string, unknown>,
    ): Promise<unknown> => {
      const t = ORCHESTRATOR_TOOLS[toolId];
      if (!t) throw new Error(`tool ${toolId} not registered`);
      return t.execute({
        invocation: {
          organizationId: fixture.organizationId,
          runId: '',
          memberId: 'frontend-alice',
          threadId: '',
          toolCallId: `${toolId}-call`,
          toolId,
          action: 'message',
          resourceType: 'message',
          input,
          taskSessionId,
        },
        team: {} as never,
        repo: fixture.repo,
        conversations: fixture.conversations,
        supervisorTodos: fixture.supervisorTodos,
      });
    };

    const addedA1 = (await callTool('supervisor.todo.add', sessionA.id, {
      body: 'Wire auth',
    })) as { todo: { id: string; taskSessionId?: string } };
    const addedA2 = (await callTool('supervisor.todo.add', sessionA.id, {
      body: 'Add tests',
    })) as { todo: { id: string } };
    const addedB1 = (await callTool('supervisor.todo.add', sessionB.id, {
      body: 'Different task',
    })) as { todo: { id: string } };

    expect(addedA1.todo.taskSessionId).toBe(sessionA.id);

    const listedA = (await callTool('supervisor.todo.list', sessionA.id, {})) as {
      todos: { id: string; title: string }[];
    };
    expect(listedA.todos.map((t) => t.id).sort()).toEqual(
      [addedA1.todo.id, addedA2.todo.id].sort(),
    );

    const listedB = (await callTool('supervisor.todo.list', sessionB.id, {})) as {
      todos: { id: string }[];
    };
    expect(listedB.todos.map((t) => t.id)).toEqual([addedB1.todo.id]);

    // Cross-session check is rejected by SupervisorTodoService.
    const crossCheck = (await callTool('supervisor.todo.check', sessionA.id, {
      id: addedB1.todo.id,
      status: 'completed',
    })) as { error?: string };
    expect(crossCheck.error).toBeDefined();
    expect(crossCheck.error).toMatch(/different task session/i);

    // Same-session check works.
    const okCheck = (await callTool('supervisor.todo.check', sessionA.id, {
      id: addedA1.todo.id,
      status: 'completed',
    })) as { todo: { status: string } };
    expect(okCheck.todo.status).toBe('completed');

    // Status filter on list().
    const completedOnly = (await callTool('supervisor.todo.list', sessionA.id, {
      status: 'completed',
    })) as { todos: { id: string }[] };
    expect(completedOnly.todos).toHaveLength(1);
    expect(completedOnly.todos[0]!.id).toBe(addedA1.todo.id);
  });
});

// =====================================================================
// Phase 2.C — SupervisorService gate, mutex, cap, allowlist enforcement
// =====================================================================

describe('SupervisorService — Phase 2.C', () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('returns null when no active spirit (idle agents take the regular wake path)', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const outcome = await fixture.supervisor.handleAlert({
      organizationId: fixture.organizationId,
      memberId: 'frontend-alice',
      messageId: 'msg-doesnt-exist',
      threadId: 'general',
      byMemberId: fixture.ownerId,
      reason: 'mention',
    });
    expect(outcome).toBeNull();
  });

  it('answers DM/@mention through cheaper-tier model + increments supervisor_turn_count', async () => {
    const fixture = await createFixture({
      staticModel: makeTextOnlyModel('Currently rolling out the auth bits.'),
    });
    tempDirs.push(fixture.archiveRoot);

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'Wire auth',
      team: ['frontend-alice'],
    });

    fixture.spirits.spawn({
      organizationId: fixture.organizationId,
      taskSessionId: session.id,
      memberId: 'frontend-alice',
    });
    const sp = fixture.repo.getSpiritByTriple(
      fixture.organizationId,
      session.id,
      'frontend-alice',
      'worker',
    )!;
    fixture.spirits.updateStatus(fixture.organizationId, sp.id, 'running');

    const general = fixture.repo.getChannel(fixture.organizationId, 'general')!;
    const askMessage = fixture.conversations.postToChannel({
      organizationId: fixture.organizationId,
      senderId: fixture.ownerId,
      channelId: general.id,
      body: '@frontend-alice quick status?',
    });

    const outcome = await fixture.supervisor.handleAlert({
      organizationId: fixture.organizationId,
      memberId: 'frontend-alice',
      messageId: askMessage.id,
      channelId: general.id,
      threadId: askMessage.threadId,
      byMemberId: fixture.ownerId,
      reason: 'mention',
    });
    expect(outcome).not.toBeNull();
    expect(outcome!.fallback).toBe(false);
    expect(outcome!.message.content).toContain('rolling out the auth bits');
    expect(outcome!.message.channelId).toBe(general.id);
    expect(outcome!.message.parentMessageId).toBe(askMessage.id);

    const refreshed = fixture.repo.getTaskSession(fixture.organizationId, session.id)!;
    expect(refreshed.supervisorTurnCount).toBe(1);

    const lastCall = fixture.modelCalls[fixture.modelCalls.length - 1]!;
    expect(lastCall.input.role).toBe('supervisor');
  });

  it('caps supervisor turns per session and posts deterministic fallback after the cap', async () => {
    const fixture = await createFixture({
      staticModel: makeTextOnlyModel('Status update.'),
    });
    tempDirs.push(fixture.archiveRoot);

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'Hard task',
      team: ['frontend-alice'],
    });
    const sp = fixture.spirits.spawn({
      organizationId: fixture.organizationId,
      taskSessionId: session.id,
      memberId: 'frontend-alice',
    });
    fixture.spirits.updateStatus(fixture.organizationId, sp.id, 'running');

    const general = fixture.repo.getChannel(fixture.organizationId, 'general')!;
    const post = (i: number) =>
      fixture.conversations.postToChannel({
        organizationId: fixture.organizationId,
        senderId: fixture.ownerId,
        channelId: general.id,
        body: `@frontend-alice question ${i}`,
      });

    const outcomes = [];
    for (let i = 0; i < 4; i += 1) {
      const m = post(i);
      const r = await fixture.supervisor.handleAlert({
        organizationId: fixture.organizationId,
        memberId: 'frontend-alice',
        messageId: m.id,
        channelId: general.id,
        threadId: m.threadId,
        byMemberId: fixture.ownerId,
        reason: 'mention',
      });
      outcomes.push(r);
    }

    expect(outcomes.slice(0, 3).every((o) => o && !o.fallback)).toBe(true);
    expect(outcomes[3]?.fallback).toBe(true);
    expect(outcomes[3]?.reason).toBe('cap-reached');
    expect(outcomes[3]?.message.content).toMatch(/Supervisor turn cap reached/);
  });

  // -------------------------------------------------------------------
  // NEW: mutex serialization test
  // -------------------------------------------------------------------
  it('mutex serializes concurrent handleAlert calls for the same member', async () => {
    // Each model.doStream pushes start:<label>, awaits a real timer,
    // then pushes end:<label>. Without the per-member supervisor mutex,
    // two concurrent handleAlert calls would interleave (start:A,
    // start:B, end:A, end:B). The mutex guarantees strict serialisation.
    const order: string[] = [];

    const slowModel = (label: string): LanguageModel =>
      new MockLanguageModelV3({
        doStream: async () => {
          order.push(`start:${label}`);
          await new Promise((r) => setTimeout(r, 10));
          order.push(`end:${label}`);
          return {
            stream: simulateReadableStream<LanguageModelV3StreamPart>({
              chunks: [
                { type: 'text-start', id: label },
                { type: 'text-delta', id: label, delta: `reply-${label}` },
                { type: 'text-end', id: label },
                {
                  type: 'finish',
                  usage: v3Usage(5, 5),
                  finishReason: { unified: 'stop' as const, raw: 'stop' },
                },
              ],
            }),
          };
        },
      }) as unknown as LanguageModel;

    const fixture = await createFixture({
      modelByCall: [slowModel('A'), slowModel('B')],
    });
    tempDirs.push(fixture.archiveRoot);

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'p',
      team: ['frontend-alice'],
    });
    const sp = fixture.spirits.spawn({
      organizationId: fixture.organizationId,
      taskSessionId: session.id,
      memberId: 'frontend-alice',
    });
    fixture.spirits.updateStatus(fixture.organizationId, sp.id, 'running');

    const general = fixture.repo.getChannel(fixture.organizationId, 'general')!;
    const askA = fixture.conversations.postToChannel({
      organizationId: fixture.organizationId,
      senderId: fixture.ownerId,
      channelId: general.id,
      body: '@frontend-alice first',
    });
    const askB = fixture.conversations.postToChannel({
      organizationId: fixture.organizationId,
      senderId: fixture.ownerId,
      channelId: general.id,
      body: '@frontend-alice second',
    });

    // Fire both alerts before either resolves. The mutex must chain them.
    const promiseA = fixture.supervisor.handleAlert({
      organizationId: fixture.organizationId,
      memberId: 'frontend-alice',
      messageId: askA.id,
      channelId: general.id,
      threadId: askA.threadId,
      byMemberId: fixture.ownerId,
      reason: 'mention',
    });
    const promiseB = fixture.supervisor.handleAlert({
      organizationId: fixture.organizationId,
      memberId: 'frontend-alice',
      messageId: askB.id,
      channelId: general.id,
      threadId: askB.threadId,
      byMemberId: fixture.ownerId,
      reason: 'mention',
    });

    const [resultA, resultB] = await Promise.all([promiseA, promiseB]);
    expect(resultA?.fallback).toBe(false);
    expect(resultB?.fallback).toBe(false);

    // The mutex contract: A must complete before B starts.
    expect(order).toEqual(['start:A', 'end:A', 'start:B', 'end:B']);
  });

  // -------------------------------------------------------------------
  // NEW: runtime allowlist rejection test
  // -------------------------------------------------------------------
  it('rejects a non-allowlisted tool call tagged supervisor (ToolServiceImpl enforces SUPERVISOR_TOOL_ALLOWLIST at runtime)', async () => {
    const fixture = await createFixture({ realToolPipeline: true });
    tempDirs.push(fixture.archiveRoot);

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'p',
      team: ['frontend-alice'],
    });

    // Forge an invocation that pretends to be a supervisor call but
    // points at `filesystem`, which is NOT in SUPERVISOR_TOOL_ALLOWLIST.
    // The runtime allowlist gate in ToolServiceImpl.invoke must reject
    // it before the tool ever executes.
    const result = await fixture.tools.invoke({
      organizationId: fixture.organizationId,
      runId: 'forged-run-id',
      memberId: 'frontend-alice',
      threadId: session.channelId,
      toolCallId: 'forged-tool-call',
      toolId: 'filesystem',
      action: 'write',
      resourceType: 'file',
      resourcePath: 'apps/web/secrets.ts',
      input: { command: 'write' },
      permissionMcpId: 'supervisor',
      taskSessionId: session.id,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/SUPERVISOR_TOOL_ALLOWLIST/);
    expect((result.output as { code?: string }).code).toBe('ERR_SUPERVISOR_ALLOWLIST');
  });

  it('SUPERVISOR_TOOL_ALLOWLIST contains supervisor.todo.* and excludes filesystem/shell', () => {
    expect(SUPERVISOR_TOOL_ALLOWLIST).toContain('supervisor.todo.add');
    expect(SUPERVISOR_TOOL_ALLOWLIST).toContain('supervisor.todo.check');
    expect(SUPERVISOR_TOOL_ALLOWLIST).toContain('supervisor.todo.list');
    expect(SUPERVISOR_TOOL_ALLOWLIST).toContain('self.note');
    expect(SUPERVISOR_TOOL_ALLOWLIST).not.toContain('filesystem');
    expect(SUPERVISOR_TOOL_ALLOWLIST).not.toContain('shell');
    expect(ALWAYS_AVAILABLE_AGENT_TOOLS).toContain('self.note');
  });

  it('pickProviderModel returns supervisorModel when available, falls back to defaultModel', () => {
    expect(
      pickProviderModel({
        teamRole: { model: 'opus' },
        provider: { defaultModel: 'opus', supervisorModel: 'haiku' } as never,
        role: 'supervisor',
      }),
    ).toBe('haiku');
    expect(
      pickProviderModel({
        teamRole: {},
        provider: { defaultModel: 'opus' },
        role: 'supervisor',
      }),
    ).toBe('opus');
    expect(
      pickProviderModel({
        teamRole: { model: 'opus' },
        provider: { defaultModel: 'opus', supervisorModel: 'haiku' } as never,
        role: 'worker',
      }),
    ).toBe('opus');
  });
});
