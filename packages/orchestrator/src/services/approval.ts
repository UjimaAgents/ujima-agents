import { randomUUID } from 'node:crypto';
import {
  ApprovalRequestSchema,
  SocketEventNames,
  orgRoom,
  runRoom,
  threadRoom,
  type ApprovalRequest,
  type ResourceType,
  type ToolAction,
} from '@ujima/shared';
import type { RealtimeService } from './context.js';
import type { ApiRepository } from './repository-reader.js';

export interface ApprovalRequestInput {
  organizationId: string;
  runId: string;
  requestedBy: string;
  resourceType: ResourceType;
  resourcePath: string;
  action: ToolAction;
  reason: string;
}

export interface ApprovalResolveInput {
  organizationId: string;
  approvalId: string;
  status: 'approved' | 'rejected';
  resolution?: 'allow_once' | 'allow_always' | 'reject';
  reason?: string;
}

export type ResumeRun = (
  organizationId: string,
  runId: string,
) => Promise<unknown> | unknown;

export class ApprovalService {
  constructor(
    private readonly repo: ApiRepository,
    private readonly realtime: RealtimeService,
    private readonly resumeRun: ResumeRun,
  ) {}

  requestApproval(input: ApprovalRequestInput): ApprovalRequest {
    const approval = ApprovalRequestSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      runId: input.runId,
      requestedBy: input.requestedBy,
      resourceType: input.resourceType,
      resourcePath: input.resourcePath,
      action: input.action,
      status: 'pending',
      reason: input.reason,
      createdAt: new Date().toISOString(),
    });

    this.repo.saveApproval(approval);
    const rooms = [orgRoom(input.organizationId), runRoom(input.runId)];
    const run = this.repo.getRun(input.organizationId, input.runId);
    if (run?.threadId) {
      rooms.push(threadRoom(run.threadId));
    }
    this.realtime.emit(
      SocketEventNames.approvalRequested,
      { organizationId: input.organizationId, threadId: run?.threadId, approval },
      rooms,
    );

    return approval;
  }

  async resolveApproval(input: ApprovalResolveInput): Promise<ApprovalRequest> {
    const existing = this.repo.getApproval(input.organizationId, input.approvalId);
    const scopeMatch = existing?.reason.match(/(?:^|;)scope=([^;]+)/);
    const approvalScope = scopeMatch?.[1];
    const canPersistGrant =
      input.resolution === 'allow_always' &&
      !!approvalScope;
    const effectiveReason =
      canPersistGrant
        ? `grant:always_allow:scope=${approvalScope};note=${input.reason ?? ''}`
        : input.reason;
    const approval = this.repo.resolveApproval(
      input.organizationId,
      input.approvalId,
      input.status,
      effectiveReason,
    );

    if (!approval) {
      throw new Error(`Approval not found: ${input.approvalId}`);
    }

    const rooms = [orgRoom(input.organizationId), runRoom(approval.runId ?? approval.id)];
    const run = approval.runId ? this.repo.getRun(input.organizationId, approval.runId) : null;
    if (run?.threadId) {
      rooms.push(threadRoom(run.threadId));
    }
    this.realtime.emit(
      SocketEventNames.approvalResolved,
      { organizationId: input.organizationId, threadId: run?.threadId, approval },
      rooms,
    );

    if (approval.status === 'approved' && approval.runId) {
      await this.resumeRun(approval.organizationId, approval.runId);
    }

    return approval;
  }

  listPending(organizationId: string): ApprovalRequest[] {
    return this.repo.listPendingApprovals(organizationId);
  }
}
