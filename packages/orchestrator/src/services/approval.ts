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
  toolCallId: string;
  requestedBy: string;
  resourceType: ResourceType;
  resourcePath: string;
  action: ToolAction;
  reason: string;
  approvalScope?: string;
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
  allowRun?: boolean,
) => Promise<unknown> | unknown;

export class ApprovalService {
  constructor(
    private readonly repo: ApiRepository,
    private readonly realtime: RealtimeService,
    private readonly resumeRun: ResumeRun,
  ) {}

  requestApproval(input: ApprovalRequestInput): ApprovalRequest {
    const existing = input.approvalScope
      ? this.repo
          .listPendingApprovals(input.organizationId)
          .find(
            (approval) =>
              approval.runId === input.runId &&
              approval.requestedBy === input.requestedBy &&
              approval.resourceType === input.resourceType &&
              approval.resourcePath === input.resourcePath &&
              approval.action === input.action &&
              decodeApprovalScope(approval.reason) === input.approvalScope,
          )
      : undefined;

    if (existing) {
      if (!existing.toolCallId) {
        const updated = ApprovalRequestSchema.parse({
          ...existing,
          toolCallId: input.toolCallId,
        });
        this.repo.saveApproval(updated);
        return updated;
      }
      return existing;
    }

    const approval = ApprovalRequestSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      runId: input.runId,
      toolCallId: input.toolCallId,
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
    const scopeMatch = existing?.reason.match(/(?:^|[;:])scope=([^;]+)/);
    // The scope in the reason is stored URL-encoded by ToolServiceImpl. We decode
    // it here so we have the raw scope, then re-encode it when building the
    // permanent grant reason string. This ensures consistency with how
    // hasApprovalGrant searches for the record.
    const rawScope = scopeMatch && scopeMatch[1] ? decodeURIComponent(scopeMatch[1]) : undefined;
    const canPersistGrant =
      input.resolution === 'allow_always' &&
      !!rawScope;
    const effectiveReason =
      input.status === 'rejected' && rawScope
        ? `reject:scope=${encodeURIComponent(rawScope)};note=${input.reason ?? ''}`
        : canPersistGrant && rawScope
          ? `grant:always_allow:scope=${encodeURIComponent(rawScope)};note=${input.reason ?? ''}`
          : input.reason;
    const matchingPendingApprovals = existing && rawScope
      ? this.repo
          .listPendingApprovals(input.organizationId)
          .filter(
            (approval) =>
              approval.runId === existing.runId &&
              approval.requestedBy === existing.requestedBy &&
              approval.resourceType === existing.resourceType &&
              approval.resourcePath === existing.resourcePath &&
              approval.action === existing.action &&
              decodeApprovalScope(approval.reason) === rawScope,
          )
      : [];

    const approvalIds = new Set<string>();
    const approvals = [existing, ...matchingPendingApprovals].filter(
      (approval): approval is ApprovalRequest =>
        !!approval &&
        approval.status === 'pending' &&
        !approvalIds.has(approval.id) &&
        (approvalIds.add(approval.id), true),
    );
    const resolvedApprovals =
      input.status === 'rejected'
        ? approvals.map((approval) =>
            ApprovalRequestSchema.parse({
              ...approval,
              status: 'rejected',
              reason: effectiveReason,
              resolvedAt: new Date().toISOString(),
            }),
          )
        : approvals
            .map((approval) =>
              this.repo.resolveApproval(
                input.organizationId,
                approval.id,
                input.status,
                effectiveReason,
              ),
            )
            .filter((approval): approval is ApprovalRequest => !!approval);

    const approval = resolvedApprovals[0];
    if (!approval) {
      throw new Error(`Approval not found: ${input.approvalId}`);
    }

    for (const resolved of resolvedApprovals) {
      const runId = resolved.runId ?? approval.runId;
      const rooms = [orgRoom(input.organizationId)];
      if (runId) {
        rooms.push(runRoom(runId));
      }
      const run = runId ? this.repo.getRun(input.organizationId, runId) : null;
      if (run?.threadId) {
        rooms.push(threadRoom(run.threadId));
      }
      this.realtime.emit(
        SocketEventNames.approvalResolved,
        { organizationId: input.organizationId, threadId: run?.threadId, approval: resolved },
        rooms,
      );
    }

    if (approval.status === 'rejected' && approval.runId) {
      for (const resolved of resolvedApprovals) {
        const run = resolved.runId ? this.repo.getRun(input.organizationId, resolved.runId) : null;
        if (!run || !resolved.toolCallId) continue;
        const threadId = run.threadId;
        const rooms = [orgRoom(input.organizationId), runRoom(run.id)];
        if (threadId) {
          rooms.push(threadRoom(threadId));
        }
        this.realtime.emit(
          SocketEventNames.toolResult,
          {
            organizationId: input.organizationId,
            runId: run.id,
            threadId,
            agentId: resolved.requestedBy,
            toolResult: {
              toolCallId: resolved.toolCallId,
              result: {
                error: 'Approval rejected by user',
                code: 'ERR_APPROVAL_REJECTED',
              },
              isError: true,
            },
          },
          rooms,
        );
        this.repo.deleteApproval(input.organizationId, resolved.id);
      }
      const run = this.repo.getRun(input.organizationId, approval.runId);
      if (run) {
        await this.resumeRun(approval.organizationId, approval.runId, false);
      }
    }

    if (approval.status === 'approved' && approval.runId) {
      await this.resumeRun(approval.organizationId, approval.runId);
    }

    return approval;
  }

  listPending(organizationId: string): ApprovalRequest[] {
    return this.repo.listPendingApprovals(organizationId);
  }
}

function decodeApprovalScope(reason: string): string | undefined {
  const scopeMatch = reason.match(/(?:^|[;:])scope=([^;]+)/);
  return scopeMatch?.[1] ? decodeURIComponent(scopeMatch[1]) : undefined;
}
