import type { LanguageModel, ModelMessage, ToolSet } from 'ai';
import {
  SocketEventNames,
  SpiritSchema,
  type Message,
  type RunState,
  type Spirit,
  type SpiritRole,
  type WakeReason,
} from '@ujima/shared';
import { type AgentTeamHandle, buildAgentSystemPrompt } from '@ujima/framework';
import type { ConversationService } from './conversation.js';
import type { RealtimeService } from './context.js';
import type {
  ApiRepository,
  ChannelStore,
  MemberStore,
  MessageStore,
  RunStore,
} from './repository-reader.js';
import { resolveVisiblePromptChannels } from '../utils/visible-prompt-channels.js';
import { collectCursorPages } from '../utils/cursor-pages.js';
import { selectPromptContextMessages } from '../utils/prompt-context.js';
import { createMessageCursor } from '../utils/interrupt-loader.js';
import { buildRunContext } from './agent-run-context.js';
import { extractReasoningChunk } from '../utils/extract-reasoning.js';
import { appendArtifactFileToolCall } from './artifact-file-card.js';
import {
  buildAgentStepMessages,
  composedStepToolCalls,
  prepareAgentStepPublication,
} from './agent-step-publish.js';
import {
  appendArtifactFileFromRunSteps,
  collectRunStepToolCalls,
  collectRunStepToolResults,
  collectToolStatuses,
  publishRunReplyTrace,
  publishStreamedTrace,
  type StreamedRunTrace,
} from './run-trace-publisher.js';
import { normalizeTokenUsage } from './token-usage.js';
import { pendingApprovalRunSummary } from './approval-summary.js';
import { errorMessage } from '../utils/error-message.js';
import { findToolApprovalRequiredError, findToolInputRequiredError } from './tool-loop-result.js';
import {
  findTerminatingTool,
  findTerminatingToolFromRunSteps,
  normalizeToDottedToolName,
  runUsedChannelPass,
  runUsedThreadPublishingTool,
} from './run-reply-guard.js';
import type { PublishMessageOptions } from './conversation.js';
import type { AgentLoopChunk, AgentLoopStep, HumanPause } from './agent-loop.js';
import type { AgentLoopLogger } from '../debug/agent-loop-logger.js';
import type { McpServerSummary } from './spirit-mcp-helpers.js';
import type { AgentTurnStore } from './repository-reader.js';
import type { RunSpiritInput, RunSpiritOutcome, SpawnSpiritInput } from './spirit-types.js';
import { RunTurnPublisher } from './run-turn-publisher.js';
import { SpiritRunState } from './spirit-run-state.js';
import type { ToolPaletteBuilder } from './tool-palette-builder.js';
import type { runAgentWithRetry } from './agent-loop.js';

export type DirectRunStore = RunStore &
  MemberStore &
  MessageStore &
  ChannelStore &
  Pick<ApiRepository, 'listPendingApprovals' | 'getInteractiveQuestion'>;

export interface DirectRunReplyInput {
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
}

export type DirectRunReply = Awaited<ReturnType<typeof runAgentWithRetry>>;

const VISIBLE_TERMINATING_TOOLS = new Set(['message', 'channel.post', 'channel.reply', 'channel.handoff']);

function isDelegateRun(
  run: RunState,
  repo: Pick<DirectRunStore, 'getMessage'>,
): boolean {
  if (!run.sourceMessageId || typeof repo.getMessage !== 'function') return false;
  const source = repo.getMessage(run.organizationId, run.sourceMessageId);
  return !!(source?.metadata as { delegate?: unknown } | undefined)?.delegate;
}

export interface DirectAgentTurnHost {
  repo: DirectRunStore;
  realtime: RealtimeService;
  conversations?: ConversationService;
  resolveDirectRunContext(organizationId: string, agentId: string): {
    team: AgentTeamHandle;
    member: NonNullable<ReturnType<DirectRunStore['getMember']>> | null;
  };
  applyDashboardTeamOverrides(organizationId: string): void;
  resolveSystemPromptSuffix(input: {
    organizationId: string;
    threadId?: string;
    wakeReason?: string | null;
  }): string | undefined;
  generateRunReply(input: DirectRunReplyInput): Promise<DirectRunReply>;
  detectRunPauseForHuman(organizationId: string, runId: string): HumanPause | null;
  emitRunChunk(
    input: { organizationId: string; runId: string; threadId?: string | null; agentId: string },
    chunk: AgentLoopChunk,
  ): void;
  emitRunTokens(
    organizationId: string,
    runId: string,
    threadId: string | null | undefined,
    memberId: string,
    currentSteps: readonly { usage?: unknown }[],
  ): void;
  consumeDeferredApprovalResume(organizationId: string, runId: string): boolean;
  executePendingApprovedRunTools(run: RunState): Promise<RunState>;
  completeRun(run: RunState, summary: string, terminatingTool: string | null): RunState;
  completeSilentRun(
    run: RunState,
    summary: string,
    terminatingTool: string,
    wakeReason: WakeReason | null,
  ): RunState;
  persistSilentTrace(run: RunState, reasoningContent?: string): void;
  waitForApproval(run: RunState, summary: string): RunState;
  waitForInput(run: RunState, summary: string): RunState;
  failRun(run: RunState, summary: string): RunState;
}

