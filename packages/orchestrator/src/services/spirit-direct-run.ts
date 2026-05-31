import { randomUUID } from 'node:crypto';
import {
  RunStateSchema,
  SocketEventNames,
  memberRoom,
  orgRoom,
  runRoom,
  threadRoom,
  type RunState,
  type Spirit,
  type WakeReason,
  AGENT_KIND,
  MessageSchema,
} from '@ujima/shared';
import { applyDashboardTeamOverrides } from './dashboard-team-overrides.js';
import { isLiveRunStatus } from './live-status.js';
import { requireTeam } from '../utils/require-team.js';
import { findToolApprovalRequiredError, findToolInputRequiredError } from './tool-loop-result.js';
import { extractReasoningChunk } from '../utils/extract-reasoning.js';
import { pendingApprovalRunSummary } from './approval-summary.js';
import {
  findTerminatingTool,
  findTerminatingToolFromRunSteps,
  runUsedChannelPass,
  runUsedThreadPublishingTool,
} from './run-reply-guard.js';
import type { CreateRunInput, RunDetail } from './spirit-types.js';
import { aggregateToolUsage } from './spirit-run-detail.js';
import type { RunSpiritOutcome } from './spirit-types.js';
import { SpiritServiceSupervisor } from './spirit-supervisor.js';
import { appendArtifactFileToolCall } from './artifact-file-card.js';
import {
  appendArtifactFileFromRunSteps,
  collectRunStepToolCalls,
  collectRunStepToolResults,
  collectToolStatuses,
  publishRunReplyTrace,
  publishStreamedTrace,
  type StreamedRunTrace,
} from './run-trace-publisher.js';

function isDelegateRun(run: RunState, repo: { getMessage(organizationId: string, messageId: string): { metadata?: unknown } | null }): boolean {
  if (!run.sourceMessageId) return false;
  const source = repo.getMessage(run.organizationId, run.sourceMessageId);
  return !!(source?.metadata as { delegate?: unknown } | undefined)?.delegate;
}

export class SpiritServiceDirectRun extends SpiritServiceSupervisor {
  async resumeAfterApproval(
    organizationId: string,
    runId: string,
    allowRun = true,
    approvalScope?: string,
  ): Promise<RunSpiritOutcome | Spirit | RunState | null> {
    const spirit = this.resolveSpiritForRun(organizationId, runId);
    if (spirit) {
      if (allowRun) {
        this.tools.allowRun(organizationId, runId, approvalScope);
      } else {
        const failed = this.updateStatus(organizationId, spirit.id, 'failed', {
          error: 'Approval rejected by user',
        });
        const run = this.repo.getRun(organizationId, runId);
        if (run) {
          this.repo.saveRun({
            ...run,
            status: 'failed',
            step: 'failed',
            summary: 'Approval rejected by user',
            endedAt: run.endedAt ?? new Date().toISOString(),
          });
        }
        return failed;
      }

      if (spirit.status === 'running') {
        return spirit;
      }

      if (spirit.status !== 'waiting_for_approval') {
        return spirit;
      }

      await this.replayApprovedToolsForSpirit(spirit);
      return this.run({
        organizationId,
        taskSessionId: spirit.taskSessionId,
        memberId: spirit.memberId,
        role: spirit.role,
      });
    }

    const run = this.repo.getRun(organizationId, runId);
    if (!run) return null;
    if (allowRun) {
      this.tools.allowRun(organizationId, runId, approvalScope);
    } else {
      return this.failRun(run, 'Approval rejected by user');
    }

    if (run.status === 'running') {
      const key = this.runKey(organizationId, runId);
      if (this.runAbortControllers.has(key)) {
        this.deferredApprovalResumes.add(key);
        return run;
      }
      const afterApprovedTools = await this.executePendingApprovedRunTools(run);
      return this.advanceRun(afterApprovedTools);
    }

    if (run.status !== 'waiting_for_approval') {
      return run;
    }

    const afterApprovedTools = await this.executePendingApprovedRunTools(run);
    return this.advanceRun({
      ...afterApprovedTools,
      status: 'running',
      step: 'running',
      summary: 'Run resumed after approval',
    });
  }

