import { randomUUID } from 'node:crypto';
import {
  RunStateSchema,
  SocketEventNames,
  type RunState,
  type Spirit,
  AGENT_KIND,
} from '@ujima/shared';
import { isLiveRunStatus, isLiveSpiritStatus } from './live-status.js';
import { findToolApprovalRequiredError, findToolInputRequiredError } from './tool-loop-result.js';
import { pendingApprovalRunSummary } from './approval-summary.js';
import type { CreateRunInput, RunDetail } from './spirit-types.js';
import { aggregateToolUsage } from './spirit-run-detail.js';
import type { RunSpiritOutcome } from './spirit-types.js';
import { SpiritServiceSupervisor } from './spirit-supervisor.js';

export class SpiritService extends SpiritServiceSupervisor {
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
          this.failRun(run, 'Approval rejected by user');
        }
        return failed;
      }

      await this.replayApprovedToolsForSpirit(spirit);

      if (spirit.status === 'running') {
        return spirit;
      }

      if (spirit.status !== 'waiting_for_approval') {
        return spirit;
      }

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
      summary: afterApprovedTools.summary,
    });
  }

  async resumeAfterInput(
    organizationId: string,
    runId: string,
    allowRun = true,
  ): Promise<RunSpiritOutcome | Spirit | RunState | null> {
    const spirit = this.resolveSpiritForRun(organizationId, runId);
    if (spirit) {
      if (!allowRun) {
        const failed = this.updateStatus(organizationId, spirit.id, 'failed', {
          error: 'Implementation rejected by user',
        });
        const run = this.repo.getRun(organizationId, runId);
        if (run) {
          this.failRun(run, 'Implementation rejected by user');
        }
        return failed;
      }
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
    if (!allowRun) {
      return this.failRun(run, 'Implementation rejected by user');
    }

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
      id: input.runId ?? randomUUID(),
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

    try {
      return await this.advanceRun(run, SocketEventNames.runStarted);
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
      // Log the full stack — direct runs (workflow agent nodes, programmatic
      // spawns) otherwise fail with only the message, which hides the throw site
      // for opaque errors like "Right hand side of instanceof is not an object".
      console.error('[spirit-direct-run] run failed', {
        organizationId: run.organizationId,
        runId: run.id,
        agentId: run.agentId,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
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
        const detail = this.getRunTraceDetail(organizationId, run.id, false);
        return detail ? [detail] : [];
      }),
    };
  }

  getRun(organizationId: string, runId: string) {
    return this.repo.getRun(organizationId, runId);
  }

  getRunTraceDetail(organizationId: string, runId: string, includeMessages = true) {
    const run = this.repo.getRun(organizationId, runId);
    if (!run) {
      return null;
    }

    const approvals = this.repo
      .listPendingApprovals(organizationId)
      .filter((approval) => approval.runId === runId);
    const messages = includeMessages && run.threadId ? this.listAllThreadMessages(organizationId, run.threadId) : [];
    const steps = this.repo.listRunSteps(organizationId, runId);
    const message =
      includeMessages || !run.threadId
        ? [...messages]
            .reverse()
            .find(
              (item) =>
                item.metadata?.runId === run.id &&
                item.senderId === run.agentId &&
                item.senderKind === AGENT_KIND &&
                item.kind === AGENT_KIND,
            )
        : this.findLatestThreadMessageForRun(organizationId, run.threadId, run.id, run.agentId);

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

    const cancelledAt = new Date().toISOString();
    const pendingApprovals = this.repo
      .listPendingApprovals(organizationId)
      .filter((approval) => approval.runId === runId);
    const pendingQuestions = this.repo.listInteractiveQuestionsByRunId?.(organizationId, runId) ?? [];
    for (const question of pendingQuestions) {
      if (question.status !== 'pending') continue;
      this.repo.saveInteractiveQuestion?.({
        ...question,
        status: 'superseded',
        updatedAt: cancelledAt,
      });
    }
    const cancelled = this.repo.saveRun({
      ...run,
      status: 'cancelled',
      step: 'cancelled',
      summary: 'Stopped by user',
      endedAt: cancelledAt,
    });
    this.runAbortControllers.get(key)?.abort();
    this.runAbortControllers.delete(key);
    const spirit = this.repo.getSpiritByRunId?.(organizationId, runId) ?? null;
    if (spirit && isLiveSpiritStatus(spirit.status)) {
      const cancelledSpirit: Spirit = {
        ...spirit,
        status: 'cancelled',
        lastError: 'Stopped by user',
        updatedAt: cancelledAt,
        endedAt: spirit.endedAt ?? cancelledAt,
      };
      this.repo.saveSpirit(cancelledSpirit);
      this.registry.unregister(cancelledSpirit.organizationId, cancelledSpirit.memberId, cancelledSpirit.id);
      this.emit(SocketEventNames.spiritCompleted, cancelledSpirit);
      this.maybeFinalizeTaskSession(cancelledSpirit.organizationId, cancelledSpirit.taskSessionId, 'Stopped by user');
    }

    this.realtime.emit(
      SocketEventNames.runCompleted,
      { organizationId: run.organizationId, run: cancelled },
      this.getRooms(run),
    );
    for (const approval of pendingApprovals) {
      const resolved = this.repo.resolveApproval(
        organizationId,
        approval.id,
        'rejected',
        'Run cancelled by user.',
      );
      if (!resolved) continue;
      this.realtime.emit(
        SocketEventNames.approvalResolved,
        { organizationId, threadId: cancelled.threadId, approval: resolved },
        this.getRooms(cancelled),
      );
    }
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

  protected async advanceRun(
    run: RunState,
    eventName: typeof SocketEventNames.runStarted | typeof SocketEventNames.runUpdated = SocketEventNames.runUpdated,
  ): Promise<RunState> {
    return this.executeDirectTurn(run, eventName);
  }

}