export interface ResolvedAgentTurnContext {
  team: AgentTeamHandle;
  organization: NonNullable<ReturnType<AgentTurnStore['getOrganization']>>;
  member: NonNullable<ReturnType<AgentTurnStore['getMember']>>;
  agent: NonNullable<ReturnType<AgentTeamHandle['getAgent']>>;
  role: NonNullable<ReturnType<AgentTeamHandle['getRole']>>;
}

export type AgentTurnPaletteInput = Parameters<ToolPaletteBuilder['buildWakeToolPalette']>[0];
export type AgentTurnPalette = Awaited<ReturnType<ToolPaletteBuilder['buildWakeToolPalette']>>;

export interface AgentTurnLoopInput {
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
  customEmitTokens?: (
    organizationId: string,
    runId: string,
    threadId: string | null,
    memberId: string,
    currentSteps: AgentLoopStep[],
  ) => void;
}

export interface AgentTurnLoopResult {
  steps: AgentLoopStep[];
  usage: Awaited<ReturnType<typeof runAgentWithRetry>>['usage'];
  text: string;
  streamedReasoning: string;
  persistedStepCount: number;
  sawTerminatingTool: boolean;
  rawResult: Awaited<ReturnType<typeof runAgentWithRetry>>;
}

export interface AgentTurnHost {
  repo: AgentTurnStore;
  modelResolver: (input: {
    organizationId: string;
    memberId: string;
    role: SpiritRole;
  }) => LanguageModel | Promise<LanguageModel>;
  maxIterationsPerRun: number;
  resolveMemberAgentRole(
    organizationId: string,
    memberId: string,
  ): ResolvedAgentTurnContext;
  resolveToolAllowlist(
    roleTools: readonly string[],
    role: SpiritRole,
    override: readonly string[] | undefined,
  ): readonly string[];
  buildWakeToolPalette(input: AgentTurnPaletteInput): Promise<AgentTurnPalette>;
  resolveSystemPromptSuffix(input: {
    organizationId: string;
    taskSessionId?: string;
    threadId?: string;
    extraSuffix?: string;
    messageContent?: string | null;
    goalMode?: boolean;
    scheduleMode?: boolean;
    wakeReason?: string | null;
  }): string | undefined;
  spawn(input: SpawnSpiritInput): Spirit;
  executeAgentLoop(input: AgentTurnLoopInput): Promise<AgentTurnLoopResult>;
  saveRunningSpirit(spirit: Spirit): Spirit;
  saveTerminalSpirit(runState: SpiritRunState, running: Spirit): Spirit;
  saveWaitingSpirit(runState: SpiritRunState, running: Spirit): Spirit;
  saveRunAndEmit(
    event:
      | typeof SocketEventNames.runStarted
      | typeof SocketEventNames.runUpdated
      | typeof SocketEventNames.runCompleted,
    run: RunState,
  ): RunState;
  getRooms(run: RunState): string[];
  emitSpirit(event: string, spirit: Spirit): void;
  publishStepBubble(input: {
    step: AgentLoopStep;
    spirit: { taskSessionId: string; runId?: string | null };
    turn: RunTurnPublisher;
    organizationId: string;
    channelId: string;
    senderId: string;
    teamRoot: string;
    runId: string;
    reasoningFallback?: string;
  }): Promise<{ messageId?: string; toolCallCount: number; stepText: string }>;
  registerAbortController(key: string, controller: AbortController): void;
  unregisterAbortController(key: string): void;
  runKey(organizationId: string, runId: string): string;
  resolveTerminatingTool(
    organizationId: string,
    runId: string | null | undefined,
    detected: string | null,
  ): string | null;
  invokeRunTerminalHook(run: RunState): void;
  publishAgentMessage(message: Message): Message;
  maybeFinalizeTaskSession(
    organizationId: string,
    taskSessionId: string,
    preferredSummary?: string,
  ): void;
  writeRunErrorStep(input: {
    organizationId: string;
    runId: string;
    threadId: string;
    agentId: string;
    error: string;
  }): void;
}

/** One complete Agent turn. SpiritService remains the public facade. */
export class AgentTurn {
  constructor(private readonly host: AgentTurnHost & DirectAgentTurnHost) {}

