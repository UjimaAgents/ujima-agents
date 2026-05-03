import { randomUUID } from 'node:crypto';
import {
  MessageSchema,
  RunStateSchema,
  SocketEventNames,
  memberRoom,
  orgRoom,
  runRoom,
  threadRoom,
  type RunState,
} from '@ujima/shared';
import type { AgentTeamHandle } from '@ujima/framework';
import type { AiService } from '../ai-service.js';
import type { RealtimeService } from './context.js';
import type { ConversationService } from './conversation.js';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import type { ToolService } from './tool-service.js';

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
  activeAgents: { memberId: string; statusLabel: string }[];
  tokens: { perMemberId: Record<string, number> };
  tools: Record<string, RunDetailAggregate>;
}

export class RunService {
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

    if (member.kind !== 'agent') {
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

    return this.advanceRun(run);
  }

  async resumeAfterApproval(organizationId: string, runId: string): Promise<RunState> {
    const run = this.repo.getRun(organizationId, runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    if (run.status !== 'waiting_for_approval') {
      return run;
    }

    this.tools.allowRun(organizationId, runId);
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

  getRunDetail(organizationId: string, runId: string): RunDetail | null {
    const run = this.repo.getRun(organizationId, runId);
    if (!run) return null;

    const spirit = this.repo.getSpiritByRunId(organizationId, runId);
    if (!spirit) {
      const approvals = this.repo
        .listPendingApprovals(organizationId)
        .filter((approval) => approval.runId === runId);
      const messages = run.threadId
        ? this.repo.listMessages(organizationId, run.threadId).data
        : [];

      return {
        run,
        approvals,
        messages,
        activeAgents:
          run.status === 'queued' || run.status === 'running' || run.status === 'waiting_for_approval'
            ? [{ memberId: run.agentId, statusLabel: run.status }]
            : [],
        tokens: { perMemberId: { [run.agentId]: 0 } },
        tools: aggregateToolUsage(messages),
      };
    }

    const session = this.repo.getTaskSession(organizationId, spirit.taskSessionId);
    const sessionSpirits = this.repo.listSpiritsForSession(organizationId, spirit.taskSessionId);
    const runIds = new Set(sessionSpirits.map((current) => current.runId).filter(Boolean));
    const approvals = this.repo
      .listPendingApprovals(organizationId)
      .filter((approval) => approval.runId && runIds.has(approval.runId));
    const messages = session
      ? this.repo.listChannelMessages(organizationId, session.channelId, { limit: 500 }).data
      : run.threadId
        ? this.repo.listMessages(organizationId, run.threadId).data
        : [];

    const activeAgents = sessionSpirits
      .filter((current) => LIVE_RUN_DETAIL_STATUSES.has(current.status))
      .map((current) => ({
        memberId: current.memberId,
        statusLabel:
          current.role === 'supervisor' ? `supervisor:${current.status}` : current.status,
      }));

    const perMemberId: Record<string, number> = {};
    for (const current of sessionSpirits) {
      perMemberId[current.memberId] = (perMemberId[current.memberId] ?? 0) + current.tokensUsed;
    }

    return {
      run,
      approvals,
      messages,
      activeAgents,
      tokens: { perMemberId },
      tools: aggregateToolUsage(messages),
    };
  }

  private getRooms(run: RunState) {
    const rooms = [orgRoom(run.organizationId), memberRoom(run.agentId), runRoom(run.id)];
    if (run.threadId) {
      rooms.push(threadRoom(run.threadId));
    }
    return rooms;
  }

  private async advanceRun(run: RunState): Promise<RunState> {
    const team = this.requireTeam();
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

    const providerName = role.provider;
    if (providerName && !this.repo.getProviderCredential(run.organizationId, providerName)) {
      return this.failRun(run, `Provider key missing for "${providerName}"`);
    }

    const running = this.repo.saveRun({
      ...run,
      status: 'running',
      step: 'running',
      summary: 'Run executing',
    });

    this.realtime.emit(
      SocketEventNames.runUpdated,
      { organizationId: run.organizationId, run: running },
      this.getRooms(run),
    );

    try {
      const result = await this.ai.generateRunReply({
        organizationId: run.organizationId,
        agentId: run.agentId,
        threadId: run.threadId ?? '',
        runId: run.id,
        summary: run.summary,
      });

      const statuses = result.toolResults.map(
        (toolResult) => (toolResult.output as { status?: string } | undefined)?.status,
      );
      if (statuses.includes('blocked')) {
        return this.failRun(running, 'Tool action blocked');
      }

      if (statuses.includes('waiting_for_approval')) {
        return this.waitForApproval(running, 'Waiting for approval');
      }

      const text = result.text.trim();
      if (text.length > 0 && run.threadId) {
        this.conversations.publishMessage(
          MessageSchema.parse({
            id: randomUUID(),
            organizationId: run.organizationId,
            threadId: run.threadId,
            channelId: this.repo.getThread(run.organizationId, run.threadId)?.channelId,
            senderId: run.agentId,
            senderKind: 'agent',
            kind: 'agent',
            content: text,
            createdAt: new Date().toISOString(),
          }),
        );
      }

      return this.completeRun(running, text || 'Run completed');
    } catch (error) {
      return this.failRun(running, (error as Error).message);
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

  private requireTeam(): AgentTeamHandle {
    const team = this.teamStore.getTeam();
    if (!team) {
      throw new Error('Team config not loaded');
    }
    return team;
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
