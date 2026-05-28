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
  SupervisorTodoService,
  TaskSessionService,
  ToolServiceImpl,
  createApiServices,
  createTeamStore,
  pickProviderModel,
  taskRunChannelId,
  type ApiRepository,
  type ApprovalRequester,
  type SpiritServiceOptions,
  type ToolInvocationInput,
  type ToolInvocationResult,
  type ToolService,
} from '@ujima/orchestrator';
import {
  createSpiritTestFixture as createFixture,
  type ModelCall,
  type SpiritFixture as Fixture,
  type SpiritFixtureOptions as FixtureOptions,
} from './helpers/spirit-test-fixture.js';
import {
  extractModelToolNames,
  makeMcpToolCallModel,
  makeStreamingModel,
  makeTextOnlyModel,
  makeToolCaptureModel,
  v3Usage,
} from './helpers/mock-language-models.js';
import { noopRealtime } from './helpers/noop-realtime.js';
import { createPermissionMiddleware } from '@ujima/permissions';
import { AgentTeam } from '@ujima/framework';
import { ChannelSchema, MemberSchema, OrganizationSchema, type MCPDef } from '@ujima/shared';
import { MessageCardSchema } from '@ujima/shared';

// ---------------------------------------------------------------------
// Phase 2.A–C — spirits + supervisor.todo.* + supervisor (lazy split).
// ---------------------------------------------------------------------

function mcpDef(id: string, name: string): MCPDef {
  return {
    id,
    name,
    version: '0.0.0',
    description: '',
    category: 'general',
    transport: 'stdio',
    command: 'mcp',
    args: [],
    env: {},
    isolation: 'shared',
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

  it('surfaces cached MCP tools when live listTools fails', async () => {
    const capturedToolNames: string[][] = [];
    const serverId = 'server-cached';
    const mcpPool: NonNullable<SpiritServiceOptions['mcpPool']> = {
      get: async () => ({
        listTools: async () => {
          throw new Error('temporary transport failure');
        },
        callTool: async () => ({ content: { ok: true } }),
      }),
    };
    const fixture = await createFixture({
      staticModel: makeToolCaptureModel(capturedToolNames),
      mcpPool,
      mcpResolver: async () => [
        {
          def: mcpDef(serverId, 'Cached MCP'),
          serverId,
          serverName: 'Cached MCP',
        },
      ],
    });
    tempDirs.push(fixture.archiveRoot);
    fixture.repo.saveMcpToolCache({
      mcpServerId: serverId,
      organizationId: fixture.organizationId,
      tools: [{ name: 'cached tool', description: 'Cached fallback' }],
      fetchedAt: new Date().toISOString(),
    });

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'Use cached tools',
      team: ['frontend-alice'],
    });

    await fixture.spirits.run({
      organizationId: fixture.organizationId,
      taskSessionId: session.id,
      memberId: 'frontend-alice',
    });

    const finalToolNames = capturedToolNames[capturedToolNames.length - 1] ?? [];
    const mcpToolNames = finalToolNames.filter((name) => name.startsWith('mcp__'));
    expect(mcpToolNames).toHaveLength(1);
    expect(mcpToolNames[0]).toMatch(/^mcp__cached_mcp_[0-9a-f]{8}__cached_tool$/);
  });

  it('keeps MCP tool ids unique for servers whose names sanitize the same way', async () => {
    const capturedToolNames: string[][] = [];
    const mcpPool: NonNullable<SpiritServiceOptions['mcpPool']> = {
      get: async () => ({
        listTools: async () => [{ name: 'search', description: 'Search' }],
        callTool: async () => ({ content: { ok: true } }),
      }),
    };
    const fixture = await createFixture({
      staticModel: makeToolCaptureModel(capturedToolNames),
      mcpPool,
      mcpResolver: async () => [
        {
          def: mcpDef('server-alpha', 'Git Hub'),
          serverId: 'server-alpha',
          serverName: 'Git Hub',
        },
        {
          def: mcpDef('server-beta', 'Git@Hub'),
          serverId: 'server-beta',
          serverName: 'Git@Hub',
        },
      ],
    });
    tempDirs.push(fixture.archiveRoot);

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'Use MCP tools',
      team: ['frontend-alice'],
    });

    await fixture.spirits.run({
      organizationId: fixture.organizationId,
      taskSessionId: session.id,
      memberId: 'frontend-alice',
    });

    const finalToolNames = capturedToolNames[capturedToolNames.length - 1] ?? [];
    const mcpToolNames = finalToolNames.filter(
      (name) => name.startsWith('mcp__git_hub_') && name.endsWith('__search'),
    );
    expect(mcpToolNames).toHaveLength(2);
    expect(new Set(mcpToolNames).size).toBe(2);
  });

  it('namespaces MCP permission tool names away from built-in tool names', async () => {
    const invocations: ToolInvocationInput[] = [];
    const serverId = 'server-policy';
    const mcpPool: NonNullable<SpiritServiceOptions['mcpPool']> = {
      get: async () => ({
        listTools: async () => [{ name: 'self.note', description: 'Remote collision' }],
        callTool: async () => ({ content: { ok: true } }),
      }),
    };
    const fixture = await createFixture({
      staticModel: makeMcpToolCallModel((name) => name.startsWith('mcp__')),
      mcpPool,
      mcpResolver: async () => [
        {
          def: mcpDef(serverId, 'Collision MCP'),
          serverId,
          serverName: 'Collision MCP',
        },
      ],
      toolInvoke: (input) => {
        invocations.push(input);
        return { ok: true, output: { status: 'completed' } };
      },
    });
    tempDirs.push(fixture.archiveRoot);

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'Call MCP self note',
      team: ['frontend-alice'],
    });

    await fixture.spirits.run({
      organizationId: fixture.organizationId,
      taskSessionId: session.id,
      memberId: 'frontend-alice',
    });

    expect(invocations).toHaveLength(1);
    expect(invocations[0]!.toolId).toBe('mcp');
    expect(invocations[0]!.permissionToolName).toBe('mcp:server-policy:self.note');
    expect(invocations[0]!.permissionToolName).not.toBe('self.note');
    expect(invocations[0]!.input.toolName).toBe('self.note');
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
// Phase 2.C — SpiritService alert gate, mutex, cap, allowlist enforcement
// =====================================================================