  async executeTurn(input: RunSpiritInput): Promise<RunSpiritOutcome> {
    const role = input.role ?? 'worker';
    const session = this.host.repo.getTaskSession(input.organizationId, input.taskSessionId);
    if (!session) throw new Error(`Task session not found: ${input.taskSessionId}`);

    const { team, organization, member, agent, role: teamRole } =
      this.host.resolveMemberAgentRole(input.organizationId, input.memberId);
    const model = await Promise.resolve(
      this.host.modelResolver({
        organizationId: input.organizationId,
        memberId: input.memberId,
        role,
      }),
    );

    const threadMessages = collectCursorPages((cursor) =>
      this.host.repo.listChannelMessages(input.organizationId, session.channelId, {
        cursor,
        limit: 600,
      }),
    );
    const recent = selectPromptContextMessages(threadMessages);
    const interruptCursor = createMessageCursor(recent);
    const spirit = this.host.spawn({
      organizationId: input.organizationId,
      taskSessionId: input.taskSessionId,
      memberId: input.memberId,
      role,
    });
    const running = this.host.saveRunningSpirit(
      SpiritSchema.parse({
        ...spirit,
        status: 'running',
        updatedAt: new Date().toISOString(),
      }),
    );

    if (spirit.runId) {
      const run = this.host.repo.getRun(input.organizationId, spirit.runId);
      if (run) {
        this.host.saveRunAndEmit(SocketEventNames.runUpdated, {
          ...run,
          status: 'running',
          step: 'running',
          summary: 'Spirit turn',
        });
      }
    }
    this.host.emitSpirit(SocketEventNames.spiritUpdated, running);

    const runId = spirit.runId ?? spirit.id;
    const resolvedAllowlist = this.host.resolveToolAllowlist(
      teamRole.tools,
      role,
      input.toolAllowlist,
    );
    const supervisorRunRow = spirit.runId
      ? this.host.repo.getRun(input.organizationId, spirit.runId)
      : undefined;
    const sourceMessage = supervisorRunRow?.sourceMessageId
      ? this.host.repo.getMessage(input.organizationId, supervisorRunRow.sourceMessageId)
      : null;
    const wakePalette = await this.host.buildWakeToolPalette({
      organizationId: input.organizationId,
      memberId: input.memberId,
      runId,
      threadId: session.channelId,
      sourceMessage,
      wakeReason: (supervisorRunRow?.wakeReason ?? null) as WakeReason | null,
      roleToolIds: resolvedAllowlist,
      team,
      taskSessionId: input.taskSessionId,
      role,
    });
    const { toolDefs, attachedMcpServers, availableConnectors, wakeReplyPolicy } = wakePalette;
    const availableSkills = this.host.repo.listOrganizationSkillInstalls?.(input.organizationId) ?? [];
    const visibleChannels = resolveVisiblePromptChannels(
      team.channels,
      this.host.repo,
      input.organizationId,
    );
    const baseSystemPrompt = buildAgentSystemPrompt(
      team.workspace.root,
      organization.name,
      member.id,
      member.name,
      session.channelId,
      agent,
      teamRole,
      this.host.repo
        .listMembers(input.organizationId)
        .filter((current) => current.id !== member.id),
      team.agents,
      visibleChannels,
      organization.organizationChart,
      availableSkills,
      Object.keys(toolDefs),
      attachedMcpServers.map((server) => ({ name: server.serverName, toolNames: server.toolNames })),
      wakeReplyPolicy.conversationKind,
      availableConnectors,
      model,
    );
    const systemPromptSuffix = this.host.resolveSystemPromptSuffix({
      organizationId: input.organizationId,
      taskSessionId: input.taskSessionId,
      threadId: session.channelId,
      extraSuffix: input.systemPromptSuffix,
      messageContent: input.promptMessageContent,
      goalMode: input.promptGoalMode,
      scheduleMode: input.promptScheduleMode,
    });
    const runCtx = await buildRunContext({
      organizationId: input.organizationId,
      agentId: input.memberId,
      threadId: session.channelId,
      channelId: session.channelId,
      runId,
      model,
      team,
      repo: this.host.repo,
      baseSystemPrompt,
      sourceMessage,
      wakeReason: (supervisorRunRow?.wakeReason ?? null) as WakeReason | null,
      systemPromptSuffix,
      extraPrompt: input.extraPrompt,
      toolDefs,
      mcpServers: attachedMcpServers,
      threadMessages,
    });
    const debugLogger = runCtx.debugLogger;
    const runState = new SpiritRunState();
    const turn = new RunTurnPublisher(
      (message) => this.host.publishAgentMessage(message),
      (message) => this.host.repo.updateMessage(message),
    );
    const abortKey = this.host.runKey(input.organizationId, runId);
    const abortController = new AbortController();
    this.host.registerAbortController(abortKey, abortController);

    try {
      const loopResult = await this.host.executeAgentLoop({
        model,
        systemPrompt: runCtx.system,
        messages: runCtx.messages,
        toolDefs,
        attachedMcpServers,
        maxIterations: input.maxIterations ?? this.host.maxIterationsPerRun,
        organizationId: input.organizationId,
        runId,
        channelId: session.channelId,
        threadId: session.channelId,
        memberId: input.memberId,
        interruptCursor,
        contextMessages: runCtx.contextMessages,
        sourceMessage,
        extraPrompt: input.extraPrompt,
        sessionPrompt: session.prompt,
        spirit: { runId: spirit.runId, id: spirit.id, taskSessionId: spirit.taskSessionId },
        runState,
        turn,
        debugLogger,
        member: { id: member.id },
        teamRoot: team.workspace.root,
        abortSignal: abortController.signal,
      });

      const latestAfterLoop = this.host.repo.getRun(input.organizationId, runId);
      if (latestAfterLoop?.status === 'cancelled') {
        return this.completeCancelled(latestAfterLoop, running, runState);
      }

      const { steps, usage, streamedReasoning, persistedStepCount } = loopResult;
      const tokenUsage = normalizeTokenUsage(usage);
      const finalText = loopResult.text;
      const detectedTerminatingTool = findTerminatingTool({ steps, text: finalText });
      for (let index = persistedStepCount; index < steps.length; index++) {
        const step = steps[index];
        if (!step) continue;
        const out = await this.host.publishStepBubble({
          step,
          spirit,
          turn,
          organizationId: input.organizationId,
          channelId: session.channelId,
          senderId: member.id,
          teamRoot: team.workspace.root,
          runId,
          reasoningFallback:
            index === steps.length - 1 ? streamedReasoning.trim() || undefined : undefined,
        });
        runState.trackStep(out.toolCallCount, {
          input: step.usage?.inputTokens,
          output: step.usage?.outputTokens,
        });
        if (out.messageId) runState.lastMessageId = out.messageId;
        if (out.stepText) runState.lastText = out.stepText;
      }

      const persistedRunSteps = spirit.runId
        ? this.host.repo.listRunSteps(input.organizationId, spirit.runId)
        : [];
      const terminatingTool =
        detectedTerminatingTool ?? findTerminatingToolFromRunSteps(persistedRunSteps);
      turn.backfillTokens({
        finalText,
        lastText: runState.lastText,
        terminatingTool,
        usage: tokenUsage,
      });
      runState.complete(finalText, runState.lastMessageId);
      const completed = this.host.saveTerminalSpirit(runState, running);
      const finalTerminatingTool = this.host.resolveTerminatingTool(
        input.organizationId,
        spirit.runId,
        detectedTerminatingTool,
      );
      if (spirit.runId) {
        const run = this.host.repo.getRun(input.organizationId, spirit.runId);
        if (run) {
          const completedRun = this.host.saveRunAndEmit(SocketEventNames.runCompleted, {
            ...run,
            status: 'completed',
            step: 'completed',
            summary: runState.lastText || run.summary,
            endedAt: new Date().toISOString(),
            terminatingTool: finalTerminatingTool,
          });
          this.host.invokeRunTerminalHook(completedRun);
        }
      }
      this.host.emitSpirit(SocketEventNames.spiritCompleted, completed);
      this.host.maybeFinalizeTaskSession(
        completed.organizationId,
        completed.taskSessionId,
        runState.lastText || undefined,
      );
      return {
        spirit: completed,
        finalText: runState.lastText,
        iterations: runState.iteration,
        toolCalls: runState.toolCallCount,
        tokensUsed: runState.totalTokens,
        terminatingTool: finalTerminatingTool,
      };
    } catch (err) {
      debugLogger.flush().catch(() => undefined);
      const latestRun = this.host.repo.getRun(input.organizationId, runId);
      if (latestRun?.status === 'cancelled') {
        return this.completeCancelled(latestRun, running, runState);
      }
      const inputRequiredError = findToolInputRequiredError(err);
      if (inputRequiredError) {
        runState.waitForInput();
        const waiting = this.host.saveWaitingSpirit(runState, running);
        if (spirit.runId) {
          const run = this.host.repo.getRun(input.organizationId, spirit.runId);
          if (run) {
            const question = this.host.repo.getInteractiveQuestion(
              input.organizationId,
              inputRequiredError.questionId,
            );
            this.host.saveRunAndEmit(SocketEventNames.runUpdated, {
              ...run,
              status: 'waiting_for_input',
              step: 'waiting_for_input',
              summary: question?.questionText ?? run.summary ?? 'Waiting for user input',
            });
          }
        }
        this.host.emitSpirit(SocketEventNames.spiritUpdated, waiting);
        return this.waitingOutcome(waiting, runState);
      }
      if (findToolApprovalRequiredError(err)) {
        runState.waitForApproval();
        const waiting = this.host.saveWaitingSpirit(runState, running);
        const pausedRunSteps = spirit.runId
          ? this.host.repo.listRunSteps(input.organizationId, spirit.runId)
          : [];
        const pausedTerminatingTool = findTerminatingToolFromRunSteps(pausedRunSteps);
        if (spirit.runId) {
          const run = this.host.repo.getRun(input.organizationId, spirit.runId);
          if (run) {
            this.host.saveRunAndEmit(SocketEventNames.runUpdated, {
              ...run,
              status: 'waiting_for_approval',
              step: 'waiting_for_approval',
              summary: pendingApprovalRunSummary(this.host.repo, input.organizationId, spirit.runId),
              terminatingTool: pausedTerminatingTool,
            });
          }
        }
        this.host.emitSpirit(SocketEventNames.spiritUpdated, waiting);
        return this.waitingOutcome(waiting, runState, pausedTerminatingTool);
      }

      const message = errorMessage(err);
      console.error('[agent-turn] turn failed', {
        organizationId: input.organizationId,
        memberId: input.memberId,
        runId: spirit.runId,
        error: err instanceof Error ? err.stack ?? err.message : String(err),
      });
      runState.fail(message);
      const failed = this.host.saveTerminalSpirit(runState, running);
      const failedRunSteps = spirit.runId
        ? this.host.repo.listRunSteps(input.organizationId, spirit.runId)
        : [];
      const failedTerminatingTool = findTerminatingToolFromRunSteps(failedRunSteps);
      if (spirit.runId) {
        this.host.writeRunErrorStep({
          organizationId: input.organizationId,
          runId: spirit.runId,
          threadId: session.channelId,
          agentId: input.memberId,
          error: message,
        });
        const run = this.host.repo.getRun(input.organizationId, spirit.runId);
        if (run) {
          this.host.saveRunAndEmit(SocketEventNames.runCompleted, {
            ...run,
            status: 'failed',
            step: 'failed',
            summary: message,
            endedAt: new Date().toISOString(),
            terminatingTool: failedTerminatingTool,
          });
        }
      }
      this.host.emitSpirit(SocketEventNames.spiritCompleted, failed);
      this.host.maybeFinalizeTaskSession(failed.organizationId, failed.taskSessionId, message);
      debugLogger.setError(message);
      debugLogger.flush().catch(() => undefined);
      throw err;
    } finally {
      this.host.unregisterAbortController(abortKey);
    }
  }

