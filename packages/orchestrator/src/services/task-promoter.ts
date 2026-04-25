import { randomUUID } from 'node:crypto';
import type { AuditEvent } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import type { RunService } from './run.js';

export interface TaskPromotionInput {
  organizationId: string;
  channelId: string;
  threadId?: string;
  messageId?: string;
  requestedBy: string;
  prompt: string;
  assignedAgentId?: string;
  reason?: string;
}

export interface TaskPromotionResult {
  runId: string;
  organizationId: string;
  assignedAgentId: string;
  status: string;
  auditEventId: string;
}

export class TaskPromoterService {
  constructor(
    private readonly repo: ApiRepository,
    private readonly runs: RunService,
  ) {}

  async promote(input: TaskPromotionInput): Promise<TaskPromotionResult> {
    const organization = this.repo.getOrganization(input.organizationId);
    if (!organization) {
      const audit = this.writeAudit(input, null, 'blocked', 'organization not found');
      throw Object.assign(new Error(`Organization not found: ${input.organizationId}`), {
        auditEventId: audit.id,
      });
    }

    const assignee = this.resolveAssignee(input);
    if (!assignee) {
      const audit = this.writeAudit(input, null, 'blocked', 'no agent member available');
      throw Object.assign(new Error('No agent member available to own the task'), {
        auditEventId: audit.id,
      });
    }

    const threadId = input.threadId ?? input.channelId;
    const run = await this.runs.createRun({
      organizationId: input.organizationId,
      agentId: assignee,
      threadId,
      summary: input.prompt,
    });

    const audit = this.writeAudit(input, assignee, 'ok', 'promoted to run', run.id);

    return {
      runId: run.id,
      organizationId: input.organizationId,
      assignedAgentId: assignee,
      status: run.status,
      auditEventId: audit.id,
    };
  }

  private resolveAssignee(input: TaskPromotionInput): string | null {
    if (input.assignedAgentId) {
      const member = this.repo.getMember(input.organizationId, input.assignedAgentId);
      if (member && member.kind === 'agent' && !member.retiredAt) return member.id;
      return null;
    }
    // Retired agents stay in storage for audit/history, so promotion has to
    // treat `retiredAt` as the active-membership boundary.
    const agents = this.repo
      .listMembers(input.organizationId)
      .filter((m) => m.kind === 'agent' && !m.retiredAt);
    return agents[0]?.id ?? null;
  }

  private writeAudit(
    input: TaskPromotionInput,
    assignee: string | null,
    status: 'ok' | 'blocked' | 'error',
    reason: string,
    runId?: string,
  ): AuditEvent {
    return this.repo.saveAuditEvent({
      id: randomUUID(),
      organizationId: input.organizationId,
      actorId: input.requestedBy,
      action: 'task.promoted',
      targetType: 'message',
      targetId: input.messageId,
      status,
      metadata: {
        channelId: input.channelId,
        threadId: input.threadId,
        assignedAgentId: assignee,
        runId,
        reason: input.reason ?? reason,
        prompt: input.prompt,
      },
      createdAt: new Date().toISOString(),
    });
  }
}
