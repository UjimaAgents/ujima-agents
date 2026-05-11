import { randomUUID } from 'node:crypto';
import { normalizeProviderKey } from '@ujima/framework';
import {
  AGENT_KIND,
  MessageSchema,
  RunStateSchema,
  SocketEventNames,
  memberRoom,
  orgRoom,
  runRoom,
  threadRoom,
  type RunState,
  type Message,
  type RunStep,
} from '@ujima/shared';
import type { AiService } from '../ai-service.js';
import { requireTeam } from '../utils/require-team.js';
import type { RealtimeService } from './context.js';
import type { ConversationService } from './conversation.js';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import type { ToolInvocationInput, ToolService } from './tool-service.js';
import { applyDashboardTeamOverrides } from './dashboard-team-overrides.js';
import { ToolApprovalRequiredError } from './tool-loop-result.js';
import { extractReasoningChunk } from '../utils/extract-reasoning.js';
import { runUsedThreadPublishingTool } from './run-reply-guard.js';

export interface CreateRunInput {
  organizationId: string;
  agentId: string;
  threadId: string;
  summary?: string;
}

export interface RunDetailAggregate {
  count: number;
  pending: number;
}

export interface RunDetail {
  run: RunState;
  approvals: ReturnType<ApiRepository['listPendingApprovals']>;
  messages: ReturnType<ApiRepository['listMessages']>['data'];
  steps: RunStep[];
  message?: Message;
  activeAgents: { memberId: string; statusLabel: string }[];
  tokens: { perMemberId: Record<string, number> };
  tools: Record<string, RunDetailAggregate>;
}

export interface RunTraceDetail {
  run: RunState;
  approvals: ReturnType<ApiRepository['listPendingApprovals']>;
  messages: Message[];
  steps: RunStep[];
  message?: Message;
}

export class RunService {
  private readonly deferredApprovalResumes = new Set<string>();
  private readonly runAbortControllers = new Map<string, AbortController>();