  async executeDirectTurn(
    run: RunState,
    eventName: typeof SocketEventNames.runStarted | typeof SocketEventNames.runUpdated = SocketEventNames.runUpdated,
  ): Promise<RunState> {
    const currentRun = this.host.repo.getRun(run.organizationId, run.id);
    if (currentRun && ['completed', 'failed', 'cancelled'].includes(currentRun.status)) {
      return currentRun;
    }

    this.host.applyDashboardTeamOverrides(run.organizationId);
    const { team, member } = this.host.resolveDirectRunContext(run.organizationId, run.agentId);
    if (!member) {
      throw new Error(`Member not found: ${run.agentId}`);
    }
    if (member.retiredAt) {
      return this.host.failRun(run, `Agent retired: ${run.agentId}`);
    }

    const role = team.getRole(member.roleName);
    if (!role) {
      throw new Error(`Role not found: ${member.roleName}`);
    }

    const agent = team.getAgent(member.id) ?? team.getAgent(member.name);
    if (!agent) {
      return this.host.failRun(run, `Agent not found: ${member.id}`);
    }

    // No strict pre-flight on the preferred provider's key. The model resolver
    // handles provider fallback and reports a missing-provider error below.

    const preCancel = this.host.repo.getRun(run.organizationId, run.id);
    if (preCancel?.status === 'cancelled') {
      return preCancel;
    }

    const running = this.host.saveRunAndEmit(eventName, {
      ...run,
      status: 'running',
      step: 'running',
      summary: 'Run executing',
    });

    const postCancel = this.host.repo.getRun(run.organizationId, run.id);
    if (postCancel?.status === 'cancelled') {
      return postCancel;
    }

    const abortKey = this.host.runKey(run.organizationId, run.id);
    const abortController = new AbortController();
    this.host.registerAbortController(abortKey, abortController);
    const streamedTrace: StreamedRunTrace = { text: '', reasoning: '' };
    let persistedStepCount = 0;
    let sawTerminatingTool = false;
    const turn = new RunTurnPublisher(
      (message, options) => {
        this.host.conversations?.publishMessage(message, undefined, undefined, options);
        return message;
      },
      (message) => {
        this.host.repo.updateMessage(message);
      },
    );

    try {
      const sourceMessage = run.sourceMessageId && typeof this.host.repo.getMessage === 'function'
        ? this.host.repo.getMessage(run.organizationId, run.sourceMessageId)
        : null;
      const workflowContext = sourceMessage?.metadata?.workflowContext;
      const systemPromptSuffix = [
        this.host.resolveSystemPromptSuffix({
          organizationId: run.organizationId,
          threadId: run.threadId ?? '',
          wakeReason: run.wakeReason,
        }),
        workflowContext?.systemPromptSuffix,
      ]
        .filter((part): part is string => Boolean(part))
        .join('\n\n') || undefined;
      const additionalToolIds = workflowContext?.toolIds;
      const result = await this.host.generateRunReply({
        organizationId: run.organizationId,
        agentId: run.agentId,
        threadId: run.threadId ?? '',
        runId: run.id,
        systemPromptSuffix,
        additionalToolIds,
        abortSignal: abortController.signal,
        detectExternalPause: () => this.host.detectRunPauseForHuman(run.organizationId, run.id),
        onChunk: (chunk) => {
          if (abortController.signal.aborted) return;
          if (this.host.repo.getRun(run.organizationId, run.id)?.status === 'cancelled') return;
          if (chunk.kind === 'text') streamedTrace.text += chunk.delta;
          if (chunk.kind === 'reasoning') streamedTrace.reasoning += chunk.delta;
          this.host.emitRunChunk(
            {
              organizationId: running.organizationId,
              runId: running.id,
              threadId: running.threadId,
              agentId: running.agentId,
            },
            chunk,
          );
        },
        onStepFinish: async (_step, currentSteps) => {
          if (abortController.signal.aborted) return;
          if (this.host.repo.getRun(run.organizationId, run.id)?.status === 'cancelled') return;
          const unpersisted = currentSteps.slice(persistedStepCount);
          const terminatorState = { sawTerminatingTool };
          for (const s of unpersisted) {
            persistedStepCount++;
            const prepared = await prepareAgentStepPublication({
              step: s,
              teamRoot: team.workspace.root,
              terminatorState,
              resolveRunStepArtifact: (toolCallId) =>
                appendArtifactFileFromRunSteps(this.host.repo, running, team.workspace.root, toolCallId),
              isStepTerminated: (step) => {
                const persistedTerminator = findTerminatingToolFromRunSteps(
                  this.host.repo.listRunSteps(running.organizationId, running.id),
                );
                return (
                  runUsedThreadPublishingTool({ steps: [step] }) || persistedTerminator !== null
                );
              },
            });
            sawTerminatingTool = terminatorState.sawTerminatingTool;
            if (!prepared) continue;
            if (prepared.artifactPublished) turn.markArtifactFilePublished();

            const finalThreadId = running.threadId;
            if (!finalThreadId) continue;
            const channelId = this.host.repo.getThread(running.organizationId, finalThreadId)?.channelId;

            const toolCalls = composedStepToolCalls(prepared);
            const hasVisibleTerminator = toolCalls.some((call) =>
              VISIBLE_TERMINATING_TOOLS.has(normalizeToDottedToolName(call.toolName)),
            );
            const metadata = hasVisibleTerminator
              ? { runId: running.id }
              : { runId: running.id, runProgress: true };
            const publishOptions: PublishMessageOptions | undefined = hasVisibleTerminator
              ? undefined
              : { wakePolicy: 'never' };
            const stepMessages = buildAgentStepMessages({
              organizationId: running.organizationId,
              threadId: finalThreadId,
              channelId: channelId ?? undefined,
              senderId: running.agentId,
              runId: running.id,
              prepared,
              toolCalls,
              metadata,
            });
            for (const stepMessage of stepMessages) {
              if (isDelegateRun(running, this.host.repo)) {
                turn.publishMessage(stepMessage, {
                  suppressDmAlerts: true,
                  skipMentionResolution: true,
                  wakePolicy: 'never',
                });
              } else {
                turn.publishMessage(stepMessage, publishOptions);
              }
            }
          }
          // Discard the just-published deltas so that if the run is
          // cancelled mid-stream publishStreamedTrace only contains
          // text from the current (un-published) step — not a
          // concatenation of every turn the agent produced.
          streamedTrace.text = '';
          streamedTrace.reasoning = '';
          this.host.emitRunTokens(
            running.organizationId,
            running.id,
            running.threadId,
            running.agentId,
            currentSteps,
          );
        },
      });

      const usage = normalizeTokenUsage(result.usage);
      const latestRun = this.host.repo.getRun(run.organizationId, run.id);
      if (latestRun && latestRun.status !== 'running') {
        if (latestRun.status === 'cancelled') {
          publishStreamedTrace({
            repo: this.host.repo,
            conversations: this.host.conversations,
            run: latestRun,
            trace: streamedTrace,
            outcome: 'stopped',
          });
        }
        return latestRun;
      }

      if (this.host.consumeDeferredApprovalResume(run.organizationId, run.id)) {
        const afterApprovedTools = await this.host.executePendingApprovedRunTools(running);
        return this.executeDirectTurn(afterApprovedTools);
      }

      const statuses = collectToolStatuses(result);
      const text = result.text.trim();
      const reasoningContent = extractReasoningChunk(result) ?? (streamedTrace.reasoning.trim() || undefined);
      const runSteps = this.host.repo.listRunSteps(run.organizationId, run.id);
      if (statuses.includes('waiting_for_input')) {
        const waitingStep = runSteps.find((step) => {
          const output = step.output as { status?: unknown; questionId?: unknown } | undefined;
          return output?.status === 'waiting_for_input' && typeof output.questionId === 'string';
        });
        const questionId =
          (waitingStep?.output as { questionId?: string } | undefined)?.questionId;
        const question = questionId
          ? this.host.repo.getInteractiveQuestion(run.organizationId, questionId)
          : null;
        return this.host.waitForInput(running, question?.questionText ?? 'Waiting for user input');
      }
      const goalToolCalls = collectRunStepToolCalls(result);
      const goalToolResults = collectRunStepToolResults(result);
      const artifactFileToolCall =
        (await appendArtifactFileToolCall(goalToolCalls, team.workspace.root, goalToolResults)) ??
        (await appendArtifactFileFromRunSteps(this.host.repo, run, team.workspace.root));
      const turnSnapshot = turn.snapshot();
      if (statuses.includes('waiting_for_approval')) {
        turn.backfillTokens({
          finalText: text,
          lastText: turn.lastContentValue,
          terminatingTool: null,
          usage,
        });
        return this.host.waitForApproval(running, pendingApprovalRunSummary(this.host.repo, running.organizationId, running.id));
      }

      const pendingApprovalExists = this.host.repo
        .listPendingApprovals(run.organizationId)
        .some((approval) => approval.runId === run.id);
      if (pendingApprovalExists) {
        turn.backfillTokens({
          finalText: text,
          lastText: turn.lastContentValue,
          terminatingTool: null,
          usage,
        });
        return this.host.waitForApproval(running, pendingApprovalRunSummary(this.host.repo, running.organizationId, running.id));
      }

      const detectedTerminatingTool =
        findTerminatingTool(result) ?? findTerminatingToolFromRunSteps(runSteps);
      const terminatingTool = this.host.resolveTerminatingTool(
        run.organizationId,
        run.id,
        detectedTerminatingTool,
      );
      turn.backfillTokens({
        finalText: text,
        lastText: turn.lastContentValue,
        terminatingTool,
        usage,
      });
      const usedPass = runUsedChannelPass(result) || terminatingTool === 'channel.pass';
      const finalThreadId = run.threadId;
      const channelId = finalThreadId
        ? this.host.repo.getThread(run.organizationId, finalThreadId)?.channelId
        : undefined;
      const wakeReason = (running.wakeReason ?? null) as WakeReason | null;
      const now = new Date().toISOString();
      if (usedPass && text.length > 0) {
        this.host.realtime.emit(
          SocketEventNames.agentPassedWithText,
          {
            organizationId: run.organizationId,
            channelId,
            threadId: run.threadId,
            memberId: run.agentId,
            runId: run.id,
            droppedText: text,
            occurredAt: now,
          },
          this.host.getRooms(running),
        );
      }

      if (terminatingTool === 'channel.pass') {
        const latestBeforeSilent = this.host.repo.getRun(run.organizationId, run.id);
        if (latestBeforeSilent?.status === 'cancelled') return latestBeforeSilent;
        this.host.persistSilentTrace(running, reasoningContent);
        return this.host.completeSilentRun(running, 'passed', 'channel.pass', wakeReason);
      }

      if (terminatingTool === 'channel.ack') {
        const latestBeforeSilent = this.host.repo.getRun(run.organizationId, run.id);
        if (latestBeforeSilent?.status === 'cancelled') return latestBeforeSilent;
        this.host.persistSilentTrace(running, reasoningContent);
        return this.host.completeSilentRun(running, 'acked', 'channel.ack', wakeReason);
      }

      if (!terminatingTool && text.length === 0 && !artifactFileToolCall) {
        if (wakeReason === 'mention') {
          const byMemberId = running.byMemberId ?? run.agentId;
          const messageId = running.sourceMessageId;
          if (messageId) {
            this.host.realtime.emit(
              SocketEventNames.memberMustReplyFailed,
              {
                organizationId: run.organizationId,
                runId: run.id,
                memberId: run.agentId,
                byMemberId,
                channelId,
                threadId: run.threadId,
                messageId,
                occurredAt: now,
              },
              this.host.getRooms(running),
            );
          }
          const latestBeforeFail = this.host.repo.getRun(run.organizationId, run.id);
          if (latestBeforeFail?.status === 'cancelled') return latestBeforeFail;
          return this.host.failRun(running, 'must_reply_failed: agent was @mentioned but did not reply');
        }
        this.host.realtime.emit(
          SocketEventNames.runEmptyCompletion,
          {
            organizationId: run.organizationId,
            runId: run.id,
            memberId: run.agentId,
            wakeReason: wakeReason ?? undefined,
            occurredAt: now,
          },
          this.host.getRooms(running),
        );
        const latestBeforeEmpty = this.host.repo.getRun(run.organizationId, run.id);
        if (latestBeforeEmpty?.status === 'cancelled') return latestBeforeEmpty;
        return this.host.completeRun(running, 'empty', null);
      }

      if (terminatingTool && VISIBLE_TERMINATING_TOOLS.has(terminatingTool) && !artifactFileToolCall) {
        const latestBeforeComplete = this.host.repo.getRun(run.organizationId, run.id);
        if (latestBeforeComplete?.status === 'cancelled') return latestBeforeComplete;
        return this.host.completeRun(running, terminatingTool, terminatingTool);
      }

      const reply = text || 'Artifact updated.';
      const latestBeforePublish = this.host.repo.getRun(run.organizationId, run.id);
      if (latestBeforePublish?.status === 'cancelled') return latestBeforePublish;
      await publishRunReplyTrace({
        repo: this.host.repo,
        conversations: this.host.conversations,
        run: running,
        result: {
          ...result,
          steps: result.steps.slice(persistedStepCount),
        },
        reply,
        reasoningContent,
        teamRoot: team.workspace.root,
        artifactFileToolCall,
        ...turnSnapshot,
        suppressDmAlerts: isDelegateRun(running, this.host.repo),
      });

      return this.host.completeRun(running, terminatingTool ?? reply, terminatingTool);
    } catch (error) {
      if (findToolApprovalRequiredError(error)) {
        if (this.host.consumeDeferredApprovalResume(run.organizationId, run.id)) {
          const afterApprovedTools = await this.host.executePendingApprovedRunTools(running);
          return this.executeDirectTurn(afterApprovedTools);
        }
        return this.host.waitForApproval(running, pendingApprovalRunSummary(this.host.repo, running.organizationId, running.id));
      }
      const inputError = findToolInputRequiredError(error);
      if (inputError) {
        const question = this.host.repo.getInteractiveQuestion(run.organizationId, inputError.questionId);
        return this.host.waitForInput(running, question?.questionText ?? 'Waiting for user input');
      }
      const latestAfterError = this.host.repo.getRun(run.organizationId, run.id);
      if (latestAfterError?.status === 'cancelled') {
        publishStreamedTrace({
          repo: this.host.repo,
          conversations: this.host.conversations,
          run: latestAfterError,
          trace: streamedTrace,
          outcome: 'stopped',
        });
        return latestAfterError;
      }
      publishStreamedTrace({
        repo: this.host.repo,
        conversations: this.host.conversations,
        run: running,
        trace: streamedTrace,
        outcome: 'failed',
      });
      console.error('[agent-turn] direct run failed', {
        organizationId: run.organizationId,
        runId: run.id,
        agentId: run.agentId,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
      return this.host.failRun(running, (error as Error).message);
    } finally {
      this.host.unregisterAbortController(abortKey);
    }
  }

  private waitingOutcome(
    spirit: Spirit,
    runState: SpiritRunState,
    terminatingTool: string | null = null,
  ): RunSpiritOutcome {
    return {
      spirit,
      finalText: runState.lastText,
      iterations: runState.iteration,
      toolCalls: runState.toolCallCount,
      tokensUsed: runState.totalTokens,
      terminatingTool,
    };
  }

  private completeCancelled(
    run: RunState,
    running: Spirit,
    runState: SpiritRunState,
  ): RunSpiritOutcome {
    runState.cancel(run.summary || 'Stopped by user');
    const cancelled = this.host.saveTerminalSpirit(runState, running);
    this.host.saveRunAndEmit(SocketEventNames.runCompleted, run);
    this.host.emitSpirit(SocketEventNames.spiritCompleted, cancelled);
    this.host.maybeFinalizeTaskSession(
      cancelled.organizationId,
      cancelled.taskSessionId,
      run.summary,
    );
    return this.waitingOutcome(cancelled, runState);
  }

}
