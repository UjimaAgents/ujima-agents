import { randomUUID } from 'node:crypto';
import {
  ApprovalRequestSchema,
  SocketEventNames,
  orgRoom,
  runRoom,
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
    this.realtime.emit(
      SocketEventNames.approvalRequested,
      { organizationId: input.organizationId, approval },
      [orgRoom(input.organizationId), runRoom(input.runId)],
    );

    return approval;
  }

  async resolveApproval(input: ApprovalResolveInput): Promise<ApprovalRequest> {
    const approval = this.repo.resolveApproval(
      input.organizationId,
      input.approvalId,
      input.status,
      input.reason,
    );

    if (!approval) {
      throw new Error(`Approval not found: ${input.approvalId}`);
    }

    this.realtime.emit(
      SocketEventNames.approvalResolved,
      { organizationId: input.organizationId, approval },
      [orgRoom(input.organizationId), runRoom(approval.runId ?? approval.id)],
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
