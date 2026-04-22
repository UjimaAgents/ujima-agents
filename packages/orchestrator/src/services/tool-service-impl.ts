import { randomUUID } from 'node:crypto';
import type { AgentTeamHandle } from '@ujima/framework';
import {
  SocketEventNames,
  memberRoom,
  runRoom,
  type AuditStatus,
} from '@ujima/shared';
import type { RealtimeService } from './context.js';
import type { ConversationService } from './conversation.js';
import { checkToolPolicy } from './policy.js';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import { ORCHESTRATOR_TOOLS } from '../tools/index.js';
import type {
  ToolInvocationInput,
  ToolInvocationResult,
  ToolService,
} from './tool-service.js';

export interface ApprovalRequester {
  requestApproval(input: {
    organizationId: string;
    runId: string;
    requestedBy: string;
    resourceType: ToolInvocationInput['resourceType'];
    resourcePath: string;
    action: ToolInvocationInput['action'];
    reason: string;
  }): { id: string };
}

export class ToolServiceImpl implements ToolService {
  private readonly approvedRuns = new Set<string>();

  constructor(
    private readonly teamStore: TeamStore,
    private readonly repo: ApiRepository,
    private readonly approvals: ApprovalRequester,
    private readonly conversations: ConversationService,
    private readonly realtime: RealtimeService,
  ) {}

  allowRun(organizationId: string, runId: string): void {
    this.approvedRuns.add(this.runKey(organizationId, runId));
  }

  async invoke(invocation: ToolInvocationInput): Promise<ToolInvocationResult> {
    const member = this.repo.getMember(invocation.organizationId, invocation.memberId);
    if (!member) {
      throw new Error(`Member not found: ${invocation.memberId}`);
    }

    const rooms = [runRoom(invocation.runId), memberRoom(invocation.memberId)];

    this.realtime.emit(
      SocketEventNames.toolCalled,
      {
        organizationId: invocation.organizationId,
        runId: invocation.runId,
        agentId: invocation.memberId,
        toolCall: {
          toolCallId: invocation.toolCallId,
          toolName: invocation.toolId,
          args: invocation.input,
        },
      },
      rooms,
    );

    const policy = checkToolPolicy(
      this.requireTeam(),
      member.roleName,
      invocation.toolId,
      invocation.action,
      invocation.resourcePath,
    );

    if (!policy.allowed) {
      this.audit(invocation, 'blocked', { reason: policy.reason });

      this.realtime.emit(
        SocketEventNames.toolResult,
        {
          organizationId: invocation.organizationId,
          runId: invocation.runId,
          agentId: invocation.memberId,
          toolResult: {
            toolCallId: invocation.toolCallId,
            result: { error: policy.reason },
            isError: true,
          },
        },
        rooms,
      );

      return { ok: false, error: policy.reason, output: { status: 'blocked', reason: policy.reason } };
    }

    if (
      policy.requiresApproval &&
      !this.consumeApprovedRun(invocation.organizationId, invocation.runId)
    ) {
      const approval = this.approvals.requestApproval({
        organizationId: invocation.organizationId,
        runId: invocation.runId,
        requestedBy: invocation.memberId,
        resourceType: invocation.resourceType,
        resourcePath: invocation.resourcePath ?? '',
        action: invocation.action,
        reason: 'Tool action requires approval',
      });

      this.audit(invocation, 'ok', { approvalId: approval.id, status: 'pending_approval' });

      this.realtime.emit(
        SocketEventNames.toolResult,
        {
          organizationId: invocation.organizationId,
          runId: invocation.runId,
          agentId: invocation.memberId,
          toolResult: {
            toolCallId: invocation.toolCallId,
            result: { status: 'waiting_for_approval' },
            isError: false,
          },
        },
        rooms,
      );

      return {
        ok: false,
        requiresApprovalId: approval.id,
        output: { status: 'waiting_for_approval', approvalId: approval.id },
      };
    }

    try {
      const result = await this.executeTool(invocation);
      this.audit(invocation, 'ok', { status: 'completed' });

      this.realtime.emit(
        SocketEventNames.toolResult,
        {
          organizationId: invocation.organizationId,
          runId: invocation.runId,
          agentId: invocation.memberId,
          toolResult: { toolCallId: invocation.toolCallId, result, isError: false },
        },
        rooms,
      );

      return { ok: true, output: { status: 'completed', result } };
    } catch (error) {
      const message = (error as Error).message;
      this.audit(invocation, 'error', { error: message });

      this.realtime.emit(
        SocketEventNames.toolResult,
        {
          organizationId: invocation.organizationId,
          runId: invocation.runId,
          agentId: invocation.memberId,
          toolResult: {
            toolCallId: invocation.toolCallId,
            result: { error: message },
            isError: true,
          },
        },
        rooms,
      );

      throw error;
    }
  }

  private async executeTool(invocation: ToolInvocationInput): Promise<unknown> {
    const tool = ORCHESTRATOR_TOOLS[invocation.toolId];

    if (tool) {
      return tool.execute({
        invocation,
        team: this.requireTeam(),
        repo: this.repo,
        conversations: this.conversations,
      });
    }

    if (invocation.toolId === 'mcp') {
      throw new Error('MCP proxying is not yet implemented in the local runtime');
    }

    throw new Error(
      `Tool "${invocation.toolId}" action "${invocation.action}" is not implemented`,
    );
  }

  private requireTeam(): AgentTeamHandle {
    const team = this.teamStore.getTeam();
    if (!team) {
      throw new Error('Team config not loaded');
    }
    return team;
  }

  private consumeApprovedRun(organizationId: string, runId: string): boolean {
    const key = this.runKey(organizationId, runId);
    if (!this.approvedRuns.has(key)) {
      return false;
    }
    this.approvedRuns.delete(key);
    return true;
  }

  private runKey(organizationId: string, runId: string): string {
    return `${organizationId}:${runId}`;
  }

  private audit(
    invocation: ToolInvocationInput,
    status: AuditStatus,
    metadata: Record<string, unknown>,
  ): void {
    this.repo.saveAuditEvent({
      id: randomUUID(),
      organizationId: invocation.organizationId,
      actorId: invocation.memberId,
      action: `tool.${invocation.action}`,
      targetType: invocation.resourceType,
      targetId: invocation.toolId,
      status,
      metadata: { ...invocation.input, ...metadata },
      createdAt: new Date().toISOString(),
    });
  }
}