  constructor(
    private readonly teamStore: TeamStore,
    private readonly repo: ApiRepository,
    private readonly realtime: RealtimeService,
    private readonly conversations: ConversationService,
    private readonly ai: AiService,
    private readonly tools: ToolService,
  ) {}

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
      id: randomUUID(),
      organizationId: input.organizationId,
      agentId: input.agentId,
      threadId: input.threadId,
      status: 'queued',
      step: 'queued',
      summary: input.summary ?? 'Run queued',
      startedAt: new Date().toISOString(),
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
      if (error instanceof ToolApprovalRequiredError) {
        return this.waitForApproval(run, 'Waiting for approval');
      }
      return this.failRun(run, (error as Error).message);
    }
  }

  async resumeAfterApproval(
    organizationId: string,
    runId: string,
    allowRun = true,
    approvalScope?: string,
  ): Promise<RunState> {
    const run = this.repo.getRun(organizationId, runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    if (allowRun) {
      this.tools.allowRun(organizationId, runId, approvalScope);
    }

    if (!allowRun) {
      if (run.status === 'running') {
        return this.failRun(run, 'Approval rejected by user');
      }
      if (run.status === 'waiting_for_approval') {
        return this.failRun(run, 'Approval rejected by user');
      }
      return run;
    }

    if (run.status === 'running') {
      const key = this.runKey(organizationId, runId);
      if (this.runAbortControllers.has(key)) {
        this.deferredApprovalResumes.add(key);
        return run;
      }
      const afterApprovedTools = await this.executePendingApprovedTools(run);
      return this.advanceRun(afterApprovedTools);
    }

    if (run.status !== 'waiting_for_approval') {
      return run;
    }

    const afterApprovedTools = await this.executePendingApprovedTools(run);

    return this.advanceRun({
      ...afterApprovedTools,
      status: 'running',
      step: 'running',
      summary: 'Run resumed after approval',
    });
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

  getRunTraceDetail(organizationId: string, runId: string): RunTraceDetail | null {
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
          item.senderId === run.agentId &&
          item.senderKind === AGENT_KIND &&
          item.kind === AGENT_KIND &&
          item.createdAt >= run.startedAt &&
          (run.endedAt == null || item.createdAt <= run.endedAt),
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
        activeAgents: LIVE_RUN_DETAIL_STATUSES.has(run.status)
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
      ? this.repo.listChannelMessages(organizationId, session.channelId, { limit: 500 }).data
      : messages;

    const activeAgents = sessionSpirits
      .filter((current) => LIVE_RUN_DETAIL_STATUSES.has(current.status))
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

  private getRooms(run: RunState) {
    const rooms = [orgRoom(run.organizationId), memberRoom(run.agentId), runRoom(run.id)];
    if (run.threadId) {
      rooms.push(threadRoom(run.threadId));
    }
    return rooms;
  }

  private listAllThreadMessages(organizationId: string, threadId: string): Message[] {
    const messages: Message[] = [];
    let cursor: string | undefined = undefined;
    do {
      const page = this.repo.listMessages(organizationId, threadId, cursor, 100);
      messages.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return messages;
  }

  private async advanceRun(run: RunState): Promise<RunState> {
    const currentRun = this.repo.getRun(run.organizationId, run.id);
    if (currentRun && ['completed', 'failed', 'cancelled'].includes(currentRun.status)) {
      return currentRun;
    }

    applyDashboardTeamOverrides(this.repo, run.organizationId, this.teamStore);
    const team = requireTeam(this.teamStore);
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

    const providerName = normalizeProviderKey(member.llm ?? role.provider ?? '');
    if (providerName && !this.repo.getProviderCredential(run.organizationId, providerName)) {
      return this.failRun(run, `Provider key missing for "${providerName}"`);
    }

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
      this.getRooms(run),
    );

    const abortKey = this.runKey(run.organizationId, run.id);
    const abortController = new AbortController();
    this.runAbortControllers.set(abortKey, abortController);

    try {
      const result = await this.ai.generateRunReply({
        organizationId: run.organizationId,
        agentId: run.agentId,
        threadId: run.threadId ?? '',
        runId: run.id,
        summary: run.summary,
        abortSignal: abortController.signal,
      });

      const latestRun = this.repo.getRun(run.organizationId, run.id);
      if (latestRun && latestRun.status !== 'running') {
        return latestRun;
      }

      if (this.consumeDeferredApprovalResume(run.organizationId, run.id)) {
        const afterApprovedTools = await this.executePendingApprovedTools(running);
        return this.advanceRun(afterApprovedTools);
      }

      const statuses = [
        ...result.toolResults,
        ...result.steps.flatMap(
          (step: (typeof result.steps)[number]) => step?.toolResults ?? [],
        ),
      ]
        .map((toolResult) => (toolResult?.output as { status?: string } | undefined)?.status)
        .filter((status): status is string => typeof status === 'string');
      if (statuses.includes('blocked')) {
        return this.failRun(running, 'Tool action blocked');
      }

      if (statuses.includes('waiting_for_approval')) {
        return this.waitForApproval(running, 'Waiting for approval');
      }

      const pendingApprovalExists = this.repo
        .listPendingApprovals(run.organizationId)
        .some((approval) => approval.runId === run.id);
      if (pendingApprovalExists) {
        return this.waitForApproval(running, 'Waiting for approval');
      }

      const text = result.text.trim();
      const reply = text || 'Acknowledged.';
      const reasoningContent = extractReasoningChunk(result);
      const skipFinalThreadMessage = runUsedThreadPublishingTool(result);
      if (run.threadId && !skipFinalThreadMessage) {
        this.conversations.publishMessage(
          MessageSchema.parse({
            id: randomUUID(),
            organizationId: run.organizationId,
            threadId: run.threadId,
            channelId: this.repo.getThread(run.organizationId, run.threadId)?.channelId,
            senderId: run.agentId,
            senderKind: AGENT_KIND,
            kind: AGENT_KIND,
            content: reply,
            ...(reasoningContent ? { reasoningContent } : {}),
            createdAt: new Date().toISOString(),
          }),
        );
      }

      return this.completeRun(running, reply);
    } catch (error) {
      if (error instanceof ToolApprovalRequiredError) {
        if (this.consumeDeferredApprovalResume(run.organizationId, run.id)) {
          const afterApprovedTools = await this.executePendingApprovedTools(running);
          return this.advanceRun(afterApprovedTools);
        }
        return this.waitForApproval(running, 'Waiting for approval');
      }
      const latestAfterError = this.repo.getRun(run.organizationId, run.id);
      if (latestAfterError?.status === 'cancelled') {
        return latestAfterError;
      }
      return this.failRun(running, (error as Error).message);
    } finally {
      this.runAbortControllers.delete(abortKey);
    }
  }

  private completeRun(run: RunState, summary: string): RunState {
    const completed = this.repo.saveRun({
      ...run,
      status: 'completed',
      step: 'completed',
      summary,
      endedAt: new Date().toISOString(),
    });

    this.realtime.emit(
      SocketEventNames.runCompleted,
      { organizationId: run.organizationId, run: completed },
      this.getRooms(run),
    );

    return completed;
  }

  private waitForApproval(run: RunState, summary: string): RunState {
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

  private failRun(run: RunState, summary: string): RunState {
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

    return failed;
  }

  private consumeDeferredApprovalResume(organizationId: string, runId: string): boolean {
    const key = this.runKey(organizationId, runId);
    if (!this.deferredApprovalResumes.has(key)) {
      return false;
    }
    this.deferredApprovalResumes.delete(key);
    return true;
  }

  private async executePendingApprovedTools(run: RunState): Promise<RunState> {
    const runSteps =
      typeof this.repo.listRunSteps === 'function'
        ? this.repo.listRunSteps(run.organizationId, run.id)
        : [];
    const pendingApprovalToolCallIds = new Set(
      this.repo
        .listPendingApprovals(run.organizationId)
        .filter((approval) => approval.runId === run.id && approval.toolCallId)
        .map((approval) => approval.toolCallId as string),
    );
    const pendingSteps = runSteps
      .filter((step) => {
        const output = step.output as { status?: unknown } | undefined;
        return (
          output?.status === 'waiting_for_approval' &&
          !pendingApprovalToolCallIds.has(step.toolCallId)
        );
      });

    for (const step of pendingSteps) {
      const invocation: ToolInvocationInput = {
        organizationId: step.organizationId,
        runId: step.runId,
        memberId: step.agentId,
        threadId: step.threadId,
        toolCallId: step.toolCallId,
        toolId: step.toolId,
        action: step.action,
        resourceType: step.resourceType,
        resourcePath: step.resourcePath || undefined,
        input: step.input,
        bypassPermission: true,
      };

      try {
        await this.tools.invoke(invocation);
      } catch {
        // Tool failures are already persisted by ToolService; keep going.
      }
    }

    return run;
  }

  private runKey(organizationId: string, runId: string): string {
    return `${organizationId}:${runId}`;
  }
}

const LIVE_RUN_DETAIL_STATUSES = new Set(['queued', 'running', 'waiting_for_approval']);

function aggregateToolUsage(messages: readonly { toolCalls: readonly { toolName: string; result?: unknown }[] }[]) {
  const tools: Record<string, RunDetailAggregate> = {};
  for (const message of messages) {
    for (const toolCall of message.toolCalls) {
      const current = (tools[toolCall.toolName] ??= { count: 0, pending: 0 });
      current.count += 1;
      if (toolCallResultIsPending(toolCall.result)) {
        current.pending += 1;
      }
    }
  }
  return tools;
}

function toolCallResultIsPending(result: unknown): boolean {
  if (!result || typeof result !== 'object') {
    return false;
  }
  const record = result as Record<string, unknown>;
  if (record.status === 'waiting_for_approval') {
    return true;
  }
  const nested = record.result;
  return Boolean(
    nested &&
      typeof nested === 'object' &&
      (nested as Record<string, unknown>).status === 'waiting_for_approval',
  );
}
