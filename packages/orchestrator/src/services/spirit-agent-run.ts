import { stepCountIs, tool, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { classifyTool, type McpToolDescriptor } from '@ujima/shared';
import { toModelToolErrorOutput, toModelToolOutput } from './tool-loop-result.js';
import type { SpiritMcpResolution } from './spirit-types.js';
import { mcpPermissionToolName } from './mcp-runtime.js';
import {
  buildMcpNamespace,
  mcpToolInputSchema,
  sanitizeMcpToolName,
  uniqueMcpToolId,
  type McpServerSummary,
} from './spirit-mcp-helpers.js';
import {
  SocketEventNames,
  channelRoom,
  orgRoom,
  type Message,
  type ReasoningEffort,
  type RunState,
  type Spirit,
  type SpiritRole,
  type WakeReason,
} from '@ujima/shared';
import { type AgentTeamHandle, buildAgentSystemPrompt, normalizeProviderKey } from '@ujima/framework';
import { resolveVisiblePromptChannels } from '../utils/visible-prompt-channels.js';
import { runAgentWithRetry, type AgentLoopChunk, type AgentLoopStep, type HumanPause } from './agent-loop.js';
import { requireTeam } from '../utils/require-team.js';
import { applyDashboardTeamOverrides } from './dashboard-team-overrides.js';
import {
  resolveSpiritModel,
  makeProviderModelsInUseLookup,
  defaultResolveModelId,
} from '../utils/to-model-messages.js';
import {
  listEffectiveAgentToolIds,
} from '../tools/index.js';
import type { ApiRepository } from './repository-reader.js';
import {
  createMessageCursor,
  loadChannelInterruptModelMessages,
} from '../utils/interrupt-loader.js';
import { wrapToolCallsAsCards } from '../utils/step-tool-calls.js';
import { buildAgentStepMessages, prepareAgentStepPublication } from './agent-step-publish.js';
import { buildAgentMessage } from './message-factory.js';
import { collectCursorPages } from '../utils/cursor-pages.js';
import type { RunTurnPublisher } from './run-turn-publisher.js';
import type {
  RunSpiritInput,
  RunSpiritOutcome,
} from './spirit-types.js';
import { SpiritServiceBase } from './spirit-service-base.js';
import type { AgentLoopLogger } from '../debug/agent-loop-logger.js';
import type { SpiritRunState } from './spirit-run-state.js';
import { buildRunContext } from './agent-run-context.js';
import { ToolPaletteBuilder } from './tool-palette-builder.js';
import { RunStatePersister } from './run-state-persister.js';
import {
  AgentTurn,
  type AgentTurnLoopInput,
  type DirectRunReplyInput,
} from './agent-turn.js';

export class SpiritServiceAgentRun extends SpiritServiceBase {
  private _paletteBuilder: ToolPaletteBuilder | undefined;
  private _runStatePersister: RunStatePersister | undefined;
  private readonly agentTurn: AgentTurn;

  constructor(...args: ConstructorParameters<typeof SpiritServiceBase>) {
    super(...args);
    this.agentTurn = new AgentTurn({
      repo: this.repo,
      realtime: this.realtime,
      conversations: this.conversations,
      resolveDirectRunContext: (organizationId, agentId) => ({
        team: requireTeam(this.teamStore, organizationId),
        member: this.repo.getMember(organizationId, agentId),
      }),
      applyDashboardTeamOverrides: (organizationId) =>
        applyDashboardTeamOverrides(this.repo, organizationId, this.teamStore),
      generateRunReply: (input: DirectRunReplyInput) => this.generateRunReply(input),
      detectRunPauseForHuman: this.detectRunPauseForHuman.bind(this),
      emitRunChunk: this.emitRunChunk.bind(this),
      emitRunTokens: this.emitRunTokens.bind(this),
      runKey: this.runKey.bind(this),
      registerAbortController: (key, controller) => this.runAbortControllers.set(key, controller),
      unregisterAbortController: (key) => this.runAbortControllers.delete(key),
      saveRunAndEmit: this.saveRunAndEmit.bind(this),
      consumeDeferredApprovalResume: this.consumeDeferredApprovalResume.bind(this),
      executePendingApprovedRunTools: this.executePendingApprovedRunTools.bind(this),
      resolveTerminatingTool: this.resolveTerminatingTool.bind(this),
      getRooms: this.getRooms.bind(this),
      invokeRunTerminalHook: this.invokeRunTerminalHook.bind(this),
      completeRun: this.completeRun.bind(this),
      completeSilentRun: this.completeSilentRun.bind(this),
      persistSilentTrace: this.persistSilentTrace.bind(this),
      waitForApproval: this.waitForApproval.bind(this),
      waitForInput: this.waitForInput.bind(this),
      failRun: this.failRun.bind(this),
      modelResolver: this.modelResolver,
      maxIterationsPerRun: this.maxIterationsPerRun,
      resolveMemberAgentRole: this.resolveMemberAgentRole.bind(this),
      resolveToolAllowlist: this.resolveToolAllowlist.bind(this),
      buildWakeToolPalette: this.buildWakeToolPalette.bind(this),
      resolveSystemPromptSuffix: this.resolveSystemPromptSuffix.bind(this),
      spawn: this.spawn.bind(this),
      executeAgentLoop: (input: AgentTurnLoopInput) => this.executeAgentLoop(input),
      saveRunningSpirit: (spirit) => {
        this.repo.saveSpirit(spirit);
        this.registry.register(spirit);
        return spirit;
      },
      saveTerminalSpirit: this.saveTerminalSpirit.bind(this),
      saveWaitingSpirit: this.saveWaitingSpirit.bind(this),
      emitSpirit: this.emit.bind(this),
      publishAgentMessage: this.publishAgentMessage.bind(this),
      publishStepBubble: this.publishStepBubble.bind(this),
      maybeFinalizeTaskSession: this.maybeFinalizeTaskSession.bind(this),
      writeRunErrorStep: this.writeRunErrorStep.bind(this),
    });
  }

  private get paletteBuilder(): ToolPaletteBuilder {
    if (!this._paletteBuilder) {
      this._paletteBuilder = new ToolPaletteBuilder({
        repo: this.repo,
        tools: this.tools,
        mcpPool: this.mcpPool,
        attachmentApprovalRequester: this.attachmentApprovalRequester,
        attachmentCapture: this.attachmentCapture,
        buildMcpToolDefinitions: (ctx) => this.buildMcpToolDefinitions(ctx),
      });
    }
    return this._paletteBuilder;
  }

  private get runStatePersister(): RunStatePersister {
    if (!this._runStatePersister) {
      this._runStatePersister = new RunStatePersister({
        runs: this.repo,
        members: this.repo,
        realtime: this.realtime,
        registry: this.registry,
        teamStore: this.teamStore,
      });
    }
    return this._runStatePersister;
  }

  protected resolveMemberAgentRole(
    organizationId: string,
    memberId: string,
  ): { team: AgentTeamHandle; organization: NonNullable<ReturnType<ApiRepository['getOrganization']>>; member: NonNullable<ReturnType<ApiRepository['getMember']>>; agent: NonNullable<ReturnType<AgentTeamHandle['getAgent']>>; role: NonNullable<ReturnType<AgentTeamHandle['getRole']>> } {
    const team = requireTeam(this.teamStore, organizationId);
    const organization = this.repo.getOrganization(organizationId);
    if (!organization) throw new Error(`Organization not found: ${organizationId}`);
    const member = this.repo.getMember(organizationId, memberId);
    if (!member) throw new Error(`Member not found: ${memberId}`);
    const agent = team.getAgent(member.id) ?? team.getAgent(member.name);
    if (!agent) throw new Error(`Agent not found: ${member.id}`);
    const role = team.getRole(agent.roleName);
    if (!role) throw new Error(`Role not found: ${agent.roleName}`);
    return { team, organization, member, agent, role };
  }

  protected buildWakeToolPalette(params: Parameters<ToolPaletteBuilder['buildWakeToolPalette']>[0]): ReturnType<ToolPaletteBuilder['buildWakeToolPalette']> {
    return this.paletteBuilder.buildWakeToolPalette(params);
  }

  private saveTerminalSpirit(runState: SpiritRunState, running: Spirit): Spirit {
    return this.runStatePersister.saveTerminal(runState, running);
  }

  private saveWaitingSpirit(runState: SpiritRunState, running: Spirit): Spirit {
    return this.runStatePersister.saveWaiting(runState, running);
  }

  protected executeDirectTurn(
    run: RunState,
    eventName: typeof SocketEventNames.runStarted | typeof SocketEventNames.runUpdated = SocketEventNames.runUpdated,
  ): Promise<RunState> {
    return this.agentTurn.executeDirectTurn(run, eventName);
  }

  protected completeRun(
    run: RunState,
    summary: string,
    terminatingTool: string | null = null,
  ): RunState {
    const completed = this.saveRunAndEmit(SocketEventNames.runCompleted, {
      ...run,
      status: 'completed',
      step: 'completed',
      summary,
      terminatingTool,
      endedAt: new Date().toISOString(),
    });
    this.invokeRunTerminalHook(completed);
    return completed;
  }

  protected completeSilentRun(
    run: RunState,
    summary: string,
    terminatingTool: string,
    wakeReason: WakeReason | null,
  ): RunState {
    this.realtime.emit(
      SocketEventNames.runSilentCompletion,
      {
        organizationId: run.organizationId,
        runId: run.id,
        memberId: run.agentId,
        wakeReason: wakeReason ?? undefined,
        occurredAt: new Date().toISOString(),
      },
      this.getRooms(run),
    );
    return this.completeRun(run, summary, terminatingTool);
  }

  protected persistSilentTrace(run: RunState, reasoningContent?: string): void {
    if (!run.threadId || !reasoningContent) return;
    const channelId = this.repo.getThread(run.organizationId, run.threadId)?.channelId;
    const message = buildAgentMessage({
      organizationId: run.organizationId,
      threadId: run.threadId,
      channelId,
      senderId: run.agentId,
      content: '',
      reasoningContent,
      metadata: { runId: run.id, traceOnly: true },
    });
    if (this.conversations) {
      this.conversations.publishMessage(message, [], undefined, {
        wakePolicy: 'never',
        skipMentionResolution: true,
      });
    } else {
      this.repo.saveMessage(message);
    }
  }

  protected waitForApproval(run: RunState, summary: string): RunState {
    const waiting = this.saveRunAndEmit(SocketEventNames.runUpdated, {
      ...run,
      status: 'waiting_for_approval',
      step: 'waiting_for_approval',
      summary,
    });
    this.invokeRunTerminalHook(waiting);
    return waiting;
  }

  protected waitForInput(run: RunState, summary: string): RunState {
    const waiting = this.saveRunAndEmit(SocketEventNames.runUpdated, {
      ...run,
      status: 'waiting_for_input',
      step: 'waiting_for_input',
      summary,
    });
    this.invokeRunTerminalHook(waiting);
    return waiting;
  }

  protected failRun(run: RunState, summary: string): RunState {
    const failed = this.saveRunAndEmit(SocketEventNames.runCompleted, {
      ...run,
      status: 'failed',
      step: 'failed',
      summary,
      endedAt: new Date().toISOString(),
    });
    this.invokeRunTerminalHook(failed);
    return failed;
  }

  protected async executePendingApprovedRunTools(run: RunState): Promise<RunState> {
    await this.replayApprovedToolsForRun(run);
    return run;
  }

  protected async executeAgentLoop(params: {
    model: LanguageModel;
    systemPrompt: string;
    messages: ModelMessage[];
    toolDefs: ToolSet;
    attachedMcpServers: McpServerSummary[];
    maxIterations: number;
    organizationId: string;
    runId: string;
    channelId: string;
    threadId: string;
    memberId: string;
    interruptCursor: ReturnType<typeof createMessageCursor>;
    contextMessages: ModelMessage[];
    sourceMessage: Message | null;
    extraPrompt?: string;
    sessionPrompt?: string;
    spirit?: { runId?: string | null; id: string; taskSessionId: string };
    runState?: SpiritRunState;
    turn?: RunTurnPublisher;
    debugLogger: AgentLoopLogger;
    member: { id: string };
    teamRoot?: string;
    abortSignal: AbortSignal;
    onChunk?: (chunk: AgentLoopChunk) => void;
    onStepFinish?: (step: AgentLoopStep, currentSteps: AgentLoopStep[]) => Promise<void>;
    customEmitTokens?: (organizationId: string, runId: string, threadId: string | null, memberId: string, currentSteps: AgentLoopStep[]) => void;
  }): Promise<{
    steps: AgentLoopStep[];
    usage: Awaited<ReturnType<typeof runAgentWithRetry>>['usage'];
    text: string;
    streamedReasoning: string;
    persistedStepCount: number;
    sawTerminatingTool: boolean;
    rawResult: Awaited<ReturnType<typeof runAgentWithRetry>>;
  }> {
    const debugLogger = params.debugLogger;
    const runState = params.onStepFinish ? undefined : params.runState;
    const turn = params.onStepFinish ? undefined : params.turn;
    const member = params.member;
    const messages = params.messages;
    let streamedReasoning = '';
    let persistedStepCount = 0;

    const result = await runAgentWithRetry({
      model: params.model,
      system: params.systemPrompt,
      messages,
      tools: params.toolDefs,
      attachedMcpServers: params.attachedMcpServers,
      stopWhen: stepCountIs(params.maxIterations),
      maxOutputTokens: this.maxOutputTokens,
      temperature: this.temperature,
      toolChoice: 'auto',
      abortSignal: params.abortSignal,
      detectExternalPause: () => this.detectRunPauseForHuman(params.organizationId, params.runId),
      onChunk: (chunk) => {
        const c = chunk as { kind: string; delta: string };
        if (c.kind === 'reasoning') streamedReasoning += c.delta;
        debugLogger.handleChunk(chunk as AgentLoopChunk);
        if (params.onChunk) {
          params.onChunk(chunk as AgentLoopChunk);
        } else {
          this.emitRunChunk(
            { organizationId: params.organizationId, runId: params.runId, threadId: params.channelId, agentId: params.memberId },
            chunk as AgentLoopChunk,
          );
        }
      },
      onStepFinish: async (_step, currentSteps) => {
        await debugLogger.handleStepFinish(_step);
        if (params.onStepFinish) {
          await params.onStepFinish(_step, currentSteps);
        } else if (runState !== undefined && turn !== undefined && params.spirit !== undefined) {
          const unpersisted = currentSteps.slice(persistedStepCount);
          for (const s of unpersisted) {
            persistedStepCount++;
            const out = await this.publishStepBubble({
              step: s,
              spirit: params.spirit,
              turn,
              organizationId: params.organizationId,
              channelId: params.channelId,
              senderId: member.id,
              teamRoot: params.teamRoot ?? '',
              runId: params.runId,
            });
            runState.trackStep(out.toolCallCount, {
              input: s.usage?.inputTokens,
              output: s.usage?.outputTokens,
            });
            if (out.messageId) runState.lastMessageId = out.messageId;
            if (out.stepText) runState.lastText = out.stepText;
          }
        }
        const emitTokens = params.customEmitTokens ?? this.emitRunTokens.bind(this);
        emitTokens(params.organizationId, params.runId, params.channelId, member.id, currentSteps);
      },
      loadInterruptMessages: () =>
        loadChannelInterruptModelMessages({
          repo: this.repo,
          organizationId: params.organizationId,
          channelId: params.channelId,
          agentId: member.id,
          cursor: params.interruptCursor,
          runId: params.runId,
        }),
      logLabel: 'spirit-agent-run',
      memberLabel: params.memberId,
    }, {
      onContextLengthExceeded: async (error) => {
        throw new Error(
          `compaction required: context length exceeded for thread ${params.threadId}. ` +
            `Run explicit conversation compaction and retry. ${error.message}`,
        );
      },
    });

    const { steps, usage } = result;

    debugLogger.setTokenUsage({
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      totalTokens: usage?.totalTokens,
    });
    debugLogger.flush().catch(() => undefined);

    return {
      steps,
      usage,
      text: result.text.trim(),
      streamedReasoning,
      persistedStepCount,
      sawTerminatingTool: false,
      rawResult: result,
    };
  }

  async generateRunReply(
    input: {
      organizationId: string;
      agentId: string;
      threadId: string;
      runId: string;
      summary?: string;
      systemPromptSuffix?: string;
      additionalToolIds?: readonly string[];
      abortSignal?: AbortSignal;
      onChunk?: (chunk: AgentLoopChunk) => PromiseLike<void> | void;
      onStepFinish?: (step: AgentLoopStep, steps: AgentLoopStep[]) => PromiseLike<void> | void;
      detectExternalPause?: () => HumanPause | null;
    },
  ): Promise<Awaited<ReturnType<typeof runAgentWithRetry>>> {
    const { team, organization, member, agent, role } = this.resolveMemberAgentRole(input.organizationId, input.agentId);

    const runRow = this.repo.getRun?.(input.organizationId, input.runId);
    const sourceMessageId = (runRow?.sourceMessageId ?? undefined) as string | undefined;
    const sourceMessage = sourceMessageId ? this.repo.getMessage(input.organizationId, sourceMessageId) : null;
    const reasoningEffort = sourceMessage?.metadata?.reasoningEffort as ReasoningEffort | undefined;

    const model = await resolveSpiritModel({
      organizationId: input.organizationId,
      memberId: input.agentId,
      role: 'worker' as SpiritRole,
      member,
      team,
      getProviderCredential: (orgId, key) => this.repo.getProviderCredential(orgId, key),
      resolveProviderName: (m, r) => normalizeProviderKey(m.llm ?? r.provider ?? ''),
      reasoningEffort,
      resolveModelId: defaultResolveModelId,
      listConfiguredProviders: () => this.repo.listProviderCredentials(input.organizationId),
      listProviderModelsInUse: makeProviderModelsInUseLookup(this.repo, input.organizationId),
    });

    const wakeReason = (runRow?.wakeReason ?? null) as WakeReason | null;
    const wakePalette = await this.buildWakeToolPalette({
      organizationId: input.organizationId,
      memberId: input.agentId,
      runId: input.runId,
      threadId: input.threadId,
      sourceMessage,
      wakeReason,
      roleToolIds: [
        ...new Set([...listEffectiveAgentToolIds(role.tools), ...(input.additionalToolIds ?? [])]),
      ],
      team,
      taskSessionId: '',
      role: 'worker' as SpiritRole,
    });
    const { toolDefs, attachedMcpServers, availableConnectors, wakeReplyPolicy } = wakePalette;

    const availableToolIds = Object.keys(toolDefs);
    const availableSkills = this.repo.listOrganizationSkillInstalls?.(input.organizationId) ?? [];
    const baseSystemPrompt = buildAgentSystemPrompt(
      team.workspace.root,
      organization.name,
      member.id,
      member.name,
      input.threadId,
      agent,
      role,
      this.repo.listMembers(input.organizationId).filter((m) => m.id !== member.id),
      team.agents,
      resolveVisiblePromptChannels(team.channels, this.repo, input.organizationId),
      organization.organizationChart,
      availableSkills,
      availableToolIds,
      attachedMcpServers.map((s) => ({ name: s.serverName, toolNames: s.toolNames })),
      wakeReplyPolicy.conversationKind,
      availableConnectors,
      model,
    );

    const cultureChannelId = input.threadId
      ? this.repo.getThread(input.organizationId, input.threadId)?.channelId
      : undefined;
    const threadMessages = collectCursorPages((cursor) =>
      this.repo.listMessages(input.organizationId, input.threadId, cursor, 600),
    );

    const runCtx = await buildRunContext({
      organizationId: input.organizationId,
      agentId: input.agentId,
      threadId: input.threadId,
      channelId: cultureChannelId,
      runId: input.runId,
      model,
      team,
      repo: this.repo,
      baseSystemPrompt,
      sourceMessage,
      wakeReason,
      summary: input.summary,
      systemPromptSuffix: input.systemPromptSuffix,
      toolDefs,
      mcpServers: attachedMcpServers,
      threadMessages,
    });

    const interruptCursor = createMessageCursor(runCtx.promptHistoryMessages);
    const debugLogger = runCtx.debugLogger;

    const onStepFinish: ((step: AgentLoopStep, steps: AgentLoopStep[]) => Promise<void>) | undefined =
      input.onStepFinish
        ? async (step, steps) => { await input.onStepFinish?.(step, steps); }
        : undefined;

    const loopResult = await this.executeAgentLoop({
      model,
      systemPrompt: runCtx.system,
      messages: runCtx.messages,
      toolDefs,
      attachedMcpServers,
      maxIterations: this.maxIterationsPerRun,
      organizationId: input.organizationId,
      runId: input.runId,
      channelId: cultureChannelId ?? input.threadId,
      threadId: input.threadId,
      memberId: input.agentId,
      interruptCursor,
      contextMessages: runCtx.contextMessages,
      sourceMessage,
      debugLogger,
      member: { id: member.id },
      abortSignal: input.abortSignal ?? new AbortController().signal,
      onChunk: input.onChunk
        ? (chunk) => { input.onChunk?.(chunk); }
        : undefined,
      onStepFinish,
      customEmitTokens: undefined,
    });

    return loopResult.rawResult;
  }

  async run(input: RunSpiritInput): Promise<RunSpiritOutcome> {
    return this.agentTurn.executeTurn(input);
  }

  protected resolveToolAllowlist(
    roleTools: readonly string[],
    role: SpiritRole,
    override: readonly string[] | undefined,
  ): readonly string[] {
    return this.paletteBuilder.resolveToolAllowlist(roleTools, role, override);
  }

  protected buildToolDefinitions(
    toolIds: readonly string[],
    ctx: {
      organizationId: string;
      runId: string;
      memberId: string;
      threadId: string;
      taskSessionId: string;
      spiritRole: SpiritRole;
      team: AgentTeamHandle;
      repo?: ApiRepository;
    },
  ): ToolSet {
    return this.paletteBuilder.buildToolDefinitions(toolIds, ctx);
  }

  private async publishStepBubble(input: {
    step: AgentLoopStep;
    spirit: { taskSessionId: string; runId?: string | null };
    turn: RunTurnPublisher;
    organizationId: string;
    channelId: string;
    senderId: string;
    teamRoot: string;
    runId: string;
    reasoningFallback?: string;
  }): Promise<{ messageId?: string; toolCallCount: number; stepText: string }> {
    const prepared = await prepareAgentStepPublication({
      step: input.step,
      teamRoot: input.teamRoot,
      reasoningFallback: input.reasoningFallback,
      suppressSilentTerminatorText: true,
    });
    if (!prepared) {
      const stepToolCalls = Array.isArray(input.step.toolCalls) ? input.step.toolCalls : [];
      return { toolCallCount: stepToolCalls.length, stepText: '' };
    }

    const wrapped = wrapToolCallsAsCards(prepared.stepToolCalls, {
      taskSessionId: input.spirit.taskSessionId,
      runId: input.spirit.runId ?? undefined,
    });
    const messageToolCalls = [
      ...wrapped,
      ...prepared.cards,
      ...(prepared.artifact ? [prepared.artifact] : []),
    ];
    let message: Message | undefined;
    const stepMessages = buildAgentStepMessages({
      organizationId: input.organizationId,
      threadId: input.channelId,
      channelId: input.channelId,
      senderId: input.senderId,
      runId: input.runId,
      prepared,
      toolCalls: messageToolCalls,
      metadata: { runId: input.runId },
    });
    for (const stepMessage of stepMessages) {
      message = input.turn.publishMessage(stepMessage);
    }
    if (prepared.artifactPublished) input.turn.markArtifactFilePublished();
    return {
      messageId: message?.id,
      toolCallCount: prepared.toolCallCount,
      stepText: prepared.stepText,
    };
  }

  private publishAgentMessage(message: Message): Message {
    const existing = this.repo.getMessage(message.organizationId, message.id);
    const saved = existing
      ? this.repo.updateMessage({
          ...message,
          createdAt: existing.createdAt,
          editedAt: new Date().toISOString(),
        })
      : this.repo.saveMessage(message);
    this.realtime.emit(
      SocketEventNames.channelMessage,
      {
        organizationId: saved.organizationId,
        channelId: saved.channelId ?? '',
        message: saved,
      },
      [orgRoom(saved.organizationId), channelRoom(saved.channelId ?? '')],
    );
    return saved;
  }

  private writeRunErrorStep(input: {
    organizationId: string;
    runId: string;
    threadId: string;
    agentId: string;
    error: string;
  }): void {
    this.repo.saveRunStep?.({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      runId: input.runId,
      threadId: input.threadId,
      agentId: input.agentId,
      toolCallId: `run-error-${input.runId}`,
      toolId: 'agent.run',
      action: 'execute',
      resourceType: 'message',
      resourcePath: '',
      input: {},
      output: { error: input.error },
      status: 'error',
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Flag-routed MCP tool palette resolver used by both the spirit-run
   * loop and wake-run paths. Wraps both legacy `buildMcpToolDefinitions`
   * and V2 `buildMcpToolDefinitionsV2` so every spawn surface routes
   * through the same §3.5 rule 3 flag gate.
   */
  buildMcpToolDefinitionsRouted(ctx: Parameters<ToolPaletteBuilder['buildMcpToolDefinitionsRouted']>[0]): ReturnType<ToolPaletteBuilder['buildMcpToolDefinitionsRouted']> {
    return this.paletteBuilder.buildMcpToolDefinitionsRouted(ctx);
  }

  async buildMcpToolDefinitions(ctx: {
    organizationId: string;
    memberId: string;
    runId: string;
    threadId: string;
    taskSessionId: string;
    role: SpiritRole;
  }): Promise<{ toolSet: ToolSet; servers: McpServerSummary[] }> {
    if (!this.mcpPool || !this.mcpResolver) return { toolSet: {} as ToolSet, servers: [] };
    let resolutions: SpiritMcpResolution[];
    try {
      resolutions = await this.mcpResolver({
        organizationId: ctx.organizationId,
        memberId: ctx.memberId,
        role: ctx.role,
      });
    } catch {
      return { toolSet: {} as ToolSet, servers: [] };
    }
    if (resolutions.length === 0) return { toolSet: {} as ToolSet, servers: [] };

    type ToolEntry = readonly [
      string,
      {
        toolName: string;
        description: string;
        serverId: string;
        serverName: string;
        inputSchema?: Record<string, unknown>;
      },
    ];
    const entries: ToolEntry[] = [];
    const servers: McpServerSummary[] = [];
    const usedToolIds = new Set<string>();
    const pool = this.mcpPool;
    for (const resolution of resolutions) {
      // Two separate try blocks: the listTools fallback must NOT mask
      // failures from the post-fetch seed writes. Pre-fix a single
      // try/catch wrapped both, so a transient DB lock on the cache
      // write would land in the catch and overwrite the freshly
      // fetched live tools with stale cache data (or an empty list)
      // — the agent silently lost its MCP tools even though the
      // server had responded successfully.
      let toolList: McpToolDescriptor[] = [];
      try {
        const connection = await pool.get(resolution.def, { agentId: ctx.memberId });
        const liveTools = await connection.listTools();
        toolList = liveTools.map((t) => {
          const declared = typeof (t as { destructive?: boolean }).destructive === 'boolean'
            ? (t as { destructive?: boolean }).destructive
            : undefined;
          return {
            name: t.name,
            description: t.description ?? '',
            inputSchema:
              t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema)
                ? (t.inputSchema as Record<string, unknown>)
                : undefined,
            ...(declared !== undefined ? { destructive: declared } : {}),
          };
        });
      } catch {
        toolList = this.repo.getMcpToolCache(ctx.organizationId, resolution.serverId)?.tools ?? [];
      }

      // Post-fetch seeds: refresh the tool cache AND insert inferred
      // classifications. The cache write makes a runtime spawn the
      // equivalent of an MCP Test for governance-UI visibility — the
      // Tools tab and `requireTool` both read from mcp_tool_cache, so
      // without this write a brand-new server's tools couldn't be
      // governed from the UI until the operator manually ran Test.
      // The classifications seed uses INSERT OR IGNORE so manual
      // overrides survive; the cache write uses UPSERT and is safe to
      // repeat concurrently.
      //
      // Failures here are non-fatal — they don't justify throwing
      // away the toolList we just fetched. Log and move on so the
      // agent keeps its palette and a transient lock doesn't strand
      // it from its MCP.
      if (toolList.length > 0) {
        try {
          this.repo.saveMcpToolCache({
            mcpServerId: resolution.serverId,
            organizationId: ctx.organizationId,
            tools: toolList,
            fetchedAt: new Date().toISOString(),
          });
        } catch (err) {
          console.warn(
            `[spirit-agent-run] failed to write mcp_tool_cache for server="${resolution.serverId}":`,
            err,
          );
        }
        try {
          const seedEntries = toolList.map((d) => {
            const inf = classifyTool({
              name: d.name,
              description: d.description,
              category: resolution.def.category,
              declaredDestructive: d.destructive,
            });
            return {
              toolName: d.name,
              risk: inf.risk,
              needsReview: inf.needsReview,
              reason: inf.reason,
            };
          });
          this.repo.seedInferredClassifications(
            ctx.organizationId,
            resolution.serverId,
            seedEntries,
          );
        } catch (err) {
          console.warn(
            `[spirit-agent-run] failed to seed mcp_tool_classifications for server="${resolution.serverId}":`,
            err,
          );
        }
      }

      // Per-tool grant filter. When the agent has at least one row in
      // agent_tool_attachments for this server *that applies to the
      // current spirit role*, narrow the palette to those tools.
      // Zero matching rows = "all tools" mode (back-compat).
      //
      // Role filter is load-bearing: a worker-only grant must not flip
      // the palette into allowlist mode for supervisor runs, and vice
      // versa. Pre-fix the scope column was stored but the filter
      // ignored it, so a worker grant could erase the supervisor's
      // tools or expose them to the wrong role entirely.
      const grants = this.repo.listAgentToolAttachments(
        ctx.organizationId,
        ctx.memberId,
        resolution.serverId,
      );
      const applicableGrants = grants.filter(
        (g) => g.scope === ctx.role || g.scope === 'both',
      );
      if (applicableGrants.length > 0) {
        const allowedNames = new Set(applicableGrants.map((g) => g.toolName));
        toolList = toolList.filter((t) => allowedNames.has(t.name));
      }

      const nsSlug = buildMcpNamespace(resolution.serverName, resolution.serverId);
      if (toolList.length > 0) {
        servers.push({
          serverName: resolution.serverName,
          serverId: resolution.serverId,
          toolNames: toolList.map((t) => t.name),
        });
      }
      for (const t of toolList) {
        const baseToolId = `mcp__${nsSlug}__${sanitizeMcpToolName(t.name)}`;
        const aiToolId = uniqueMcpToolId(baseToolId, resolution.serverId, t.name, usedToolIds);
        entries.push([
          aiToolId,
          {
            toolName: t.name,
            description: t.description || `${resolution.serverName}.${t.name}`,
            serverId: resolution.serverId,
            serverName: resolution.serverName,
            inputSchema:
              t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema)
                ? (t.inputSchema as Record<string, unknown>)
                : undefined,
          },
        ]);
      }
    }
    const toolSet = Object.fromEntries(
      entries.map(([aiToolId, entry]) => [
        aiToolId,
        tool({
          description: entry.description,
          inputSchema: mcpToolInputSchema(entry.inputSchema),
          execute: async (rawArgs, { toolCallId }) => {
            const args = (rawArgs ?? {}) as Record<string, unknown>;
            const invokeMeta: Parameters<typeof this.tools.invoke>[0] = {
              organizationId: ctx.organizationId,
              runId: ctx.runId,
              memberId: ctx.memberId,
              threadId: ctx.threadId,
              taskSessionId: ctx.taskSessionId,
              spiritRole: ctx.role,
              toolCallId,
              toolId: 'mcp',
              action: 'mcp',
              resourceType: 'mcp',
              resourcePath: `${entry.serverId}:${entry.toolName}`,
              permissionMcpId: entry.serverId,
              // Synthetic id namespaces MCP tools away from built-in tool ids
              // (e.g. `self.note`) for the legacy allowed_tools match path.
              // Governance reads the raw name from input.toolName below.
              permissionToolName: mcpPermissionToolName(entry.serverId, entry.toolName),
              input: {
                mcpServerId: entry.serverId,
                mcpServerName: entry.serverName,
                toolName: entry.toolName,
                args,
              },
            };

            try {
              const result = await this.tools.invoke(invokeMeta);
              return toModelToolOutput(result);
            } catch (error) {
              return toModelToolErrorOutput(error);
            }
          },
        }),
      ]),
    ) as ToolSet;
    return { toolSet, servers };
  }
}
