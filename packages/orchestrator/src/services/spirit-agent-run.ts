import { stepCountIs, tool, type ModelMessage, type ToolSet } from 'ai';
import { isMcpDispatchEnabled } from './feature-flags.js';
import { buildMcpToolDefinitionsV2 } from './connector-spawn-v2.js';
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
  AGENT_KIND,
  SocketEventNames,
  SpiritSchema,
  buildEnvironmentTimestamp,
  channelRoom,
  orgRoom,
  type Message,
  type Spirit,
  type SpiritRole,
  type WakeReason,
} from '@ujima/shared';
import { buildAgentSystemPrompt, type AgentTeamHandle } from '@ujima/framework';
import {
  filterToolsForWakeReplyPolicy,
  isAgentOnlyDmThread,
  resolveWakeReplyPolicy,
} from '../utils/wake-reply-policy.js';
import { requireTeam } from '../utils/require-team.js';
import { resolveVisiblePromptChannels } from '../utils/visible-prompt-channels.js';
import { runAgentWithRetry, type AgentLoopStep } from './agent-loop.js';
import { isDelegateMessage } from './run-reply-guard.js';
import { buildToolDefinitions } from '../utils/to-model-messages.js';
import {
  ALWAYS_AVAILABLE_AGENT_TOOLS,
  SUPERVISOR_TOOL_ALLOWLIST,
  filterDeprecatedToolIds,
} from '../tools/index.js';
import type { ApiRepository } from './repository-reader.js';
import { findToolApprovalRequiredError, findToolInputRequiredError } from './tool-loop-result.js';
import { errorMessage } from '../utils/error-message.js';
import {
  buildDelegateTurnContextMessages,
  filterDelegateTurnToolSet,
  getDelegateKind,
} from '../utils/delegate-turn.js';
import {
  createMessageCursor,
  loadChannelInterruptModelMessages,
} from '../utils/interrupt-loader.js';
import { wrapToolCallsAsCards } from '../utils/step-tool-calls.js';
import { buildAgentMessage } from './message-factory.js';
import { selectPromptContextMessages } from '../utils/prompt-context.js';
import { buildPromptMessages } from '../utils/prompt-assembly.js';
import { buildThreadStateBlock } from '../utils/thread-state.js';
import { buildWorkspaceStateBlock } from '../utils/workspace-state.js';
import { collectCursorPages } from '../utils/cursor-pages.js';
import { RunTurnPublisher } from './run-turn-publisher.js';
import { normalizeTokenUsage } from './token-usage.js';
import { pendingApprovalRunSummary } from './approval-summary.js';
import { findTerminatingTool, findTerminatingToolFromRunSteps } from './run-reply-guard.js';
import { prepareAgentStepPublication } from './agent-step-publish.js';
import type {
  RunSpiritInput,
  RunSpiritOutcome,
} from './spirit-types.js';
import { SpiritServiceBase } from './spirit-service-base.js';
import { AgentLoopLogger } from '../debug/agent-loop-logger.js';

