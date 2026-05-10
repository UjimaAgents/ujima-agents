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
} from '@ujima/shared';
import type { AiService } from '../ai-service.js';
import { requireTeam } from '../utils/require-team.js';
import type { RealtimeService } from './context.js';
import type { ConversationService } from './conversation.js';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import type { ToolService } from './tool-service.js';
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
      this.deferredApprovalResumes.add(this.runKey(organizationId, runId));
      return run;
    }

    if (run.status !== 'waiting_for_approval') {
      return run;
    }

    return this.advanceRun({
      ...run,
      status: 'running',
      step: 'running',
      summary: 'Run resumed after approval',
    });
  }

  listRuns(organizationId: string, cursor?: string, limit?: number) {
    return this.repo.listRuns(organizationId, cursor, limit);
  }

  getRun(organizationId: string, runId: string) {
    return this.repo.getRun(organizationId, runId);
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

  getRunDetail(organizationId: string, runId: string) {
    const run = this.repo.getRun(organizationId, runId);
    if (!run) return null;

    const approvals = this.repo
      .listPendingApprovals(organizationId)
      .filter((approval) => approval.runId === runId);

    const messages: Message[] = [];
    if (run.threadId) {
      let cursor: string | undefined = undefined;
      do {
        const page = this.repo.listMessages(organizationId, run.threadId, cursor, 100);
        messages.push(...page.data);
        cursor = page.nextCursor;
      } while (cursor);
    }

    return { run, approvals, messages };
  }

  private getRooms(run: RunState) {
    const rooms = [orgRoom(run.organizationId), memberRoom(run.agentId), runRoom(run.id)];
    if (run.threadId) {
      rooms.push(threadRoom(run.threadId));
    }
    return rooms;
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
        return this.advanceRun(running);
      }

      const pendingApprovalExists = this.repo
        .listPendingApprovals(run.organizationId)
        .some((approval) => approval.runId === run.id);
      if (pendingApprovalExists) {
        return this.waitForApproval(running, 'Waiting for approval');
      }

      const statuses = [
        ...result.toolResults,
        ...result.steps.flatMap((step) => step.toolResults),
      ]
        .map((toolResult) => (toolResult.output as { status?: string } | undefined)?.status)
        .filter((status): status is string => typeof status === 'string');
      if (statuses.includes('blocked')) {
        return this.failRun(running, 'Tool action blocked');
      }

      if (statuses.includes('waiting_for_approval')) {
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
          return this.advanceRun(running);
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
  private runKey(organizationId: string, runId: string): string {
    return `${organizationId}:${runId}`;
  }
}