describe('SpiritService alert dispatch — Phase 2.C', () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('returns no-active-spirit when no active spirit (caller falls through to regular wake path)', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const outcome = await fixture.spirits.handleAlert({
      organizationId: fixture.organizationId,
      memberId: 'frontend-alice',
      messageId: 'msg-doesnt-exist',
      threadId: 'general',
      byMemberId: fixture.ownerId,
      reason: 'mention',
    });
    expect(outcome.kind).toBe('no-active-spirit');
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

    const dispatch = await fixture.spirits.handleAlert({
      organizationId: fixture.organizationId,
      memberId: 'frontend-alice',
      messageId: askMessage.id,
      channelId: general.id,
      threadId: askMessage.threadId,
      byMemberId: fixture.ownerId,
      reason: 'mention',
    });
    expect(dispatch.kind).toBe('replied');
    if (dispatch.kind !== 'replied') throw new Error('expected replied');
    expect(dispatch.outcome.fallback).toBe(false);
    expect(dispatch.outcome.message.content).toContain('rolling out the auth bits');
    expect(dispatch.outcome.message.channelId).toBe(general.id);
    expect(dispatch.outcome.message.parentMessageId).toBe(askMessage.id);

    const refreshed = fixture.repo.getTaskSession(fixture.organizationId, session.id)!;
    expect(refreshed.supervisorTurnCount).toBe(1);

    const lastCall = fixture.modelCalls[fixture.modelCalls.length - 1]!;
    expect(lastCall.input.role).toBe('supervisor');
  });

  // Regression: pre-fix, runSupervisorAlertTurn decided success purely
  // from `outcome.finalText.trim()`. Under the read-all/speak-when-useful
  // palette the supervisor replies via `channel.reply` (a terminating
  // tool), which intentionally leaves `finalText` empty — the tool
  // already wrote the visible message. Without the terminating-tool
  // gate, every tool-based mention reply gets misclassified as
  // `must_reply_failed` and the canned fallback overwrites the real
  // answer. This test pins the corrected behaviour.
  it('mention turn that replies via channel.reply is NOT classified as must_reply_failed', async () => {
    const replyToolModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream<LanguageModelV3StreamPart>({
          chunks: [
            {
              type: 'tool-call',
              toolCallId: 'call-reply-1',
              toolName: 'channel.reply',
              input: JSON.stringify({ body: 'On it — rolling out auth.' }),
            },
            {
              type: 'finish',
              usage: v3Usage(8, 4),
              finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' },
            },
          ],
        }),
      }),
    }) as unknown as LanguageModel;

    const fixture = await createFixture({
      staticModel: replyToolModel,
      // Stub tool service — we only care that the dispatcher SEES the
      // terminating tool fired in `result.steps`. We don't need an
      // actual message published for the gate logic itself.
      toolInvoke: async () => ({
        ok: true,
        output: { status: 'completed', result: 'noop' },
      }),
    });
    tempDirs.push(fixture.archiveRoot);

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'Ship auth',
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
      body: '@frontend-alice status?',
    });

    const dispatch = await fixture.spirits.handleAlert({
      organizationId: fixture.organizationId,
      memberId: 'frontend-alice',
      messageId: askMessage.id,
      channelId: general.id,
      threadId: askMessage.threadId,
      byMemberId: fixture.ownerId,
      reason: 'mention',
      wakeReason: 'mention',
    });

    expect(dispatch.kind).toBe('replied');
    if (dispatch.kind !== 'replied') throw new Error('expected replied');
    // The dispatcher must NOT misclassify this as must_reply_failed
    // and must NOT publish a fallback on top of the tool reply.
    expect(dispatch.outcome.fallback).toBe(false);
    expect(dispatch.outcome.reason).toBe('ok');
    // `message: null` signals "the terminating tool already wrote
    // the visible reply; the dispatcher published nothing on top".
    expect(dispatch.outcome.message).toBeNull();

    // Persisted-state regression: the completed run row MUST carry
    // `terminatingTool: 'channel.reply'` so `/runs/:id` and the
    // list/detail endpoints report it, and pass-rate / reply-rate
    // metrics (terminatingTool x wakeReason) read the right value.
    // Pre-fix, the run save only wrote status/step/summary/endedAt
    // and dropped this field.
    const supervisorSpirit = fixture.repo.getSpiritByTriple(
      fixture.organizationId,
      session.id,
      'frontend-alice',
      'supervisor',
    );
    expect(supervisorSpirit).not.toBeNull();
    const supervisorRunId = supervisorSpirit!.runId;
    expect(supervisorRunId).toBeDefined();
    const supervisorRun = fixture.repo.getRun(fixture.organizationId, supervisorRunId!);
    expect(supervisorRun?.terminatingTool).toBe('channel.reply');
    expect(supervisorRun?.status).toBe('completed');
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
      const r = await fixture.spirits.handleAlert({
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

    const replied = outcomes.map((o) => (o.kind === 'replied' ? o.outcome : null));
    expect(replied.slice(0, 3).every((r) => r !== null && !r.fallback)).toBe(true);
    expect(replied[3]?.fallback).toBe(true);
    expect(replied[3]?.reason).toBe('cap-reached');
    expect(replied[3]?.message.content).toMatch(/Supervisor turn cap reached/);
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
    const promiseA = fixture.spirits.handleAlert({
      organizationId: fixture.organizationId,
      memberId: 'frontend-alice',
      messageId: askA.id,
      channelId: general.id,
      threadId: askA.threadId,
      byMemberId: fixture.ownerId,
      reason: 'mention',
    });
    const promiseB = fixture.spirits.handleAlert({
      organizationId: fixture.organizationId,
      memberId: 'frontend-alice',
      messageId: askB.id,
      channelId: general.id,
      threadId: askB.threadId,
      byMemberId: fixture.ownerId,
      reason: 'mention',
    });

    const [resultA, resultB] = await Promise.all([promiseA, promiseB]);
    expect(resultA.kind).toBe('replied');
    expect(resultB.kind).toBe('replied');
    if (resultA.kind === 'replied') expect(resultA.outcome.fallback).toBe(false);
    if (resultB.kind === 'replied') expect(resultB.outcome.fallback).toBe(false);

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

  it('SUPERVISOR_TOOL_ALLOWLIST contains supervisor.todo.* and web_search, excludes filesystem/shell', () => {
    expect(SUPERVISOR_TOOL_ALLOWLIST).toContain('supervisor.todo.add');
    expect(SUPERVISOR_TOOL_ALLOWLIST).toContain('supervisor.todo.check');
    expect(SUPERVISOR_TOOL_ALLOWLIST).toContain('supervisor.todo.list');
    expect(SUPERVISOR_TOOL_ALLOWLIST).toContain('self.note');
    expect(SUPERVISOR_TOOL_ALLOWLIST).toContain('web_search');
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

  // -------------------------------------------------------------------
  // NEW (audit fix #3): debounced alerts must NOT fall through to wake
  // -------------------------------------------------------------------
  it('debounced handleAlert returns kind=debounced (caller must NOT spawn a fallback run)', async () => {
    // Use a real debounce window so the second alert lands inside it.
    const archiveRoot = await mkdtemp(join(tmpdir(), 'ujima-debounce-'));
    tempDirs.push(archiveRoot);
    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);
    const teamStore = createTeamStore();
    const onboarding = new OnboardingService(repo, teamStore);
    await onboarding.onboard({
      organizationName: 'Debounce Org',
      ownerName: 'Owner',
      workspaceRoot: archiveRoot,
      providerKeys: { local: 'k' },
      team: {
        channels: [{ name: 'general', kind: 'general', topic: '' }],
        roles: [
          {
            name: 'r',
            title: 'R',
            instructions: 'i',
            workspaceScopes: [],
            tools: [],
            channels: ['general'],
            provider: 'local',
            model: 'm',
          },
        ],
        providers: { local: { kind: 'openai', defaultModel: 'm' } },
        agents: [{ name: 'agent-x', roleName: 'r', personalityName: 'direct' }],
      },
    });
    const owner = repo.listMembers(repo.getLatestOrganization()!.id).find((m) => m.kind === 'human')!;
    const conversations = new ConversationService(repo, noopRealtime());
    const registry = new ActiveSpiritRegistry();
    const stubTools: ToolService = {
      invoke: async () => ({ ok: true, output: { status: 'completed' } }),
      allowRun: () => undefined,
    };
    const spirits = new SpiritService(teamStore, repo, noopRealtime(), stubTools, {
      modelResolver: () => makeTextOnlyModel('reply'),
      registry,
      conversations,
      supervisorDebounceMs: 5_000,
      supervisorTurnCapPerSession: 10,
    });
    const taskSessions = new TaskSessionService(repo, conversations, spirits);

    const { session } = taskSessions.create({
      organizationId: owner.organizationId,
      requestedBy: owner.id,
      prompt: 'p',
      team: ['agent-x'],
    });
    const sp = spirits.spawn({
      organizationId: owner.organizationId,
      taskSessionId: session.id,
      memberId: 'agent-x',
    });
    spirits.updateStatus(owner.organizationId, sp.id, 'running');

    const general = repo.getChannel(owner.organizationId, 'general')!;
    const m1 = conversations.postToChannel({
      organizationId: owner.organizationId,
      senderId: owner.id,
      channelId: general.id,
      body: '@agent-x first',
    });

    const first = await spirits.handleAlert({
      organizationId: owner.organizationId,
      memberId: 'agent-x',
      messageId: m1.id,
      channelId: general.id,
      threadId: m1.threadId,
      byMemberId: owner.id,
      reason: 'mention',
    });
    expect(first.kind).toBe('replied');

    // Second alert immediately lands inside the 5s debounce window.
    const m2 = conversations.postToChannel({
      organizationId: owner.organizationId,
      senderId: owner.id,
      channelId: general.id,
      body: '@agent-x second',
    });
    const second = await spirits.handleAlert({
      organizationId: owner.organizationId,
      memberId: 'agent-x',
      messageId: m2.id,
      channelId: general.id,
      threadId: m2.threadId,
      byMemberId: owner.id,
      reason: 'mention',
    });

    // The fix: debounced alerts return their own kind, distinct from
    // no-active-spirit, so wakeMember can short-circuit instead of
    // spawning a duplicate run.
    expect(second.kind).toBe('debounced');
  });
});

// =====================================================================
// Audit fix regressions for TaskSessionService.create
// =====================================================================

describe('TaskSessionService.create — audit fix regressions', () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  // -------------------------------------------------------------------
  // NEW (audit fix #1): channel/thread ids are namespaced by org so two
  // orgs with the same slug do not corrupt each other's task-run state.
  // -------------------------------------------------------------------
  it('two organisations with the same slug produce distinct, non-colliding channel ids', async () => {
    const archiveRoot = await mkdtemp(join(tmpdir(), 'ujima-cross-org-'));
    tempDirs.push(archiveRoot);
    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);
    const teamStore = createTeamStore();

    // Two completely independent organisations on the same DB.
    const onboardOrg = async (name: string, agentName: string): Promise<string> => {
      const onboarding = new OnboardingService(repo, teamStore);
      await onboarding.onboard({
        organizationName: name,
        ownerName: `${name} Owner`,
        workspaceRoot: join(archiveRoot, name),
        providerKeys: { local: 'k' },
        team: {
          channels: [{ name: 'general', kind: 'general', topic: '' }],
          roles: [
            {
              name: 'eng',
              title: 'Eng',
              instructions: 'i',
              workspaceScopes: [],
              tools: [],
              channels: ['general'],
              provider: 'local',
              model: 'm',
            },
          ],
          providers: { local: { kind: 'openai', defaultModel: 'm' } },
          agents: [{ name: agentName, roleName: 'eng', personalityName: 'direct' }],
        },
      });
      return repo.listOrganizations().find((o) => o.name === name)!.id;
    };

    const orgA = await onboardOrg('Org A', 'a-agent');
    const orgB = await onboardOrg('Org B', 'b-agent');
    const ownerA = repo.listMembers(orgA).find((m) => m.kind === 'human')!.id;
    const ownerB = repo.listMembers(orgB).find((m) => m.kind === 'human')!.id;

    const conversations = new ConversationService(repo, noopRealtime());
    const taskSessions = new TaskSessionService(repo, conversations);

    const { session: sessionA } = taskSessions.create({
      organizationId: orgA,
      requestedBy: ownerA,
      prompt: 'shared prompt',
      team: ['a-agent'],
      slug: 'shared-slug',
    });
    const { session: sessionB } = taskSessions.create({
      organizationId: orgB,
      requestedBy: ownerB,
      prompt: 'shared prompt',
      team: ['b-agent'],
      slug: 'shared-slug',
    });

    // Both sessions share the slug but the channel ids are disjoint
    // (the org id is baked in).
    expect(sessionA.slug).toBe('shared-slug');
    expect(sessionB.slug).toBe('shared-slug');
    expect(sessionA.channelId).toBe(taskRunChannelId(orgA, 'shared-slug'));
    expect(sessionB.channelId).toBe(taskRunChannelId(orgB, 'shared-slug'));
    expect(sessionA.channelId).not.toBe(sessionB.channelId);

    // Each org sees only its own task-run channel — the prior bug
    // would have had the second create overwrite the first.
    const channelA = repo.getChannel(orgA, sessionA.channelId)!;
    const channelB = repo.getChannel(orgB, sessionB.channelId)!;
    expect(channelA.organizationId).toBe(orgA);
    expect(channelB.organizationId).toBe(orgB);
    expect(channelA.memberIds.sort()).toEqual([ownerA, 'a-agent'].sort());
    expect(channelB.memberIds.sort()).toEqual([ownerB, 'b-agent'].sort());

    // Cross-org lookups by id must MISS — the channel only exists in
    // its own org's row. (saveChannel filters by `organization_id` AND
    // `id`, so the namespaced id on top of the org filter is double
    // protection against a leak.)
    expect(repo.getChannel(orgA, sessionB.channelId)).toBeNull();
    expect(repo.getChannel(orgB, sessionA.channelId)).toBeNull();
  });

  // -------------------------------------------------------------------
  // NEW (audit fix #2): create runs in a transaction; on failure
  // mid-flight no orphan channels/threads remain.
  // -------------------------------------------------------------------
  it('bootstrapAll() hydrates the registry from persisted spirits — restart-safe', async () => {
    // Simulates a daemon restart. We persist active spirits with the
    // first SpiritService, throw away its in-memory registry, then
    // construct a fresh service with a fresh registry on the same DB
    // and assert the gate is correct after `bootstrapAll()`.
    const archiveRoot = await mkdtemp(join(tmpdir(), 'ujima-bootstrap-'));
    tempDirs.push(archiveRoot);
    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);
    const teamStore = createTeamStore();
    const onboarding = new OnboardingService(repo, teamStore);
    await onboarding.onboard({
      organizationName: 'Restart Org',
      ownerName: 'Owner',
      workspaceRoot: archiveRoot,
      providerKeys: { local: 'k' },
      team: {
        channels: [{ name: 'general', kind: 'general', topic: '' }],
        roles: [
          {
            name: 'eng',
            title: 'Eng',
            instructions: 'i',
            workspaceScopes: [],
            tools: [],
            channels: ['general'],
            provider: 'local',
            model: 'm',
          },
        ],
        providers: { local: { kind: 'openai', defaultModel: 'm' } },
        agents: [{ name: 'agent-x', roleName: 'eng', personalityName: 'direct' }],
      },
    });
    const owner = repo.listMembers(repo.getLatestOrganization()!.id).find((m) => m.kind === 'human')!;
    const conversations = new ConversationService(repo, noopRealtime());
    const stubTools: ToolService = {
      invoke: async () => ({ ok: true, output: { status: 'completed' } }),
      allowRun: () => undefined,
    };

    // Phase 1 — pre-restart: spawn a spirit. Persisted on disk; the
    // first registry tracks it.
    const preRegistry = new ActiveSpiritRegistry();
    const preSpirits = new SpiritService(teamStore, repo, noopRealtime(), stubTools, {
      modelResolver: () => makeTextOnlyModel('x'),
      registry: preRegistry,
      conversations,
    });
    const taskSessions = new TaskSessionService(repo, conversations, preSpirits);
    const { session } = taskSessions.create({
      organizationId: owner.organizationId,
      requestedBy: owner.id,
      prompt: 'p',
      team: ['agent-x'],
    });
    preSpirits.spawn({
      organizationId: owner.organizationId,
      taskSessionId: session.id,
      memberId: 'agent-x',
    });
    expect(preRegistry.hasActiveForMember(owner.organizationId, 'agent-x')).toBe(true);

    // Phase 2 — "restart": fresh registry, fresh service, same DB.
    // Without bootstrapAll() the gate would be empty for a still-
    // running spirit and the supervisor would misroute fresh alerts
    // to the regular wake path.
    const postRegistry = new ActiveSpiritRegistry();
    const postSpirits = new SpiritService(teamStore, repo, noopRealtime(), stubTools, {
      modelResolver: () => makeTextOnlyModel('x'),
      registry: postRegistry,
      conversations,
      supervisorDebounceMs: 0,
      supervisorTurnCapPerSession: 5,
    });
    expect(postRegistry.hasActiveForMember(owner.organizationId, 'agent-x')).toBe(false);
    postSpirits.bootstrapAll();
    expect(postRegistry.hasActiveForMember(owner.organizationId, 'agent-x')).toBe(true);

    // Sanity: the SpiritService wired against the post-restart
    // registry now sees the alert as active, not as a fall-through.
    const general = repo.getChannel(owner.organizationId, 'general')!;
    const ask = conversations.postToChannel({
      organizationId: owner.organizationId,
      senderId: owner.id,
      channelId: general.id,
      body: '@agent-x post-restart ping',
    });
    const dispatch = await postSpirits.handleAlert({
      organizationId: owner.organizationId,
      memberId: 'agent-x',
      messageId: ask.id,
      channelId: general.id,
      threadId: ask.threadId,
      byMemberId: owner.id,
      reason: 'mention',
    });
    expect(dispatch.kind).toBe('replied');
  });

  // -------------------------------------------------------------------
  // NEW (audit fix): bootstrap preserves newest-first ordering even
  // when the DB returned the active spirits newest-first by
  // updated_at. The registry must order by its own monotonic counter,
  // so we have to walk the DB result in reverse.
  // -------------------------------------------------------------------
  it('bootstrap preserves newest-first ordering after restart for a multi-session member', async () => {
    const archiveRoot = await mkdtemp(join(tmpdir(), 'ujima-bootstrap-order-'));
    tempDirs.push(archiveRoot);
    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);
    const teamStore = createTeamStore();
    const onboarding = new OnboardingService(repo, teamStore);
    await onboarding.onboard({
      organizationName: 'Restart Order Org',
      ownerName: 'Owner',
      workspaceRoot: archiveRoot,
      providerKeys: { local: 'k' },
      team: {
        channels: [{ name: 'general', kind: 'general', topic: '' }],
        roles: [
          {
            name: 'eng',
            title: 'Eng',
            instructions: 'i',
            workspaceScopes: [],
            tools: [],
            channels: ['general'],
            provider: 'local',
            model: 'm',
          },
        ],
        providers: { local: { kind: 'openai', defaultModel: 'm' } },
        agents: [{ name: 'agent-x', roleName: 'eng', personalityName: 'direct' }],
      },
    });
    const owner = repo
      .listMembers(repo.getLatestOrganization()!.id)
      .find((m) => m.kind === 'human')!;
    const conversations = new ConversationService(repo, noopRealtime());
    const stubTools: ToolService = {
      invoke: async () => ({ ok: true, output: { status: 'completed' } }),
      allowRun: () => undefined,
    };
    const preRegistry = new ActiveSpiritRegistry();
    const preSpirits = new SpiritService(teamStore, repo, noopRealtime(), stubTools, {
      modelResolver: () => makeTextOnlyModel('x'),
      registry: preRegistry,
      conversations,
    });
    const taskSessions = new TaskSessionService(repo, conversations, preSpirits);

    // Two sessions for the same member, spawned in time order. The
    // small wait makes the spirits' DB `updated_at` strictly
    // increasing so `listActiveSpiritsForMember` orders deterministically.
    const { session: oldSession } = taskSessions.create({
      organizationId: owner.organizationId,
      requestedBy: owner.id,
      prompt: 'old',
      team: ['agent-x'],
      slug: 'old-session',
    });
    const oldSpirit = preSpirits.spawn({
      organizationId: owner.organizationId,
      taskSessionId: oldSession.id,
      memberId: 'agent-x',
    });
    await new Promise((r) => setTimeout(r, 5));
    const { session: newSession } = taskSessions.create({
      organizationId: owner.organizationId,
      requestedBy: owner.id,
      prompt: 'new',
      team: ['agent-x'],
      slug: 'new-session',
    });
    const newSpirit = preSpirits.spawn({
      organizationId: owner.organizationId,
      taskSessionId: newSession.id,
      memberId: 'agent-x',
    });

    // DB invariant: newest first.
    const dbActive = repo.listActiveSpiritsForMember(owner.organizationId, 'agent-x');
    expect(dbActive.map((s) => s.id)).toEqual([newSpirit.id, oldSpirit.id]);

    // "Restart": fresh registry, fresh service, same DB. Pre-fix the
    // bootstrap loop would assign the lowest counter to the NEWEST
    // spirit (by walking newest-first), inverting runtime ordering.
    const postRegistry = new ActiveSpiritRegistry();
    const postSpirits = new SpiritService(teamStore, repo, noopRealtime(), stubTools, {
      modelResolver: () => makeTextOnlyModel('x'),
      registry: postRegistry,
      conversations,
      supervisorDebounceMs: 0,
      supervisorTurnCapPerSession: 5,
    });
    postSpirits.bootstrapAll();

    const recovered = postRegistry.getActiveForMember(owner.organizationId, 'agent-x');
    expect(recovered.map((e) => e.spiritId)).toEqual([newSpirit.id, oldSpirit.id]);
    expect(recovered[0]?.taskSessionId).toBe(newSession.id);

    // End-to-end: a fresh @mention after restart routes to the NEW
    // session, not the old one. Pre-fix this assertion would fail
    // because handleAlert picks active[0] which would have been
    // oldSpirit.
    const general = repo.getChannel(owner.organizationId, 'general')!;
    const ask = conversations.postToChannel({
      organizationId: owner.organizationId,
      senderId: owner.id,
      channelId: general.id,
      body: '@agent-x post-restart status?',
    });
    const dispatch = await postSpirits.handleAlert({
      organizationId: owner.organizationId,
      memberId: 'agent-x',
      messageId: ask.id,
      channelId: general.id,
      threadId: ask.threadId,
      byMemberId: owner.id,
      reason: 'mention',
    });
    expect(dispatch.kind).toBe('replied');
    const refreshedNew = repo.getTaskSession(owner.organizationId, newSession.id)!;
    const refreshedOld = repo.getTaskSession(owner.organizationId, oldSession.id)!;
    expect(refreshedNew.supervisorTurnCount).toBe(1);
    expect(refreshedOld.supervisorTurnCount).toBe(0);
  });

  it('createApiServices wiring auto-hydrates the registry on construction', async () => {
    // Audit fix #1 also requires the production wiring to call
    // `bootstrapAll()` for us. This test exercises the wiring exactly
    // the way the daemon's main.ts does — and asserts the registry
    // is populated by the time createApiServices returns.
    const archiveRoot = await mkdtemp(join(tmpdir(), 'ujima-wiring-'));
    tempDirs.push(archiveRoot);
    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);
    const teamStore = createTeamStore();
    const onboarding = new OnboardingService(repo, teamStore);
    await onboarding.onboard({
      organizationName: 'Wiring Org',
      ownerName: 'Owner',
      workspaceRoot: archiveRoot,
      providerKeys: { local: 'k' },
      team: {
        channels: [{ name: 'general', kind: 'general', topic: '' }],
        roles: [
          {
            name: 'eng',
            title: 'Eng',
            instructions: 'i',
            workspaceScopes: [],
            tools: [],
            channels: ['general'],
            provider: 'local',
            model: 'm',
          },
        ],
        providers: { local: { kind: 'openai', defaultModel: 'm' } },
        agents: [{ name: 'agent-x', roleName: 'eng', personalityName: 'direct' }],
      },
    });
    const owner = repo.listMembers(repo.getLatestOrganization()!.id).find((m) => m.kind === 'human')!;

    // Persist an active spirit BEFORE constructing services.
    const preRegistry = new ActiveSpiritRegistry();
    const preSpirits = new SpiritService(teamStore, repo, noopRealtime(), {
      invoke: async () => ({ ok: true }),
      allowRun: () => undefined,
    }, {
      registry: preRegistry,
      modelResolver: () => makeTextOnlyModel('x'),
    });
    const conversations1 = new ConversationService(repo, noopRealtime());
    const taskSessions1 = new TaskSessionService(repo, conversations1, preSpirits);
    const { session } = taskSessions1.create({
      organizationId: owner.organizationId,
      requestedBy: owner.id,
      prompt: 'p',
      team: ['agent-x'],
    });
    preSpirits.spawn({
      organizationId: owner.organizationId,
      taskSessionId: session.id,
      memberId: 'agent-x',
    });

    // Now build services as production does. The wiring should hydrate
    // its own (fresh) registry from the existing spirit row.
    const services = createApiServices({
      teamStore,
      repo,
      workspaces: { get: () => undefined },
      realtime: noopRealtime(),
      permissions: createPermissionMiddleware({}),
      buildPermissionContext: (input) => ({
        agent: {
          id: input.memberId,
          name: input.memberId,
          persona: '',
          model: '',
          mcp: input.permissionMcpId ?? input.toolId,
          permissions: {
            allowed_tools: [],
            blocked_tools: [],
            rate_limit: { max_session_tokens: 100_000 },
          },
          communication: { publishes: [], subscribes: [] },
          escalation: { conditions: [], escalate_to: 'human' },
        },
        mcp: { id: input.permissionMcpId ?? input.toolId },
        toolName: input.permissionToolName ?? input.toolId,
        args: input.input,
        taskId: input.runId,
        sessionId: input.runId,
      }),
      spiritModelResolver: () => makeTextOnlyModel('x'),
    });

    // The newly-wired services own a fresh registry, but bootstrapAll()
    // should have just been invoked. So the spirit is visible without
    // any further work.
    expect(services.activeSpirits.hasActiveForMember(owner.organizationId, 'agent-x')).toBe(true);
  });

  it('multi-session: supervisor picks the NEWEST active spirit, not the oldest', async () => {
    // A member may participate in multiple concurrent sessions. The
    // earlier registry returned entries in insertion order, so a fresh
    // @mention always answered against the OLDEST live spirit and
    // incremented the wrong session's supervisorTurnCount. Newest-
    // first ordering picks the session the user most recently asked
    // about.
    const fixture = await createFixture({
      staticModel: makeTextOnlyModel('answering newest'),
    });
    tempDirs.push(fixture.archiveRoot);

    const { session: oldSession } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'old',
      team: ['frontend-alice'],
      slug: 'old-session',
    });
    const { session: newSession } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'new',
      team: ['frontend-alice'],
      slug: 'new-session',
    });

    const oldSpirit = fixture.spirits.spawn({
      organizationId: fixture.organizationId,
      taskSessionId: oldSession.id,
      memberId: 'frontend-alice',
    });
    fixture.spirits.updateStatus(fixture.organizationId, oldSpirit.id, 'running');
    const newSpirit = fixture.spirits.spawn({
      organizationId: fixture.organizationId,
      taskSessionId: newSession.id,
      memberId: 'frontend-alice',
    });
    fixture.spirits.updateStatus(fixture.organizationId, newSpirit.id, 'running');

    expect(
      fixture.registry.getActiveForMember(fixture.organizationId, 'frontend-alice').length,
    ).toBe(2);

    const general = fixture.repo.getChannel(fixture.organizationId, 'general')!;
    const ask = fixture.conversations.postToChannel({
      organizationId: fixture.organizationId,
      senderId: fixture.ownerId,
      channelId: general.id,
      body: '@frontend-alice status?',
    });

    const dispatch = await fixture.spirits.handleAlert({
      organizationId: fixture.organizationId,
      memberId: 'frontend-alice',
      messageId: ask.id,
      channelId: general.id,
      threadId: ask.threadId,
      byMemberId: fixture.ownerId,
      reason: 'mention',
    });

    expect(dispatch.kind).toBe('replied');
    if (dispatch.kind !== 'replied') return;

    // The supervisor counter on the NEW session should have ticked,
    // not the old one. Pre-fix this assertion would fail because the
    // registry returned the old spirit first.
    const refreshedNew = fixture.repo.getTaskSession(fixture.organizationId, newSession.id)!;
    const refreshedOld = fixture.repo.getTaskSession(fixture.organizationId, oldSession.id)!;
    expect(refreshedNew.supervisorTurnCount).toBe(1);
    expect(refreshedOld.supervisorTurnCount).toBe(0);
  });

  it('concurrent burst: only ONE alert in a same-tick burst executes; the rest are debounced', async () => {
    // Pre-fix bug: the debounce window was stamped INSIDE the queued
    // mutex callback, so a burst of N alerts arriving before the
    // first callback ran all passed `shouldDebounce` (no stamp yet),
    // all queued, and all executed — the burst-collapse contract was
    // a noop under load. Stamping at schedule time fixes it.
    const archiveRoot = await mkdtemp(join(tmpdir(), 'ujima-burst-'));
    tempDirs.push(archiveRoot);
    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);
    const teamStore = createTeamStore();
    const onboarding = new OnboardingService(repo, teamStore);
    await onboarding.onboard({
      organizationName: 'Burst Org',
      ownerName: 'Owner',
      workspaceRoot: archiveRoot,
      providerKeys: { local: 'k' },
      team: {
        channels: [{ name: 'general', kind: 'general', topic: '' }],
        roles: [
          {
            name: 'eng',
            title: 'Eng',
            instructions: 'i',
            workspaceScopes: [],
            tools: [],
            channels: ['general'],
            provider: 'local',
            model: 'm',
          },
        ],
        providers: { local: { kind: 'openai', defaultModel: 'm' } },
        agents: [{ name: 'agent-x', roleName: 'eng', personalityName: 'direct' }],
      },
    });
    const owner = repo
      .listMembers(repo.getLatestOrganization()!.id)
      .find((m) => m.kind === 'human')!;
    const conversations = new ConversationService(repo, noopRealtime());
    const registry = new ActiveSpiritRegistry();
    const spirits = new SpiritService(
      teamStore,
      repo,
      noopRealtime(),
      {
        invoke: async () => ({ ok: true, output: { status: 'completed' } }),
        allowRun: () => undefined,
      },
      {
        modelResolver: () => makeTextOnlyModel('answer'),
        registry,
        conversations,
        supervisorDebounceMs: 60_000,
        supervisorTurnCapPerSession: 100,
      },
    );
    const taskSessions = new TaskSessionService(repo, conversations, spirits);

    const { session } = taskSessions.create({
      organizationId: owner.organizationId,
      requestedBy: owner.id,
      prompt: 'p',
      team: ['agent-x'],
    });
    const sp = spirits.spawn({
      organizationId: owner.organizationId,
      taskSessionId: session.id,
      memberId: 'agent-x',
    });
    spirits.updateStatus(owner.organizationId, sp.id, 'running');

    const general = repo.getChannel(owner.organizationId, 'general')!;
    // Three messages posted synchronously, three handleAlert calls
    // fired before any of their internal awaits resolve. Pre-fix,
    // all three would pass the gate and execute. Post-fix, only the
    // first one stamps the window and runs; the other two are
    // debounced.
    const messages = [0, 1, 2].map((i) =>
      conversations.postToChannel({
        organizationId: owner.organizationId,
        senderId: owner.id,
        channelId: general.id,
        body: `@agent-x burst ${i}`,
      }),
    );
    const promises = messages.map((m) =>
      spirits.handleAlert({
        organizationId: owner.organizationId,
        memberId: 'agent-x',
        messageId: m.id,
        channelId: general.id,
        threadId: m.threadId,
        byMemberId: owner.id,
        reason: 'mention',
      }),
    );
    const results = await Promise.all(promises);
    const replied = results.filter((r) => r.kind === 'replied').length;
    const debounced = results.filter((r) => r.kind === 'debounced').length;

    // Exactly one reply, two debounced — the burst-collapse contract.
    expect(replied).toBe(1);
    expect(debounced).toBe(2);

    // The supervisor counter on the session should have ticked
    // exactly once.
    const refreshed = repo.getTaskSession(owner.organizationId, session.id)!;
    expect(refreshed.supervisorTurnCount).toBe(1);
  });

  // -------------------------------------------------------------------
  // NEW (audit fix): supervisor.todo.* is rejected from worker turns
  // even when the role's tool allowlist names them.
  // -------------------------------------------------------------------
  it('worker turn cannot call supervisor.todo.* even when the role lists them in `tools`', async () => {
    // Role config carries `supervisor.todo.add` in `tools`. Pre-fix,
    // checkToolPolicy unconditionally allowed the supervisor.* family
    // and a regular worker invocation slipped through. Post-fix, the
    // bypass is gated on `spiritRole === 'supervisor'`, so a worker
    // invocation (no spiritRole tag, or spiritRole='worker') is
    // refused even when the role explicitly names the tool.
    //
    // We bypass `OnboardingService` here because that path goes
    // through `loadAgentTeam`'s starter-tools catalog and doesn't
    // forward a custom `tools` map. To reproduce the misconfiguration
    // the audit flagged ("an admin lists supervisor.todo.* on a
    // worker role"), we build the team handle directly with a
    // catalog that includes those tool ids.
    const archiveRoot = await mkdtemp(join(tmpdir(), 'ujima-supervisor-gate-'));
    tempDirs.push(archiveRoot);
    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);
    const teamStore = createTeamStore();

    const team = AgentTeam({
      name: 'Gate Org',
      workspace: { root: archiveRoot, roleScopes: {} },
      tools: {
        'supervisor.todo.add': {
          id: 'supervisor.todo.add',
          name: 'supervisor.todo.add',
          description: 'Supervisor add (test catalog entry)',
          actions: ['message'],
          pathScopes: [],
          requiresApproval: false,
        },
        'supervisor.todo.list': {
          id: 'supervisor.todo.list',
          name: 'supervisor.todo.list',
          description: 'Supervisor list (test catalog entry)',
          actions: ['read'],
          pathScopes: [],
          requiresApproval: false,
        },
      },
      providers: { local: { kind: 'openai', defaultModel: 'm' } },
      roles: [
        {
          name: 'naughty-eng',
          title: 'Naughty Eng',
          instructions: 'i',
          // The exploit surface: role allowlist contains supervisor.todo.*.
          tools: ['supervisor.todo.add', 'supervisor.todo.list'],
          channels: ['general'],
          provider: 'local',
          model: 'm',
        },
      ],
      channels: [{ name: 'general', kind: 'general', topic: '' }],
      agents: [{ name: 'naughty-x', roleName: 'naughty-eng', personalityName: 'direct' }],
    });
    const orgId = 'gate-org';
    teamStore.setTeam(team, orgId);

    // Persist the org + members directly so the repo reads succeed.
    repo.saveOrganization(
      OrganizationSchema.parse({
        id: orgId,
        name: 'Gate Org',
        workspace: { root: archiveRoot, roleScopes: {} },
        organizationChart: { reportsTo: {} },
      }),
    );
    repo.saveMember(
      MemberSchema.parse({
        id: 'owner-1',
        organizationId: orgId,
        name: 'Owner',
        kind: 'human',
        roleName: 'owner',
        presence: 'offline',
        createdAt: new Date().toISOString(),
      }),
    );
    repo.saveMember(
      MemberSchema.parse({
        id: 'naughty-x',
        organizationId: orgId,
        name: 'naughty-x',
        kind: 'agent',
        roleName: 'naughty-eng',
        presence: 'offline',
        createdAt: new Date().toISOString(),
      }),
    );
    repo.saveChannel(
      ChannelSchema.parse({
        id: 'general',
        organizationId: orgId,
        name: 'general',
        kind: 'general',
        topic: '',
        memberIds: ['owner-1', 'naughty-x'],
      }),
    );
    repo.setChannelMembers('general', ['owner-1', 'naughty-x']);

    const conversations = new ConversationService(repo, noopRealtime());
    const supervisorTodos = new SupervisorTodoService(repo);
    const approvalRequester: ApprovalRequester = {
      requestApproval: () => ({ id: 'fake-approval-id' }),
    };
    const tools = new ToolServiceImpl(
      teamStore,
      repo,
      approvalRequester,
      conversations,
      noopRealtime(),
      supervisorTodos,
    );
    const taskSessions = new TaskSessionService(repo, conversations);

    const { session } = taskSessions.create({
      organizationId: orgId,
      requestedBy: 'owner-1',
      prompt: 'p',
      team: ['naughty-x'],
    });
    const owner = { id: 'owner-1', organizationId: orgId };

    // Worker-mode invocation — no spiritRole, mimicking what a
    // worker turn (or a misuse path) would emit. The role allowlist
    // permits supervisor.todo.add but the policy gate must refuse.
    const workerCall = await tools.invoke({
      organizationId: owner.organizationId,
      runId: 'r',
      memberId: 'naughty-x',
      threadId: session.channelId,
      toolCallId: 'tc-1',
      toolId: 'supervisor.todo.add',
      action: 'message',
      resourceType: 'message',
      input: { body: 'should not land' },
      permissionMcpId: 'supervisor',
      taskSessionId: session.id,
      // spiritRole intentionally omitted — i.e. `worker` semantics.
    });
    expect(workerCall.ok).toBe(false);
    expect(workerCall.error).toMatch(/supervisor-only|SUPERVISOR_TOOL_ALLOWLIST/);

    // Even an explicit spiritRole='worker' tag is refused.
    const explicitWorkerCall = await tools.invoke({
      organizationId: owner.organizationId,
      runId: 'r',
      memberId: 'naughty-x',
      threadId: session.channelId,
      toolCallId: 'tc-2',
      toolId: 'supervisor.todo.add',
      action: 'message',
      resourceType: 'message',
      input: { body: 'still should not land' },
      permissionMcpId: 'supervisor',
      taskSessionId: session.id,
      spiritRole: 'worker',
    });
    expect(explicitWorkerCall.ok).toBe(false);

    // No todos were written.
    expect(supervisorTodos.list({ organizationId: owner.organizationId, taskSessionId: session.id }))
      .toHaveLength(0);

    // Sanity: the supervisor path still works for the same tool.
    const supervisorCall = await tools.invoke({
      organizationId: owner.organizationId,
      runId: 'r',
      memberId: 'naughty-x',
      threadId: session.channelId,
      toolCallId: 'tc-3',
      toolId: 'supervisor.todo.add',
      action: 'message',
      resourceType: 'message',
      input: { body: 'legit supervisor jot' },
      permissionMcpId: 'supervisor',
      taskSessionId: session.id,
      spiritRole: 'supervisor',
    });
    expect(supervisorCall.ok).toBe(true);
    expect(
      supervisorTodos.list({ organizationId: owner.organizationId, taskSessionId: session.id }),
    ).toHaveLength(1);
  });

  // -------------------------------------------------------------------
  // NEW (audit fix): start() pre-validates the entire team. A retired
  // member surfaces an error WITHOUT spawning any spirits, leaving the
  // session cleanly retriable.
  // -------------------------------------------------------------------
  it('start() pre-validates the team — a retired member fails without spawning anything', async () => {
    const fixture = await createFixture({
      agentNames: ['frontend-alice', 'frontend-bob'],
    });
    tempDirs.push(fixture.archiveRoot);

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'cooperate',
      team: ['frontend-alice', 'frontend-bob'],
    });

    // Retire the second member AFTER the session was created — the
    // exact scenario the audit called out. Pre-fix, the loop would
    // spawn alice (success), then throw on bob, leaving a half-started
    // session with alice's spirit + run rows persisted and registered.
    const bob = fixture.repo.getMember(fixture.organizationId, 'frontend-bob')!;
    fixture.repo.saveMember({ ...bob, retiredAt: new Date().toISOString() });

    await expect(
      fixture.taskSessions.start(fixture.organizationId, session.id),
    ).rejects.toThrow(/retired/);

    // No spirits, no runs, registry empty for either member, session
    // status untouched. The whole start() call is now all-or-nothing.
    expect(fixture.spirits.list(fixture.organizationId, session.id)).toHaveLength(0);
    expect(
      fixture.registry.hasActiveForMember(fixture.organizationId, 'frontend-alice'),
    ).toBe(false);
    expect(
      fixture.registry.hasActiveForMember(fixture.organizationId, 'frontend-bob'),
    ).toBe(false);
    const refreshed = fixture.repo.getTaskSession(fixture.organizationId, session.id)!;
    expect(refreshed.status).toBe('queued');
  });

  it('atomic create — a failure inside the transaction leaves no orphan channels/threads', async () => {
    const archiveRoot = await mkdtemp(join(tmpdir(), 'ujima-atomic-'));
    tempDirs.push(archiveRoot);
    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);
    const teamStore = createTeamStore();
    const onboarding = new OnboardingService(repo, teamStore);
    await onboarding.onboard({
      organizationName: 'Atomic Org',
      ownerName: 'Owner',
      workspaceRoot: archiveRoot,
      providerKeys: { local: 'k' },
      team: {
        channels: [{ name: 'general', kind: 'general', topic: '' }],
        roles: [
          {
            name: 'eng',
            title: 'Eng',
            instructions: 'i',
            workspaceScopes: [],
            tools: [],
            channels: ['general'],
            provider: 'local',
            model: 'm',
          },
        ],
        providers: { local: { kind: 'openai', defaultModel: 'm' } },
        agents: [{ name: 'agent-x', roleName: 'eng', personalityName: 'direct' }],
      },
    });
    const owner = repo.listMembers(repo.getLatestOrganization()!.id).find((m) => m.kind === 'human')!;

    // Wrap repo so saveTaskSession throws — simulates a UNIQUE collision
    // race past allocateSlug. Every other write in the tx body should
    // ROLLBACK as a result.
    const orgId = owner.organizationId;
    const wrappedRepo: ApiRepository = new Proxy(repo, {
      get(target, prop) {
        if (prop === 'saveTaskSession') {
          return () => {
            throw new Error('simulated UNIQUE collision');
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as ApiRepository;

    const conversations = new ConversationService(wrappedRepo, noopRealtime());
    const taskSessions = new TaskSessionService(wrappedRepo, conversations);

    expect(() =>
      taskSessions.create({
        organizationId: orgId,
        requestedBy: owner.id,
        prompt: 'will fail',
        team: ['agent-x'],
        slug: 'doomed',
      }),
    ).toThrow(/simulated UNIQUE collision/);

    // The whole point of the transaction: the channel and thread that
    // saveChannel/ensureThread wrote inside the tx must have rolled
    // back. The org should now look exactly as it did before the
    // failed create — no orphan task-run row, no orphan thread, no
    // members table debris.
    expect(repo.getChannel(orgId, taskRunChannelId(orgId, 'doomed'))).toBeNull();
    expect(repo.getThread(orgId, taskRunChannelId(orgId, 'doomed'))).toBeNull();
    expect(repo.getTaskSessionBySlug(orgId, 'doomed')).toBeNull();
    expect(repo.listAllChannels(orgId).some((c) => c.kind === 'task-run')).toBe(false);
  });

  // -------------------------------------------------------------------
  // NEW (audit fix): start() spawn loop is atomic — a mid-loop spawn
  // failure (member retired AFTER pre-flight) rolls back earlier
  // spirits/runs and leaves the registry empty.
  // -------------------------------------------------------------------
  it('start() rolls back earlier spirits when a later spawn fails (mid-loop atomicity)', async () => {
    const fixture = await createFixture({
      agentNames: ['frontend-alice', 'frontend-bob'],
    });
    tempDirs.push(fixture.archiveRoot);

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'cooperate',
      team: ['frontend-alice', 'frontend-bob'],
    });

    // Simulate the TOCTOU window the audit flagged: the member is
    // alive at pre-flight but is retired before its spawn() call
    // executes. We can't easily race a real retirement inside the
    // synchronous tx body, so we monkey-patch the spirits service
    // to make the second spawn throw — which exercises the same
    // rollback path the real race would hit. start() goes through
    // spawnTracked() (the audit-fixed variant that returns
    // {spirit, created}), so we patch that one.
    const realSpawnTracked = fixture.spirits.spawnTracked.bind(fixture.spirits);
    let spawnsObserved = 0;
    fixture.spirits.spawnTracked = (input) => {
      spawnsObserved += 1;
      if (input.memberId === 'frontend-bob') {
        throw new Error('simulated retirement race during spawn');
      }
      return realSpawnTracked(input);
    };

    await expect(
      fixture.taskSessions.start(fixture.organizationId, session.id),
    ).rejects.toThrow(/simulated retirement race/);

    // Both members were attempted (we hit the failure on bob, but
    // alice already ran). Rollback must have undone alice's spirit,
    // run row, AND her registry entry — alice was newly created in
    // this call, so the selective rollback removes her too.
    expect(spawnsObserved).toBe(2);
    expect(fixture.spirits.list(fixture.organizationId, session.id)).toHaveLength(0);
    expect(
      fixture.registry.hasActiveForMember(fixture.organizationId, 'frontend-alice'),
    ).toBe(false);
    expect(
      fixture.registry.hasActiveForMember(fixture.organizationId, 'frontend-bob'),
    ).toBe(false);

    // Session status untouched — still queued, fully retriable.
    const refreshed = fixture.repo.getTaskSession(fixture.organizationId, session.id)!;
    expect(refreshed.status).toBe('queued');

    // Sanity: a second start() with a clean spirits service succeeds.
    fixture.spirits.spawnTracked = realSpawnTracked;
    const result = await fixture.taskSessions.start(fixture.organizationId, session.id);
    expect(result.spirits).toHaveLength(2);
    expect(result.session.status).toBe('running');
  });

  // -------------------------------------------------------------------
  // NEW (audit fix): supervisor debounce keyed by (member, session).
  // A member with two live sessions can receive separate alerts on
  // each within the debounce window — neither suppresses the other.
  // -------------------------------------------------------------------
  it('debounce is keyed per session — alerts for two live sessions of one member both fire', async () => {
    // Use a long debounce so any cross-session leakage shows up
    // immediately as a `debounced` result on the second call.
    const archiveRoot = await mkdtemp(join(tmpdir(), 'ujima-debounce-cross-'));
    tempDirs.push(archiveRoot);
    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);
    const teamStore = createTeamStore();
    const onboarding = new OnboardingService(repo, teamStore);
    await onboarding.onboard({
      organizationName: 'Cross Debounce Org',
      ownerName: 'Owner',
      workspaceRoot: archiveRoot,
      providerKeys: { local: 'k' },
      team: {
        channels: [{ name: 'general', kind: 'general', topic: '' }],
        roles: [
          {
            name: 'eng',
            title: 'Eng',
            instructions: 'i',
            workspaceScopes: [],
            tools: [],
            channels: ['general'],
            provider: 'local',
            model: 'm',
          },
        ],
        providers: { local: { kind: 'openai', defaultModel: 'm' } },
        agents: [{ name: 'agent-x', roleName: 'eng', personalityName: 'direct' }],
      },
    });
    const owner = repo
      .listMembers(repo.getLatestOrganization()!.id)
      .find((m) => m.kind === 'human')!;
    const conversations = new ConversationService(repo, noopRealtime());
    const registry = new ActiveSpiritRegistry();
    const spirits = new SpiritService(
      teamStore,
      repo,
      noopRealtime(),
      {
        invoke: async () => ({ ok: true, output: { status: 'completed' } }),
        allowRun: () => undefined,
      },
      {
        modelResolver: () => makeTextOnlyModel('answer'),
        registry,
        conversations,
        supervisorDebounceMs: 60_000,
        supervisorTurnCapPerSession: 100,
      },
    );
    const taskSessions = new TaskSessionService(repo, conversations, spirits);

    // Two sessions for the same member, with a small wait so the
    // newer session sorts above the older one in the registry's
    // newest-first ordering. Each gets its own active spirit.
    const { session: sessionA } = taskSessions.create({
      organizationId: owner.organizationId,
      requestedBy: owner.id,
      prompt: 'work A',
      team: ['agent-x'],
      slug: 'task-a',
    });
    const spiritA = spirits.spawn({
      organizationId: owner.organizationId,
      taskSessionId: sessionA.id,
      memberId: 'agent-x',
    });
    spirits.updateStatus(owner.organizationId, spiritA.id, 'running');
    await new Promise((r) => setTimeout(r, 5));
    const { session: sessionB } = taskSessions.create({
      organizationId: owner.organizationId,
      requestedBy: owner.id,
      prompt: 'work B',
      team: ['agent-x'],
      slug: 'task-b',
    });
    const spiritB = spirits.spawn({
      organizationId: owner.organizationId,
      taskSessionId: sessionB.id,
      memberId: 'agent-x',
    });
    spirits.updateStatus(owner.organizationId, spiritB.id, 'running');

    const general = repo.getChannel(owner.organizationId, 'general')!;

    // 1) Alert routes to sessionB (newest-first ordering).
    const askB = conversations.postToChannel({
      organizationId: owner.organizationId,
      senderId: owner.id,
      channelId: general.id,
      body: '@agent-x first ping (B)',
    });
    const dispatchB = await spirits.handleAlert({
      organizationId: owner.organizationId,
      memberId: 'agent-x',
      messageId: askB.id,
      channelId: general.id,
      threadId: askB.threadId,
      byMemberId: owner.id,
      reason: 'mention',
    });
    expect(dispatchB.kind).toBe('replied');

    // 2) A second alert that should target sessionA. We have no
    // direct way to "address" a session from handleAlert (the alert
    // just identifies the member); the registry returns newest-first
    // and sessionB is still the newest. So in practice the way a
    // second-session alert reaches its session is via a fresh
    // alert AFTER sessionB completes — but the deeper invariant
    // we're testing is the keying itself: that the debounce stamp
    // for sessionB doesn't suppress an alert that ends up routed to
    // sessionA.
    //
    // To exercise the per-session key cleanly we retire sessionB's
    // spirit so the next alert routes to sessionA. Pre-fix, the
    // member-keyed debounce stamp from step 1 would suppress this
    // alert (different session, same member, same window). Post-
    // fix the (member, sessionId) key isolates the windows so the
    // alert goes through.
    spirits.retire(owner.organizationId, spiritB.id, 'test');

    const askA = conversations.postToChannel({
      organizationId: owner.organizationId,
      senderId: owner.id,
      channelId: general.id,
      body: '@agent-x second ping (A)',
    });
    const dispatchA = await spirits.handleAlert({
      organizationId: owner.organizationId,
      memberId: 'agent-x',
      messageId: askA.id,
      channelId: general.id,
      threadId: askA.threadId,
      byMemberId: owner.id,
      reason: 'mention',
    });
    expect(dispatchA.kind).toBe('replied');
    if (dispatchA.kind !== 'replied') return;
    expect(dispatchA.outcome.taskSessionId).toBe(sessionA.id);

    // Both sessions ticked once.
    const refreshedA = repo.getTaskSession(owner.organizationId, sessionA.id)!;
    const refreshedB = repo.getTaskSession(owner.organizationId, sessionB.id)!;
    expect(refreshedA.supervisorTurnCount).toBe(1);
    expect(refreshedB.supervisorTurnCount).toBe(1);
  });

  // -------------------------------------------------------------------
  // NEW (audit fix): SpiritService.run() does not commit a spirit row
  // when model resolution fails. Pre-fix, spawn() ran first and the
  // ghost spirit lingered in the registry/DB.
  // -------------------------------------------------------------------
  it('SpiritService.run() leaves no spirit behind when modelResolver throws', async () => {
    const archiveRoot = await mkdtemp(join(tmpdir(), 'ujima-run-validation-'));
    tempDirs.push(archiveRoot);
    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);
    const teamStore = createTeamStore();
    const onboarding = new OnboardingService(repo, teamStore);
    await onboarding.onboard({
      organizationName: 'Run Validation Org',
      ownerName: 'Owner',
      workspaceRoot: archiveRoot,
      providerKeys: { local: 'k' },
      team: {
        channels: [{ name: 'general', kind: 'general', topic: '' }],
        roles: [
          {
            name: 'eng',
            title: 'Eng',
            instructions: 'i',
            workspaceScopes: [],
            tools: [],
            channels: ['general'],
            provider: 'local',
            model: 'm',
          },
        ],
        providers: { local: { kind: 'openai', defaultModel: 'm' } },
        agents: [{ name: 'agent-x', roleName: 'eng', personalityName: 'direct' }],
      },
    });
    const owner = repo
      .listMembers(repo.getLatestOrganization()!.id)
      .find((m) => m.kind === 'human')!;
    const conversations = new ConversationService(repo, noopRealtime());
    const registry = new ActiveSpiritRegistry();
    const spirits = new SpiritService(
      teamStore,
      repo,
      noopRealtime(),
      {
        invoke: async () => ({ ok: true, output: { status: 'completed' } }),
        allowRun: () => undefined,
      },
      {
        // Resolver always throws — simulates a missing provider key,
        // a misconfigured model id, an upstream network blip during
        // model construction, etc.
        modelResolver: () => {
          throw new Error('simulated provider resolution failure');
        },
        registry,
        conversations,
      },
    );
    const taskSessions = new TaskSessionService(repo, conversations, spirits);

    const { session } = taskSessions.create({
      organizationId: owner.organizationId,
      requestedBy: owner.id,
      prompt: 'p',
      team: ['agent-x'],
    });

    await expect(
      spirits.run({
        organizationId: owner.organizationId,
        taskSessionId: session.id,
        memberId: 'agent-x',
      }),
    ).rejects.toThrow(/simulated provider resolution failure/);

    // The critical assertions: NO spirit row exists, and the
    // registry has no ghost entry. Pre-fix, spawn() had already
    // run and committed both before the resolver was called.
    expect(spirits.list(owner.organizationId, session.id)).toHaveLength(0);
    expect(repo.getSpiritByTriple(owner.organizationId, session.id, 'agent-x', 'worker')).toBeNull();
    expect(registry.hasActiveForMember(owner.organizationId, 'agent-x')).toBe(false);
  });

  // -------------------------------------------------------------------
  // NEW (audit fix): start() rollback unregisters ONLY spirits this
  // call created. A pre-existing spirit (from a prior partial start
  // or a different code path) keeps its registry entry intact.
  // -------------------------------------------------------------------
  it('start() rollback leaves pre-existing spirits in the registry untouched', async () => {
    const fixture = await createFixture({
      agentNames: ['frontend-alice', 'frontend-bob'],
    });
    tempDirs.push(fixture.archiveRoot);

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'cooperate',
      team: ['frontend-alice', 'frontend-bob'],
    });

    // Pre-create alice's spirit (e.g. from a prior partial start or
    // an explicit spawn). She is now actively registered before this
    // test's start() call ever runs.
    const preExisting = fixture.spirits.spawn({
      organizationId: fixture.organizationId,
      taskSessionId: session.id,
      memberId: 'frontend-alice',
    });
    expect(
      fixture.registry.hasActiveForMember(fixture.organizationId, 'frontend-alice'),
    ).toBe(true);
    const preExistingDbRow = fixture.repo.getSpirit(fixture.organizationId, preExisting.id);
    expect(preExistingDbRow).not.toBeNull();

    // Now make bob's spawn fail. Pre-fix: rollback would unregister
    // BOTH alice (returned by spawnTracked as `created: false`) and
    // anything else, blinding the supervisor gate to the still-valid
    // alice spirit. Post-fix: only newly-created spirits land in the
    // `created` list, so alice survives the rollback.
    const realSpawnTracked = fixture.spirits.spawnTracked.bind(fixture.spirits);
    fixture.spirits.spawnTracked = (input) => {
      if (input.memberId === 'frontend-bob') {
        throw new Error('simulated bob-spawn failure');
      }
      return realSpawnTracked(input);
    };

    await expect(
      fixture.taskSessions.start(fixture.organizationId, session.id),
    ).rejects.toThrow(/simulated bob-spawn failure/);

    // The critical assertion: alice's pre-existing registry entry
    // and DB row both survive. Without the audit fix, the rollback
    // loop would have unregistered her.
    expect(
      fixture.registry.hasActiveForMember(fixture.organizationId, 'frontend-alice'),
    ).toBe(true);
    expect(fixture.repo.getSpirit(fixture.organizationId, preExisting.id)).not.toBeNull();

    // Bob never made it; nothing for him in either store.
    expect(
      fixture.registry.hasActiveForMember(fixture.organizationId, 'frontend-bob'),
    ).toBe(false);
  });

  // -------------------------------------------------------------------
  // NEW (audit fix): completion's tokensUsed accounting is robust to
  // any usage shape — the V3-style nested usage from MockLanguageModelV3
  // and the flat usage AI SDK normalises to both work; non-numeric
  // leaks coerce to 0 instead of failing SpiritSchema.parse.
  // -------------------------------------------------------------------
  it('completion handles V3-shape usage and never poisons SpiritSchema with a non-number', async () => {
    // Run the multi-turn loop end-to-end with the V3-mock model and
    // assert the spirit reaches `completed` with a finite tokensUsed.
    // Pre-fix this could blow up SpiritSchema.parse if the AI SDK
    // surfaced anything other than flat numbers from the V3 usage.
    const fixture = await createFixture({
      staticModel: makeStreamingModel([
        { type: 'text-start', id: '1' },
        { type: 'text-delta', id: '1', delta: 'Done.' },
        { type: 'text-end', id: '1' },
        {
          type: 'finish',
          usage: v3Usage(123, 45),
          finishReason: { unified: 'stop' as const, raw: 'stop' },
        },
      ]),
    });
    tempDirs.push(fixture.archiveRoot);

    const { session } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'usage shape test',
      team: ['frontend-alice'],
    });

    const outcome = await fixture.spirits.run({
      organizationId: fixture.organizationId,
      taskSessionId: session.id,
      memberId: 'frontend-alice',
    });

    // SpiritSchema enforces tokensUsed: z.number().int().min(0), so
    // a non-number would have failed the parse and thrown — meaning
    // a clean .completed status is the test of "we coerced safely".
    expect(outcome.spirit.status).toBe('completed');
    expect(Number.isFinite(outcome.spirit.tokensUsed)).toBe(true);
    expect(outcome.spirit.tokensUsed).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(outcome.spirit.tokensUsed)).toBe(true);
  });

  // -------------------------------------------------------------------
  // NEW (audit fix): start() refuses terminal sessions. A retry on
  // a completed/failed/cancelled session must throw, not silently
  // spawn fresh spirits attached to finished work.
  // -------------------------------------------------------------------
  it('start() rejects terminal sessions (completed / failed / cancelled)', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      const { session } = fixture.taskSessions.create({
        organizationId: fixture.organizationId,
        requestedBy: fixture.ownerId,
        prompt: `${status} retry test`,
        team: ['frontend-alice'],
        slug: `${status}-retry`,
      });
      // Force the session into a terminal state by writing through
      // the repo. updateStatus() goes through the normal status
      // alphabet so we use it as the production path would.
      fixture.taskSessions.updateStatus(fixture.organizationId, session.id, status, {
        summary: `${status} for test`,
        completedAt: new Date().toISOString(),
      });

      await expect(
        fixture.taskSessions.start(fixture.organizationId, session.id),
      ).rejects.toThrow(/terminal/i);

      // No spirits spawned after the rejection.
      expect(fixture.spirits.list(fixture.organizationId, session.id)).toHaveLength(0);
      // Status untouched.
      const refreshed = fixture.repo.getTaskSession(fixture.organizationId, session.id)!;
      expect(refreshed.status).toBe(status);
    }
  });

  // -------------------------------------------------------------------
  // NEW (audit fix): pre-existing spirit's registry rank is preserved
  // when a later spawn in start() fails. spawnTracked() must NOT
  // bump `registeredAt` for existing spirits, because the bump
  // outlives the SQL rollback and would mis-order the supervisor
  // gate against newer sessions.
  // -------------------------------------------------------------------
  it("failed start() does not reshuffle a pre-existing spirit's registry order", async () => {
    const fixture = await createFixture({
      agentNames: ['frontend-alice', 'frontend-bob'],
    });
    tempDirs.push(fixture.archiveRoot);

    // Two sessions for alice. Session A first, then session B.
    // Without any registry bumps, B is the newest (highest
    // registeredAt) and the supervisor would pick it.
    const { session: sessionA } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'A',
      team: ['frontend-alice'],
      slug: 'task-a',
    });
    const aliceA = fixture.spirits.spawn({
      organizationId: fixture.organizationId,
      taskSessionId: sessionA.id,
      memberId: 'frontend-alice',
    });
    fixture.spirits.updateStatus(fixture.organizationId, aliceA.id, 'running');

    await new Promise((r) => setTimeout(r, 5));

    const { session: sessionB } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'B',
      team: ['frontend-alice', 'frontend-bob'],
      slug: 'task-b',
    });
    const aliceB = fixture.spirits.spawn({
      organizationId: fixture.organizationId,
      taskSessionId: sessionB.id,
      memberId: 'frontend-alice',
    });
    fixture.spirits.updateStatus(fixture.organizationId, aliceB.id, 'running');

    // Sanity: B is currently first (newest) for alice.
    let active = fixture.registry.getActiveForMember(
      fixture.organizationId,
      'frontend-alice',
    );
    expect(active[0]?.spiritId).toBe(aliceB.id);

    // Now start sessionA again. spawnTracked will see alice's
    // existing aliceA spirit and (pre-fix) bump its registeredAt,
    // putting A ahead of B. Then bob's spawn fails inside start(),
    // SQL rolls back, but the bumped counter survives. Post-fix,
    // the bump never happens for existing spirits.
    const realSpawnTracked = fixture.spirits.spawnTracked.bind(fixture.spirits);
    fixture.spirits.spawnTracked = (input) => {
      if (input.memberId === 'frontend-bob') {
        throw new Error('simulated bob failure');
      }
      return realSpawnTracked(input);
    };

    // SessionA's team is just ['frontend-alice'], so to exercise the
    // bug we need a session where alice is mixed with a failing
    // member. We'll restart sessionB (which has both) to trigger
    // the path: alice exists → spawnTracked returns existing
    // (no bump under fix), bob throws → rollback.
    await expect(
      fixture.taskSessions.start(fixture.organizationId, sessionB.id),
    ).rejects.toThrow(/simulated bob failure/);

    // Critical: aliceB is still first. Pre-fix, aliceA's refreshed
    // registeredAt would have made it newest after the failed start,
    // and the supervisor would route to sessionA on the next mention.
    active = fixture.registry.getActiveForMember(
      fixture.organizationId,
      'frontend-alice',
    );
    expect(active[0]?.spiritId).toBe(aliceB.id);
    expect(active.map((e) => e.spiritId)).toEqual([aliceB.id, aliceA.id]);

    // End-to-end: a fresh @mention still routes to sessionB.
    fixture.spirits.spawnTracked = realSpawnTracked;
    const general = fixture.repo.getChannel(fixture.organizationId, 'general')!;
    const ask = fixture.conversations.postToChannel({
      organizationId: fixture.organizationId,
      senderId: fixture.ownerId,
      channelId: general.id,
      body: '@frontend-alice status?',
    });
    const dispatch = await fixture.spirits.handleAlert({
      organizationId: fixture.organizationId,
      memberId: 'frontend-alice',
      messageId: ask.id,
      channelId: general.id,
      threadId: ask.threadId,
      byMemberId: fixture.ownerId,
      reason: 'mention',
    });
    expect(dispatch.kind).toBe('replied');
    if (dispatch.kind !== 'replied') return;
    expect(dispatch.outcome.taskSessionId).toBe(sessionB.id);
  });

  // -------------------------------------------------------------------
  // NEW (audit fix): duplicate team member ids in create() are deduped
  // before persistence so start() doesn't spawn/run the same agent
  // twice. Channel membership and the persisted teamMemberIds field
  // both reflect a single instance of each member.
  // -------------------------------------------------------------------
  it('create() dedupes duplicate team member ids', async () => {
    const fixture = await createFixture({
      agentNames: ['frontend-alice', 'frontend-bob'],
    });
    tempDirs.push(fixture.archiveRoot);

    // Caller passes alice twice and bob once. Pre-fix, the session
    // row would persist ['frontend-alice', 'frontend-alice',
    // 'frontend-bob'] and start() would spawn alice twice.
    const { session, channel } = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'dedup test',
      team: ['frontend-alice', 'frontend-alice', 'frontend-bob'],
    });

    // Persisted teamMemberIds is unique.
    expect(session.teamMemberIds.sort()).toEqual(['frontend-alice', 'frontend-bob']);

    // Channel membership was already deduped via the explicit
    // `Array.from(new Set(...))` call in create() — confirm that
    // still holds with the input-level dedupe.
    expect(channel?.memberIds.sort()).toEqual(
      [fixture.ownerId, 'frontend-alice', 'frontend-bob'].sort(),
    );

    // start() spawns one spirit per team member — exactly two,
    // not three.
    const result = await fixture.taskSessions.start(fixture.organizationId, session.id);
    expect(result.spirits).toHaveLength(2);
    expect(result.spirits.map((s) => s.memberId).sort()).toEqual([
      'frontend-alice',
      'frontend-bob',
    ]);
  });

  // -------------------------------------------------------------------
  // NEW (audit fix): two creators racing the same slug both succeed —
  // one wins the original slug, the other gets a deterministic
  // suffix instead of an unhandled UNIQUE-violation.
  // -------------------------------------------------------------------
  it('concurrent same-slug create()s both succeed; loser gets a suffixed slug', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    // Pre-seed a row at the target slug to simulate the "racing
    // creator already committed" half of the race. The next
    // create() with the same slug must observe the UNIQUE violation
    // inside its transaction and retry with a suffix instead of
    // bubbling SqliteError.
    const first = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'parallel work',
      team: ['frontend-alice'],
      slug: 'parallel',
    });
    expect(first.session.slug).toBe('parallel');

    // Second create() with the same explicit slug — pre-fix this
    // would throw with "UNIQUE constraint failed" because
    // allocateSlug's optimistic probe couldn't see in-flight
    // transactions of a peer creator. Post-fix the transaction
    // catches the violation and retries with the next suffix.
    const second = fixture.taskSessions.create({
      organizationId: fixture.organizationId,
      requestedBy: fixture.ownerId,
      prompt: 'parallel work',
      team: ['frontend-alice'],
      slug: 'parallel',
    });
    expect(second.session.slug).not.toBe('parallel');
    expect(second.session.slug.startsWith('parallel-')).toBe(true);

    // Both task-run channels exist with non-colliding ids.
    expect(first.session.channelId).not.toBe(second.session.channelId);
    expect(fixture.repo.getChannel(fixture.organizationId, first.session.channelId)).not.toBeNull();
    expect(fixture.repo.getChannel(fixture.organizationId, second.session.channelId)).not.toBeNull();

    // The loser used the org-namespaced channel id helper too —
    // proves we didn't accidentally cross orgs.
    expect(second.session.channelId).toBe(
      taskRunChannelId(fixture.organizationId, second.session.slug),
    );
  });
});