  async resumeAfterInput(
    organizationId: string,
    runId: string,
  ): Promise<RunSpiritOutcome | Spirit | RunState | null> {
    const spirit = this.resolveSpiritForRun(organizationId, runId);
    if (spirit) {
      if (spirit.status === 'running') {
        return spirit;
      }

      if (spirit.status !== 'waiting_for_input') {
        return spirit;
      }

      const running: Spirit = {
        ...spirit,
        status: 'running',
        updatedAt: new Date().toISOString(),
      };
      this.repo.saveSpirit(running);
      this.emit(SocketEventNames.spiritUpdated, running);

      await this.replayApprovedToolsForSpirit(running);
      return this.run({
        organizationId,
        taskSessionId: running.taskSessionId,
        memberId: running.memberId,
        role: running.role,
      });
    }

    const run = this.repo.getRun(organizationId, runId);
    if (!run) return null;

    if (run.status === 'running') {
      const afterApprovedTools = await this.executePendingApprovedRunTools(run);
      return this.advanceRun(afterApprovedTools);
    }

    if (run.status !== 'waiting_for_input') {
      return run;
    }

    const afterApprovedTools = await this.executePendingApprovedRunTools(run);
    return this.advanceRun({
      ...afterApprovedTools,
      status: 'running',
      step: 'running',
      summary: 'Run resumed after user input',
    });
  }