export class SpiritServiceAgentRun extends SpiritServiceBase {
  async run(input: RunSpiritInput): Promise<RunSpiritOutcome> {
    const role = input.role ?? 'worker';
    const session = this.repo.getTaskSession(input.organizationId, input.taskSessionId);
    if (!session) {
      throw new Error(`Task session not found: ${input.taskSessionId}`);
    }
    const member = this.repo.getMember(input.organizationId, input.memberId);
    if (!member) {
      throw new Error(`Member not found: ${input.memberId}`);
    }
    const team = requireTeam(this.teamStore, input.organizationId);
    const organization = this.repo.getOrganization(input.organizationId);
    if (!organization) {
      throw new Error(`Organization not found: ${input.organizationId}`);
    }
    const agent = team.getAgent(member.id) ?? team.getAgent(member.name);
    if (!agent) {
      throw new Error(`Agent not found: ${member.id}`);
    }
    const teamRole = team.getRole(agent.roleName);
    if (!teamRole) {
      throw new Error(`Role not found: ${agent.roleName}`);
    }

    const model = await Promise.resolve(
      this.modelResolver({
        organizationId: input.organizationId,
        memberId: input.memberId,
        role,
      }),
    );

    const threadMessages = collectCursorPages((cursor) =>
      this.repo.listChannelMessages(input.organizationId, session.channelId, { cursor, limit: 600 }),
    );
    const recent = selectPromptContextMessages(threadMessages);
    const interruptCursor = createMessageCursor(recent);

    const spirit = this.spawn({
      organizationId: input.organizationId,
      taskSessionId: input.taskSessionId,
      memberId: input.memberId,
      role,
    });

    const running: Spirit = SpiritSchema.parse({
      ...spirit,
      status: 'running',
      updatedAt: new Date().toISOString(),
    });
    this.repo.saveSpirit(running);
    this.registry.register(running);
    if (spirit.runId) {
      const run = this.repo.getRun(input.organizationId, spirit.runId);
      if (run) {
        this.saveRunAndEmit(SocketEventNames.runUpdated, {
          ...run,
          status: 'running',
          step: 'running',
          summary: 'Spirit turn',
        });
      }
    }
    this.emit(SocketEventNames.spiritUpdated, running);

    const resolvedAllowlist = this.resolveToolAllowlist(teamRole.tools, role, input.toolAllowlist);
    const supervisorRunRow =
      spirit.runId !== undefined
        ? this.repo.getRun(input.organizationId, spirit.runId)
        : undefined;
    const sourceMessage = supervisorRunRow?.sourceMessageId
      ? this.repo.getMessage(input.organizationId, supervisorRunRow.sourceMessageId)
      : null;
    const isDelegateTurn = isDelegateMessage(sourceMessage);
    const supervisorWakePolicy = resolveWakeReplyPolicy({
      threadId: session.channelId,
      wakeReason: supervisorRunRow?.wakeReason as WakeReason | undefined,
      dmPeerIsAgent: isAgentOnlyDmThread(
        session.channelId,
        (memberId) => this.repo.getMember(input.organizationId, memberId)?.kind === AGENT_KIND,
      ),
    });
    const baseAllowedToolIds = filterToolsForWakeReplyPolicy(
      resolvedAllowlist,
      supervisorWakePolicy,
    );
    const builtInToolDefs = this.buildToolDefinitions(baseAllowedToolIds, {
      organizationId: input.organizationId,
      runId: spirit.runId ?? spirit.id,
      memberId: input.memberId,
      threadId: session.channelId,
      taskSessionId: input.taskSessionId,
      spiritRole: role,
      team,
      repo: this.repo,
    });
    const mcpCtx = {
      organizationId: input.organizationId,
      memberId: input.memberId,
      runId: spirit.runId ?? spirit.id,
      threadId: session.channelId,
      taskSessionId: input.taskSessionId,
      role,
    };
    // §3.5 rule 3: the flag is the only routing switch between the
    // legacy spawn path and the V2 spawn path. Tier is read inside
    // V2 only — the caller stays tier-blind. Flag off → legacy method
    // runs byte-for-byte unchanged.
    //
    // The wake-run path uses buildMcpToolDefinitionsRouted (via the
    // AiService resolver); the run-loop entry inlines the V2 call
    // here so it can surface `catalogText` to the system prompt
    // (the resolver interface only forwards toolSet + servers).
    let mcpToolDefs: ToolSet;
    let attachedMcpServers: McpServerSummary[];
    let availableConnectors: string | undefined;
    if (isMcpDispatchEnabled(mcpCtx.organizationId) && this.mcpPool) {
      const v2 = await buildMcpToolDefinitionsV2(
        {
          mcpPool: this.mcpPool,
          repo: this.repo,
          tools: this.tools,
          approvals: this.attachmentApprovalRequester
            ? { requestAttachmentApproval: this.attachmentApprovalRequester }
            : undefined,
          attachmentCapture: this.attachmentCapture,
        },
        mcpCtx,
      );
      mcpToolDefs = v2.toolSet;
      attachedMcpServers = v2.servers;
      availableConnectors = v2.catalogText.length > 0 ? v2.catalogText : undefined;
    } else {
      const legacy = await this.buildMcpToolDefinitions(mcpCtx);
      mcpToolDefs = legacy.toolSet;
      attachedMcpServers = legacy.servers;
    }
    const toolDefs: ToolSet = isDelegateTurn
      ? filterDelegateTurnToolSet({ ...builtInToolDefs, ...mcpToolDefs }, getDelegateKind(sourceMessage))
      : { ...builtInToolDefs, ...mcpToolDefs };

    const availableToolIds = Object.keys(toolDefs);
    const availableSkills = this.repo.listOrganizationSkillInstalls?.(input.organizationId) ?? [];
    const visibleChannels = resolveVisiblePromptChannels(
      team.channels,
      this.repo,
      input.organizationId,
    );
    const system = buildAgentSystemPrompt(
      team.workspace.root,
      organization.name,
      member.id,
      member.name,
      session.channelId,
      agent,
      teamRole,
      this.repo
        .listMembers(input.organizationId)
        .filter((current) => current.id !== member.id),
      team.agents,
      visibleChannels,
      organization.organizationChart,
      availableSkills,
      availableToolIds,
      attachedMcpServers.map((s) => ({ name: s.serverName, toolNames: s.toolNames })),
      supervisorWakePolicy.conversationKind,
      availableConnectors,
      model,
    );
    const systemPromptSuffix = this.resolveSystemPromptSuffix({
      organizationId: input.organizationId,
      taskSessionId: input.taskSessionId,
      threadId: session.channelId,
      extraSuffix: input.systemPromptSuffix,
      messageContent: input.promptMessageContent,
      goalMode: input.promptGoalMode,
      scheduleMode: input.promptScheduleMode,
    });
    const contextMessages: ModelMessage[] = [
      // Per-wake timestamp — outside the system prompt so the Anthropic
      // prefix cache stays valid across wakes (the timestamp changes
      // every turn and would bust the cache if it were in the system prompt).
      { role: 'user' as const, content: `<wake-context>\n${buildEnvironmentTimestamp()}\n</wake-context>` },
      ...(systemPromptSuffix ? [{ role: 'user' as const, content: systemPromptSuffix }] : []),
      ...(sourceMessage && input.extraPrompt
        ? [{ role: 'user' as const, content: input.extraPrompt }]
        : []),
    ];
    const currentChannel = session.channelId
      ? this.repo.getChannel(input.organizationId, session.channelId)
      : undefined;
    const threadStateBlock = buildThreadStateBlock({
      messages: threadMessages,
      currentMember: { id: member.id, name: member.name },
      sourceMessageId: sourceMessage?.id ?? undefined,
      threadId: session.channelId,
      members: this.repo.listMembers(input.organizationId),
      wakeReason: supervisorRunRow?.wakeReason ?? null,
      channelName: currentChannel?.name,
    });
    if (threadStateBlock) {
      contextMessages.push({ role: 'user', content: threadStateBlock });
    }
    const workspaceStateBlock = await buildWorkspaceStateBlock({
      organizationId: input.organizationId,
      memberId: member.id,
      channelId: session.channelId,
      threadId: session.channelId,
      repo: this.repo,
    });
    if (workspaceStateBlock) {
      contextMessages.push({ role: 'user', content: workspaceStateBlock });
    }
    if (isDelegateTurn) {
      contextMessages.push(...buildDelegateTurnContextMessages(getDelegateKind(sourceMessage)));
    }
    const systemPrompt = system;
    const historyMessages = sourceMessage ? recent.filter((message) => message.id !== sourceMessage.id) : recent;
    const messages = buildPromptMessages({
      historyMessages,
      currentMemberId: member.id,
      runSteps: this.repo.listRunSteps(input.organizationId, spirit.runId ?? spirit.id),
      contextMessages,
      currentRequestMessage: sourceMessage,
      currentRequest:
        sourceMessage
          ? undefined
          : {
              role: 'user',
              content: input.extraPrompt ?? session.prompt ?? 'Continue the task.',
            },
    });

    const maxIterations = input.maxIterations ?? this.maxIterationsPerRun;
    let totalTurns = 0;
    let totalToolCalls = 0;
    let totalTokens = 0;
    let lastText = '';
    let streamedReasoning = '';
    let lastMessageId: string | undefined;
    let persistedStepCount = 0;
    const turn = new RunTurnPublisher(
      (message) => this.publishAgentMessage(message),
      (message) => {
        this.repo.updateMessage(message);
      },
    );

    const runId = spirit.runId ?? spirit.id;
    const abortKey = this.runKey(input.organizationId, runId);
    const abortController = new AbortController();
    this.runAbortControllers.set(abortKey, abortController);

    const debugLogger = new AgentLoopLogger();
    debugLogger.setWorkspaceRoot(team.workspace.root);
    debugLogger.setContext({
      agentId: input.memberId,
      threadId: session.channelId,
      channelId: session.channelId,
      organizationId: input.organizationId,
      model,
      systemPrompt,
      messages,
      tools: toolDefs,
    });

    try {
      const result = await runAgentWithRetry({
        model,
        system: systemPrompt,
        messages,
        tools: toolDefs,
        attachedMcpServers,
        stopWhen: stepCountIs(maxIterations),
        maxOutputTokens: this.maxOutputTokens,
        temperature: this.temperature,
        toolChoice: 'auto',
        abortSignal: abortController.signal,
        detectExternalPause: () => this.detectRunPauseForHuman(input.organizationId, runId),
        onChunk: (chunk) => {
          if (chunk.kind === 'reasoning') streamedReasoning += chunk.delta;
          debugLogger.handleChunk(chunk);
          this.emitRunChunk(
            {
              organizationId: input.organizationId,
              runId,
              threadId: session.channelId,
              agentId: input.memberId,
            },
            chunk,
          );
        },
        onStepFinish: async (_step, currentSteps) => {
          debugLogger.handleStepFinish(_step);
          const unpersisted = currentSteps.slice(persistedStepCount);
          for (const s of unpersisted) {
            persistedStepCount++;
            totalTurns += 1;
            const out = await this.publishStepBubble({
              step: s,
              spirit,
              turn,
              organizationId: input.organizationId,
              channelId: session.channelId,
              senderId: member.id,
              teamRoot: team.workspace.root,
              runId,
            });
            totalToolCalls += out.toolCallCount;
            if (out.messageId) lastMessageId = out.messageId;
            if (out.stepText) lastText = out.stepText;
          }
          this.emitRunTokens(input.organizationId, runId, session.channelId, member.id, currentSteps);
        },
        loadInterruptMessages: () =>
        loadChannelInterruptModelMessages({
          repo: this.repo,
          organizationId: input.organizationId,
          channelId: session.channelId,
          agentId: member.id,
          cursor: interruptCursor,
          runId: spirit.runId ?? spirit.id,
        }),
        logLabel: 'spirit-agent-run',
        memberLabel: input.memberId,
      });
      const { steps, usage } = result;

      debugLogger.setTokenUsage({
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        totalTokens: usage?.totalTokens,
      });
      debugLogger.flush().catch(() => undefined);

      // Compute token counts early so they're available when persisting
      // the last step's message below.
      const tokenUsage = normalizeTokenUsage(usage);
      const finalText = result.text.trim();
      const detectedTerminatingTool = findTerminatingTool(result);

      // Each step in `steps` is one model turn. We persist one
      // `kind='agent'` message per step that produced text or tool
      // calls, with tool-call cards inlined. This keeps the channel
      // history readable as a turn-by-turn timeline.
      for (let index = persistedStepCount; index < steps.length; index++) {
        const step = steps[index];
        if (!step) continue;
        totalTurns += 1;
        const out = await this.publishStepBubble({
          step,
          spirit,
          turn,
          organizationId: input.organizationId,
          channelId: session.channelId,
          senderId: member.id,
          teamRoot: team.workspace.root,
          runId: spirit.runId ?? spirit.id,
          reasoningFallback:
            index === steps.length - 1 ? streamedReasoning.trim() || undefined : undefined,
        });
        totalToolCalls += out.toolCallCount;
        if (out.messageId) lastMessageId = out.messageId;
        if (out.stepText) lastText = out.stepText;
      }

      const persistedRunSteps = spirit.runId ? this.repo.listRunSteps?.(input.organizationId, spirit.runId) ?? [] : [];
      const terminatingTool = detectedTerminatingTool ?? findTerminatingToolFromRunSteps(persistedRunSteps);
      turn.backfillTokens({ finalText, lastText, terminatingTool, usage: tokenUsage });

      // Prefer provider `totalTokens`; fall back to input+output sum
      // (handles providers that omit it or return non-numeric fields).
      totalTokens = tokenUsage.totalTokens;
      const completed: Spirit = SpiritSchema.parse({
        ...running,
        iteration: running.iteration + totalTurns,
        tokensUsed: running.tokensUsed + totalTokens,
        lastMessageId: lastMessageId ?? running.lastMessageId,
        status: 'completed',
        updatedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
      this.repo.saveSpirit(completed);
      this.registry.unregister(completed.organizationId, completed.memberId, completed.id);
      // Persisted run-steps act as a safety net when provider/SDK
      // Resolve the final terminator, preserving any silent terminator
      // a mid-run side-effect already wrote onto the run row.
      const finalTerminatingTool = this.resolveTerminatingTool(
        input.organizationId,
        spirit.runId,
        detectedTerminatingTool,
      );
      if (spirit.runId) {
        const persistedRun = this.repo.getRun(input.organizationId, spirit.runId);
        if (persistedRun) {
          const completedRun = this.saveRunAndEmit(SocketEventNames.runCompleted, {
            ...persistedRun,
            status: 'completed',
            step: 'completed',
            summary: lastText || persistedRun.summary,
            endedAt: new Date().toISOString(),
            terminatingTool: finalTerminatingTool,
          });
          this.invokeRunTerminalHook(completedRun);
        }
      }
      this.emit(SocketEventNames.spiritCompleted, completed);
      this.maybeFinalizeTaskSession(
        completed.organizationId,
        completed.taskSessionId,
        lastText || undefined,
      );

      return {
        spirit: completed,
        finalText: lastText,
        iterations: totalTurns,
        toolCalls: totalToolCalls,
        tokensUsed: totalTokens,
        terminatingTool: finalTerminatingTool,
      };
    } catch (err) {
      debugLogger.flush().catch(() => undefined);
      const latestRun = this.repo.getRun(input.organizationId, runId);
      if (latestRun?.status === 'cancelled') {
        const cancelled: Spirit = SpiritSchema.parse({
          ...running,
          status: 'cancelled',
          lastError: latestRun.summary || 'Stopped by user',
          updatedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
        });
        this.repo.saveSpirit(cancelled);
        this.registry.unregister(cancelled.organizationId, cancelled.memberId, cancelled.id);
        this.realtime.emit(
          SocketEventNames.runCompleted,
          { organizationId: input.organizationId, run: latestRun },
          this.getRooms(latestRun),
        );
        this.emit(SocketEventNames.spiritCompleted, cancelled);
        this.maybeFinalizeTaskSession(cancelled.organizationId, cancelled.taskSessionId, latestRun.summary);
        return {
          spirit: cancelled,
          finalText: lastText,
          iterations: totalTurns,
          toolCalls: totalToolCalls,
          tokensUsed: totalTokens,
          terminatingTool: null,
        };
      }
      const inputRequiredError = findToolInputRequiredError(err);
      if (inputRequiredError) {
        const waiting: Spirit = SpiritSchema.parse({
          ...running,
          status: 'waiting_for_input',
          updatedAt: new Date().toISOString(),
        });
        this.repo.saveSpirit(waiting);

        if (spirit.runId) {
          const run = this.repo.getRun(input.organizationId, spirit.runId);
          if (run) {
            const question = this.repo.getInteractiveQuestion(input.organizationId, inputRequiredError.questionId);
            this.saveRunAndEmit(SocketEventNames.runUpdated, {
              ...run,
              status: 'waiting_for_input',
              step: 'waiting_for_input',
              summary: question?.questionText ?? run.summary ?? 'Waiting for user input',
            });
          }
        }
        this.emit(SocketEventNames.spiritUpdated, waiting);
        return {
          spirit: waiting,
          finalText: lastText,
          iterations: totalTurns,
          toolCalls: totalToolCalls,
          tokensUsed: totalTokens,
          terminatingTool: null,
        };
      }

      if (findToolApprovalRequiredError(err)) {
        const waiting: Spirit = SpiritSchema.parse({
          ...running,
          status: 'waiting_for_approval',
          updatedAt: new Date().toISOString(),
        });
        this.repo.saveSpirit(waiting);
        // Approval-paused turns: a tool fired but its result is
        // deferred, so we can only consult persisted run-steps here.
        const pausedRunSteps = spirit.runId
          ? this.repo.listRunSteps?.(input.organizationId, spirit.runId) ?? []
          : [];
        const pausedTerminatingTool = findTerminatingToolFromRunSteps(pausedRunSteps);
        if (spirit.runId) {
          const run = this.repo.getRun(input.organizationId, spirit.runId);
          if (run) {
            this.saveRunAndEmit(SocketEventNames.runUpdated, {
              ...run,
              status: 'waiting_for_approval',
              step: 'waiting_for_approval',
              summary: pendingApprovalRunSummary(this.repo, input.organizationId, spirit.runId),
              terminatingTool: pausedTerminatingTool,
            });
          }
        }
        this.emit(SocketEventNames.spiritUpdated, waiting);
        return {
          spirit: waiting,
          finalText: lastText,
          iterations: totalTurns,
          toolCalls: totalToolCalls,
          tokensUsed: totalTokens,
          terminatingTool: pausedTerminatingTool,
        };
      }
      const message = errorMessage(err);
      const failed: Spirit = SpiritSchema.parse({
        ...running,
        status: 'failed',
        lastError: message,
        updatedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
      this.repo.saveSpirit(failed);
      this.registry.unregister(failed.organizationId, failed.memberId, failed.id);
      // Mirror terminatingTool on the failure path too — a turn can
      // fail after a tool fired (e.g. policy block on a later step),
      // and postmortem analysis benefits from seeing that the agent
      // *did* terminate via a specific tool before the run died.
      const failedRunSteps = spirit.runId
        ? this.repo.listRunSteps?.(input.organizationId, spirit.runId) ?? []
        : [];
      const failedTerminatingTool = findTerminatingToolFromRunSteps(failedRunSteps);
      if (spirit.runId) {
        const run = this.repo.getRun(input.organizationId, spirit.runId);
        if (run) {
          this.saveRunAndEmit(SocketEventNames.runCompleted, {
            ...run,
            status: 'failed',
            step: 'failed',
            summary: message,
            endedAt: new Date().toISOString(),
            terminatingTool: failedTerminatingTool,
          });
        }
      }
      this.emit(SocketEventNames.spiritCompleted, failed);
      this.maybeFinalizeTaskSession(failed.organizationId, failed.taskSessionId, message);
      debugLogger.setError(message);
      debugLogger.flush().catch(() => undefined);
      throw err;
    } finally {
      this.runAbortControllers.delete(abortKey);
    }
  }

  protected resolveToolAllowlist(
    roleTools: readonly string[],
    role: SpiritRole,
    override: readonly string[] | undefined,
  ): readonly string[] {
    if (override) return override;
    if (role === 'supervisor') {
      return SUPERVISOR_TOOL_ALLOWLIST;
    }
    return filterDeprecatedToolIds([
      ...new Set([...roleTools, ...ALWAYS_AVAILABLE_AGENT_TOOLS]),
    ]);
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
    return buildToolDefinitions(toolIds, ctx.team, this.tools, ctx);
  }

  private async publishStepBubble(input: {
    step: AgentLoopStep;
    spirit: Spirit;
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
      runId: input.spirit.runId,
    });
    const messageToolCalls = [
      ...wrapped,
      ...prepared.cards,
      ...(prepared.artifact ? [prepared.artifact] : []),
    ];
    let message: Message | undefined;
    const parts = prepared.contentParts.length > 0 ? prepared.contentParts : [prepared.content];
    for (const [index, content] of parts.entries()) {
      const isLast = index === parts.length - 1;
      message = input.turn.publishMessage(buildAgentMessage({
        organizationId: input.organizationId,
        threadId: input.channelId,
        channelId: input.channelId,
        senderId: input.senderId,
        content,
        ...(isLast && messageToolCalls.length > 0 ? { toolCalls: messageToolCalls } : {}),
        metadata: { runId: input.runId },
        ...(isLast && prepared.reasoningContent ? { reasoningContent: prepared.reasoningContent } : {}),
      }));
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

  /**
   * Flag-routed MCP tool palette resolver. Wraps both legacy
   * `buildMcpToolDefinitions` and V2 `buildMcpToolDefinitionsV2` so the
   * AiService wake-run resolver (`setMcpToolResolver` in services/
   * index.ts) routes through the same gate as the run-loop entry at
   * line 223 above.
   *
   * Without this wrapper the wake-run path (DM → AiService →
   * generateRunReply → mcpToolResolver) hit legacy
   * `buildMcpToolDefinitions` unconditionally — so a DM to an agent
   * with dispatch-tier attachments saw zero `connector_*` audit rows,
   * never registered the meta-tools in the palette, and silently
   * routed the dispatch tier through the legacy path. §3.5 rule 3
   * requires the flag check to gate every spawn surface, not just
   * the spirit-run entry.
   *
   * Returns only `{ toolSet, servers }` to match McpToolResolver's
   * signature. The V2 catalogText still threads through the run-loop
   * entry (line 230) into the system prompt; the wake-run path
   * doesn't currently surface it, so an agent on a fresh wake-run can
   * still call `get_connector_tools(serverId)` to discover dispatch
   * tools even without the catalog block in its prompt.
   */
  async buildMcpToolDefinitionsRouted(ctx: {
    organizationId: string;
    memberId: string;
    runId: string;
    threadId: string;
    taskSessionId: string;
    role: SpiritRole;
  }): Promise<{ toolSet: ToolSet; servers: McpServerSummary[]; catalogText?: string }> {
    if (isMcpDispatchEnabled(ctx.organizationId) && this.mcpPool) {
      const v2 = await buildMcpToolDefinitionsV2(
        {
          mcpPool: this.mcpPool,
          repo: this.repo,
          tools: this.tools,
          // PR 11 (bot fix) — wake-run path was missing the approvals
          // wiring. @mention spawns go through this code path, not the
          // run-loop entry above, so request_attachment was returning
          // "approval surface isn't wired" whenever an agent was woken
          // by an @mention. Same closure as the run-loop path.
          approvals: this.attachmentApprovalRequester
            ? { requestAttachmentApproval: this.attachmentApprovalRequester }
            : undefined,
          attachmentCapture: this.attachmentCapture,
        },
        ctx,
      );
      return {
        toolSet: v2.toolSet,
        servers: v2.servers,
        catalogText: v2.catalogText.length > 0 ? v2.catalogText : undefined,
      };
    }
    return this.buildMcpToolDefinitions(ctx);
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
            try {
              const result = await this.tools.invoke({
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
              });
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