  async createRun(input: CreateRunInput): Promise<RunState> {
    if (!this.ai) {
      throw new Error('Run execution is not wired into SpiritService');
    }

    const member = this.repo.getMember(input.organizationId, input.agentId);
    if (!member) {
      throw new Error(`Member not found: ${input.agentId}`);
    }
    if (member.kind !== AGENT_KIND) {
      throw new Error(`Member "${input.agentId}" is not an agent`);
    }
    if (member.retiredAt) {
      throw new Error(`Member "${input.agentId}" is retired`);
    }

    const run = RunStateSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      agentId: input.agentId,
      threadId: input.threadId,
      status: 'queued',
      step: 'queued',
      summary: input.summary ?? 'Run queued',
      startedAt: new Date().toISOString(),
      wakeReason: input.wakeReason ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      byMemberId: input.byMemberId ?? null,
      terminatingTool: null,
    });

    this.repo.saveRun(run);
    this.realtime.emit(
      SocketEventNames.runStarted,
      { organizationId: input.organizationId, run },
      [
        orgRoom(input.organizationId),
        threadRoom(input.threadId),
        memberRoom(input.agentId),
        runRoom(run.id),
      ],
    );

    try {
      return await this.advanceRun(run);
    } catch (error) {
      const latest = this.repo.getRun(run.organizationId, run.id);
      if (latest?.status === 'cancelled') {
        return latest;
      }
      if (findToolApprovalRequiredError(error)) {
        return this.waitForApproval(run, pendingApprovalRunSummary(this.repo, run.organizationId, run.id));
      }
      const inputError = findToolInputRequiredError(error);
      if (inputError) {
        const question = this.repo.getInteractiveQuestion(run.organizationId, inputError.questionId);
        return this.waitForInput(run, question?.questionText ?? 'Waiting for user input');
      }
      return this.failRun(run, (error as Error).message);
    }
  }

  listRuns(organizationId: string, cursor?: string, limit?: number) {
    return this.repo.listRuns(organizationId, cursor, limit);
  }

  listThreadTraces(organizationId: string, threadId: string, cursor?: string, limit?: number) {
    const page = this.repo.listThreadRuns(organizationId, threadId, cursor, limit);
    return {
      ...page,
      data: page.data.flatMap((run) => {
        const detail = this.getRunTraceDetail(organizationId, run.id);
        return detail ? [detail] : [];
      }),
    };
  }

  getRun(organizationId: string, runId: string) {
    return this.repo.getRun(organizationId, runId);
  }

  getRunTraceDetail(organizationId: string, runId: string) {
    const run = this.repo.getRun(organizationId, runId);
    if (!run) {
      return null;
    }

    const approvals = this.repo
      .listPendingApprovals(organizationId)
      .filter((approval) => approval.runId === runId);
    const messages = run.threadId ? this.listAllThreadMessages(organizationId, run.threadId) : [];
    const steps = this.repo.listRunSteps?.(organizationId, runId) ?? [];
    const message = [...messages]
      .reverse()
      .find(
        (item) =>
          item.metadata?.runId === run.id &&
          item.senderId === run.agentId &&
          item.senderKind === AGENT_KIND &&
          item.kind === AGENT_KIND,
      );

    return {
      run,
      approvals,
      messages,
      steps,
      ...(message ? { message } : {}),
    };
  }

  cancelRun(organizationId: string, runId: string): RunState {
    const run = this.repo.getRun(organizationId, runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    if (['completed', 'failed', 'cancelled'].includes(run.status)) {
      return run;
    }

    const key = this.runKey(organizationId, runId);
    this.deferredApprovalResumes.delete(key);

    const cancelled = this.repo.saveRun({
      ...run,
      status: 'cancelled',
      step: 'cancelled',
      summary: 'Stopped by user',
      endedAt: new Date().toISOString(),
    });

    this.realtime.emit(
      SocketEventNames.runCompleted,
      { organizationId: run.organizationId, run: cancelled },
      this.getRooms(run),
    );

    this.runAbortControllers.get(key)?.abort();
    this.runAbortControllers.delete(key);

    this.invokeRunTerminalHook(cancelled);

    return cancelled;
  }

  getRunDetail(organizationId: string, runId: string): RunDetail | null {
    const trace = this.getRunTraceDetail(organizationId, runId);
    if (!trace) return null;
    const { run, approvals, messages, steps, message } = trace;

    const spirit = this.repo.getSpiritByRunId(organizationId, runId);
    if (!spirit) {
      return {
        run,
        approvals,
        messages,
        steps,
        ...(message ? { message } : {}),
        activeAgents: isLiveRunStatus(run.status)
          ? [{ memberId: run.agentId, statusLabel: run.status }]
          : [],
        tokens: { perMemberId: { [run.agentId]: 0 } },
        tools: aggregateToolUsage(messages),
      } satisfies RunDetail;
    }

    const session = this.repo.getTaskSession(organizationId, spirit.taskSessionId);
    const sessionSpirits = this.repo.listSpiritsForSession(organizationId, spirit.taskSessionId);
    const runIds = new Set(sessionSpirits.map((current) => current.runId).filter(Boolean));
    const sessionApprovals = this.repo
      .listPendingApprovals(organizationId)
      .filter((approval) => approval.runId && runIds.has(approval.runId));
    const sessionMessages = session
      ? this.listAllChannelMessages(organizationId, session.channelId)
      : messages;

    const activeAgents = sessionSpirits
      .filter((current) => isLiveRunStatus(current.status))
      .map((current) => ({
        memberId: current.memberId,
        statusLabel: current.role === 'supervisor' ? `supervisor:${current.status}` : current.status,
      }));

    const perMemberId: Record<string, number> = {};
    for (const current of sessionSpirits) {
      perMemberId[current.memberId] = (perMemberId[current.memberId] ?? 0) + current.tokensUsed;
    }

    return {
      run,
      approvals: sessionApprovals,
      messages: sessionMessages,
      steps,
      ...(message ? { message } : {}),
      activeAgents,
      tokens: { perMemberId },
      tools: aggregateToolUsage(sessionMessages),
    } satisfies RunDetail;
  }

  protected async advanceRun(run: RunState): Promise<RunState> {
    const currentRun = this.repo.getRun(run.organizationId, run.id);
    if (currentRun && ['completed', 'failed', 'cancelled'].includes(currentRun.status)) {
      return currentRun;
    }

    applyDashboardTeamOverrides(this.repo, run.organizationId, this.teamStore);
    const team = requireTeam(this.teamStore, run.organizationId);
    const member = this.repo.getMember(run.organizationId, run.agentId);
    if (!member) {
      throw new Error(`Member not found: ${run.agentId}`);
    }
    if (member.retiredAt) {
      return this.failRun(run, `Agent retired: ${run.agentId}`);
    }

    const role = team.getRole(member.roleName);
    if (!role) {
      throw new Error(`Role not found: ${member.roleName}`);
    }

    const agent = team.getAgent(member.id) ?? team.getAgent(member.name);
    if (!agent) {
      return this.failRun(run, `Agent not found: ${member.id}`);
    }

    // No strict pre-flight on the *preferred* provider's key — that
    // short-circuits the runtime fallback in `resolveSpiritModel`,
    // which walks every team-configured provider with a key and
    // picks the first usable one. The fallback is the whole point of
    // letting an org swap providers without per-role migration; the
    // old gate here turned a recoverable "no key for the preferred
    // provider" state into a hard run failure even when other
    // providers were ready to serve. If *no* provider has a key,
    // `resolveSpiritModel` throws a clear "No usable provider for
    // member ..." error and the outer catch below converts that to
    // `failRun` with the same friendly summary.

    const preCancel = this.repo.getRun(run.organizationId, run.id);
    if (preCancel?.status === 'cancelled') {
      return preCancel;
    }

    const running = this.repo.saveRun({
      ...run,
      status: 'running',
      step: 'running',
      summary: 'Run executing',
    });

    const postCancel = this.repo.getRun(run.organizationId, run.id);
    if (postCancel?.status === 'cancelled') {
      return postCancel;
    }

    this.realtime.emit(
      SocketEventNames.runUpdated,
      { organizationId: run.organizationId, run: running },
      this.getRooms(running),
    );

    const abortKey = this.runKey(run.organizationId, run.id);
    const abortController = new AbortController();
    this.runAbortControllers.set(abortKey, abortController);
    const streamedTrace: StreamedRunTrace = { text: '', reasoning: '' };
    let persistedStepCount = 0;
    let publishedArtifactFile = false;
    let publishedAnyText = false;
    const publishedContent = new Set<string>();

    try {
      const systemPromptSuffix = this.resolveSystemPromptSuffix({
        organizationId: run.organizationId,
        threadId: run.threadId ?? '',
      });
      const ai = this.ai;
      if (!ai) {
        throw new Error('Run execution is not wired into SpiritService');
      }
      const result = await ai.generateRunReply({
        organizationId: run.organizationId,
        agentId: run.agentId,
        threadId: run.threadId ?? '',
        runId: run.id,
        summary: run.summary,
        systemPromptSuffix,
        abortSignal: abortController.signal,
        onChunk: (chunk) => {
          if (chunk.kind === 'text') streamedTrace.text += chunk.delta;
          if (chunk.kind === 'reasoning') streamedTrace.reasoning += chunk.delta;
          this.emitRunChunk(
            {
              organizationId: running.organizationId,
              runId: running.id,
              threadId: running.threadId,
              agentId: running.agentId,
            },
            chunk,
          );
        },
        onStepFinish: async (step, currentSteps) => {
          const unpersisted = currentSteps.slice(persistedStepCount);
          for (const s of unpersisted) {
            persistedStepCount++;
            const stepText = typeof s.text === 'string' ? s.text.trim() : '';
            const stepToolCalls = Array.isArray(s.toolCalls) ? s.toolCalls : [];
            const stepToolResults = Array.isArray(s.toolResults) ? s.toolResults : [];
            if (!stepText && stepToolCalls.length === 0) continue;

            const stepArtifactFileToolCall =
              stepToolCalls.length > 0
                ? (await appendArtifactFileToolCall(stepToolCalls, team.workspace.root, stepToolResults)) ??
                  (await appendArtifactFileFromRunSteps(
                    this.repo,
                    running,
                    team.workspace.root,
                    stepToolCalls.at(-1)?.toolCallId,
                  ))
                : undefined;
            if (stepArtifactFileToolCall) publishedArtifactFile = true;

            if (runUsedThreadPublishingTool({ steps: [s] }) && !stepArtifactFileToolCall) continue;
            if (!stepText && !stepArtifactFileToolCall) continue;

            if (stepText) {
              publishedAnyText = true;
            }

            const content = stepText || (stepArtifactFileToolCall ? 'Artifact updated.' : 'Tool actions recorded.');
            const toolCalls = [...stepToolCalls, ...(stepArtifactFileToolCall ? [stepArtifactFileToolCall] : [])];
            const stepReasoning = extractReasoningChunk(s);

            const finalThreadId = running.threadId;
            if (!finalThreadId) continue;
            const channelId = this.repo.getThread(running.organizationId, finalThreadId)
              ?.channelId;

            this.conversations?.publishMessage(
              MessageSchema.parse({
                id: randomUUID(),
                organizationId: running.organizationId,
                threadId: finalThreadId,
                channelId: channelId ?? undefined,
                senderId: running.agentId,
                senderKind: AGENT_KIND,
                kind: AGENT_KIND,
                content,
                metadata: { runId: running.id },
                ...(toolCalls.length > 0 ? { toolCalls } : {}),
                ...(stepReasoning ? { reasoningContent: stepReasoning } : {}),
                createdAt: new Date().toISOString(),
              }),
            );
            publishedContent.add(content);
          }
        },
      });

      const latestRun = this.repo.getRun(run.organizationId, run.id);
      if (latestRun && latestRun.status !== 'running') {
        if (latestRun.status === 'cancelled') {
          publishStreamedTrace({
            repo: this.repo,
            conversations: this.conversations,
            run: latestRun,
            trace: streamedTrace,
            outcome: 'stopped',
          });
        }
        return latestRun;
      }

      if (this.consumeDeferredApprovalResume(run.organizationId, run.id)) {
        const afterApprovedTools = await this.executePendingApprovedRunTools(running);
        return this.advanceRun(afterApprovedTools);
      }

      const statuses = collectToolStatuses(result);
      const text = result.text.trim();
      const reasoningContent = extractReasoningChunk(result) ?? (streamedTrace.reasoning.trim() || undefined);
      const runSteps = this.repo.listRunSteps?.(run.organizationId, run.id) ?? [];
      const goalToolCalls = collectRunStepToolCalls(result);
      const goalToolResults = collectRunStepToolResults(result);
      const artifactFileToolCall =
        (await appendArtifactFileToolCall(goalToolCalls, team.workspace.root, goalToolResults)) ??
        (await appendArtifactFileFromRunSteps(this.repo, run, team.workspace.root));
      if (statuses.includes('blocked')) {
        await publishRunReplyTrace({
          repo: this.repo,
          conversations: this.conversations,
          run: running,
          result: {
            ...result,
            steps: result.steps.slice(persistedStepCount),
          },
          reply: text || (artifactFileToolCall ? 'Artifact updated.' : ''),
          reasoningContent,
          teamRoot: team.workspace.root,
          artifactFileToolCall,
          publishedArtifactFile,
          publishedContent,
          publishedAnyText,

          suppressDmAlerts: true,
          failureTrace: true,
        });
        return this.failRun(running, 'Tool action blocked');
      }

      if (statuses.includes('waiting_for_approval')) {
        return this.waitForApproval(running, pendingApprovalRunSummary(this.repo, running.organizationId, running.id));
      }

      const pendingApprovalExists = this.repo
        .listPendingApprovals(run.organizationId)
        .some((approval) => approval.runId === run.id);
      if (pendingApprovalExists) {
        return this.waitForApproval(running, pendingApprovalRunSummary(this.repo, running.organizationId, running.id));
      }

      const detectedTerminatingTool =
        findTerminatingTool(result) ?? findTerminatingToolFromRunSteps(runSteps);
      // Preserve any silent terminator that a mid-run side-effect
      // already persisted onto the run row (mirror-loop guard fires
      // `tryMirrorSuppress` which writes `terminatingTool='channel.ack'`).
      // Without this preservation step, the freshly-computed
      // `detected` value (which sees the model's original
      // `channel.reply` toolcall via `result.steps`) would clobber
      // the silent terminator on the way through `completeRun`,
      // and metrics would report a publish that never happened.
      const persistedRunRow = this.repo.getRun(run.organizationId, run.id);
      const persistedTerminator = persistedRunRow?.terminatingTool;
      const persistedIsSilent =
        persistedTerminator === 'channel.ack' || persistedTerminator === 'channel.pass';
      const terminatingTool: string | null = persistedIsSilent
        ? persistedTerminator
        : detectedTerminatingTool;
      const usedPass = runUsedChannelPass(result) || terminatingTool === 'channel.pass';
      const finalThreadId = run.threadId;
      const channelId = finalThreadId
        ? this.repo.getThread(run.organizationId, finalThreadId)?.channelId
        : undefined;
      const wakeReason = (running.wakeReason ?? null) as WakeReason | null;
      const now = new Date().toISOString();
      if (usedPass && text.length > 0) {
        this.realtime.emit(
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
          this.getRooms(running),
        );
      }

      if (terminatingTool === 'channel.pass') {
        return this.completeSilentRun(running, 'passed', 'channel.pass', wakeReason);
      }

      if (terminatingTool === 'channel.ack') {
        return this.completeSilentRun(running, 'acked', 'channel.ack', wakeReason);
      }



      if (!terminatingTool && text.length === 0 && !artifactFileToolCall) {
        if (wakeReason === 'mention') {
          const byMemberId = running.byMemberId ?? run.agentId;
          const messageId = running.sourceMessageId;
          if (messageId) {
            this.realtime.emit(
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
              this.getRooms(running),
            );
          }
          return this.failRun(running, 'must_reply_failed: agent was @mentioned but did not reply');
        }
        this.realtime.emit(
          SocketEventNames.runEmptyCompletion,
          {
            organizationId: run.organizationId,
            runId: run.id,
            memberId: run.agentId,
            wakeReason: wakeReason ?? undefined,
            occurredAt: now,
          },
          this.getRooms(running),
        );
        return this.completeRun(running, 'empty', null);
      }

      const reply = text || 'Artifact updated.';
      await publishRunReplyTrace({
        repo: this.repo,
        conversations: this.conversations,
        run: running,
        result: {
          ...result,
          steps: result.steps.slice(persistedStepCount),
        },
        reply,
        reasoningContent,
        teamRoot: team.workspace.root,
        artifactFileToolCall,
        publishedArtifactFile,
        publishedContent,
        publishedAnyText,
        suppressDmAlerts: isDelegateRun(running, this.repo),
      });

      return this.completeRun(running, terminatingTool ?? reply, terminatingTool);
    } catch (error) {
      if (findToolApprovalRequiredError(error)) {
        if (this.consumeDeferredApprovalResume(run.organizationId, run.id)) {
          const afterApprovedTools = await this.executePendingApprovedRunTools(running);
          return this.advanceRun(afterApprovedTools);
        }
        return this.waitForApproval(running, pendingApprovalRunSummary(this.repo, running.organizationId, running.id));
      }
      const inputError = findToolInputRequiredError(error);
      if (inputError) {
        const question = this.repo.getInteractiveQuestion(run.organizationId, inputError.questionId);
        return this.waitForInput(running, question?.questionText ?? 'Waiting for user input');
      }
      const latestAfterError = this.repo.getRun(run.organizationId, run.id);
      if (latestAfterError?.status === 'cancelled') {
        publishStreamedTrace({
          repo: this.repo,
          conversations: this.conversations,
          run: latestAfterError,
          trace: streamedTrace,
          outcome: 'stopped',
        });
        return latestAfterError;
      }
      publishStreamedTrace({
        repo: this.repo,
        conversations: this.conversations,
        run: running,
        trace: streamedTrace,
        outcome: 'failed',
      });
      return this.failRun(running, (error as Error).message);
    } finally {
      this.runAbortControllers.delete(abortKey);
    }
  }

  protected completeRun(run: RunState, summary: string, terminatingTool: string | null = null): RunState {
    const completed = this.repo.saveRun({
      ...run,
      status: 'completed',
      step: 'completed',
      summary,
      terminatingTool,
      endedAt: new Date().toISOString(),
    });

    this.realtime.emit(
      SocketEventNames.runCompleted,
      { organizationId: run.organizationId, run: completed },
      this.getRooms(run),
    );

    this.invokeRunTerminalHook(completed);

    return completed;
  }

  private completeSilentRun(
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

  protected waitForApproval(run: RunState, summary: string): RunState {
    const waiting = this.repo.saveRun({
      ...run,
      status: 'waiting_for_approval',
      step: 'waiting_for_approval',
      summary,
    });

    this.realtime.emit(
      SocketEventNames.runUpdated,
      { organizationId: run.organizationId, run: waiting },
      this.getRooms(run),
    );

    return waiting;
  }

  protected waitForInput(run: RunState, summary: string): RunState {
    const waiting = this.repo.saveRun({
      ...run,
      status: 'waiting_for_input',
      step: 'waiting_for_input',
      summary,
    });

    this.realtime.emit(
      SocketEventNames.runUpdated,
      { organizationId: run.organizationId, run: waiting },
      this.getRooms(run),
    );

    return waiting;
  }

  protected failRun(run: RunState, summary: string): RunState {
    const failed = this.repo.saveRun({
      ...run,
      status: 'failed',
      step: 'failed',
      summary,
      endedAt: new Date().toISOString(),
    });

    this.realtime.emit(
      SocketEventNames.runCompleted,
      { organizationId: run.organizationId, run: failed },
      this.getRooms(run),
    );

    this.invokeRunTerminalHook(failed);

    return failed;
  }

  protected async executePendingApprovedRunTools(run: RunState): Promise<RunState> {
    await this.replayApprovedToolsForRun(run);
    return run;
  }
}

export class SpiritService extends SpiritServiceDirectRun {}
