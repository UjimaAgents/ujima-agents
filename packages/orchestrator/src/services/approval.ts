import { randomUUID } from 'node:crypto';
import {
  ApprovalRequestSchema,
  SocketEventNames,
  approvalScopeMatches,
  approvalScopeMatchesPersisted,
  canonicalizeApprovalFamilyScope,
  canonicalizeApprovalGrantScope,
  formatPersistedApprovalGrantReason,
  orgRoom,
  parseApprovalReasonValue,
  runRoom,
  stripApprovalScopeDisplayFields,
  threadRoom,
  type ApprovalRequest,
  type ResourceType,
  type ToolAction,
} from '@ujima/shared';
import type { RealtimeService } from './context.js';
import type { ApiRepository } from './repository-reader.js';
import { isLiveStatus } from './live-status.js';

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
  resolution?: 'allow_once' | 'allow_always' | 'allow_family' | 'reject';
  reason?: string;
}

export type ResumeRun = (
  organizationId: string,
  runId: string,
  allowRun?: boolean,
  approvalScope?: string,
) => Promise<unknown> | unknown;

export class ApprovalService {
  constructor(
    private readonly repo: ApiRepository,
    private readonly realtime: RealtimeService,
    private readonly resumeRun: ResumeRun,
  ) {}

  requestApproval(input: ApprovalRequestInput): ApprovalRequest {
    const runForApproval = this.repo.getRun(input.organizationId, input.runId);
    const threadIdFromRun = runForApproval?.threadId;

    const requestedScope = input.approvalScope;
    const existing = requestedScope
      ? this.repo
          .listPendingApprovals(input.organizationId)
          .find(
            (approval) =>
              approval.runId === input.runId &&
              approval.requestedBy === input.requestedBy &&
              approval.resourceType === input.resourceType &&
              approval.action === input.action &&
              approvalScopeMatches(decodeApprovalScope(approval.reason) ?? '', requestedScope),
          )
      : undefined;

    if (existing) {
      if (!existing.toolCallId) {
        const updated = ApprovalRequestSchema.parse({
          ...existing,
          toolCallId: input.toolCallId,
          threadId: existing.threadId ?? threadIdFromRun,
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
      threadId: threadIdFromRun,
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
    const threadForRooms = approval.threadId ?? runForApproval?.threadId;
    if (threadForRooms) {
      rooms.push(threadRoom(threadForRooms));
    }
    this.realtime.emit(
      SocketEventNames.approvalRequested,
      { organizationId: input.organizationId, threadId: threadForRooms, approval },
      rooms,
    );

    return approval;
  }

  async resolveApproval(input: ApprovalResolveInput): Promise<ApprovalRequest> {
    const existing = this.repo.getApproval(input.organizationId, input.approvalId);
    const rawScope = existing?.reason ? parseApprovalReasonValue(existing.reason, 'scope') ?? undefined : undefined;
    const persistedScope =
      (input.resolution === 'allow_family'
        ? rawScope
          ? canonicalizeApprovalFamilyScope(rawScope)
          : fallbackApprovalScope(existing)
        : rawScope
          ? canonicalizeApprovalGrantScope(rawScope)
          : fallbackApprovalScope(existing)) ?? undefined;
    const canPersistGrant =
      (input.resolution === 'allow_always' || input.resolution === 'allow_family') &&
      !!persistedScope;
    const effectiveReason =
      input.status === 'rejected' && rawScope
        ? `reject:scope=${encodeURIComponent(rawScope)};note=${input.reason ?? ''}`
        : canPersistGrant && persistedScope
          ? formatPersistedApprovalGrantReason(
              input.resolution === 'allow_family' ? 'family' : 'grant',
              persistedScope,
              input.reason ?? '',
            )
          : input.reason;
    const matchingPendingApprovals =
      existing?.runId && input.status === 'rejected'
        ? this.repo
            .listPendingApprovals(input.organizationId)
            .filter((approval) => approval.runId === existing.runId)
        : existing
          ? this.repo
              .listPendingApprovals(input.organizationId)
              .filter((approval) =>
                pendingApprovalMatchesResolution({
                  approval,
                  existing,
                  persistedScope,
                  resolution: input.resolution,
                }),
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
        this.repo.deleteApproval(input.organizationId, resolved.id);
      }
      const run = this.repo.getRun(input.organizationId, approval.runId);
      if (run) {
        await this.resumeRun(approval.organizationId, approval.runId, false);
      }
    }

    if (approval.status === 'approved' && approval.runId) {
      if (canPersistGrant && existing && this.repo.saveGovernanceRule) {
        const mcpId = existing.resourceType === 'mcp' ? existing.resourcePath : existing.resourceType;
        const toolName = existing.action;
        this.repo.saveGovernanceRule({
          id: randomUUID(),
          organizationId: input.organizationId,
          agentId: existing.requestedBy,
          mcpId,
          toolName,
          state: 'allow',
          reason: input.reason ?? '',
          updatedBy: 'human',
        });
      }

      await this.resumeRun(
        approval.organizationId,
        approval.runId,
        true,
        input.resolution === 'allow_once' && rawScope
          ? stripApprovalScopeDisplayFields(rawScope)
          : undefined,
      );
    }

    return approval;
  }

  listPending(organizationId: string): ApprovalRequest[] {
    return this.repo
      .listPendingApprovals(organizationId)
      .filter((approval) => {
        const run = approval.runId ? this.repo.getRun(organizationId, approval.runId) : null;
        return !!run && isLiveStatus(run.status);
      });
  }
}

function decodeApprovalScope(reason: string): string | undefined {
  return parseApprovalReasonValue(reason, 'scope') ?? undefined;
}

function pendingApprovalMatchesResolution(input: {
  approval: ApprovalRequest;
  existing: ApprovalRequest;
  persistedScope: string | undefined;
  resolution: ApprovalResolveInput['resolution'];
}): boolean {
  const { approval, existing, persistedScope, resolution } = input;
  if (
    approval.runId !== existing.runId ||
    approval.resourceType !== existing.resourceType ||
    approval.action !== existing.action
  ) {
    return false;
  }

  const approvalScope = decodeApprovalScope(approval.reason);
  if (!approvalScope || !persistedScope) {
    return false;
  }
  return approvalScopeMatchesPersisted(
    approvalScope,
    persistedScope,
    resolution === 'allow_family' ? 'family' : 'grant',
  );
}

function fallbackApprovalScope(approval: ApprovalRequest | null | undefined): string | undefined {
  if (!approval) return undefined;
  if (!approval.resourcePath) return undefined;
  if (approval.resourceType === 'shell') {
    return canonicalizeApprovalGrantScope(`shell:${JSON.stringify({ cwd: approval.resourcePath })}`);
  }
  if (approval.action === 'write') {
    return canonicalizeApprovalGrantScope(
      `write:${JSON.stringify({ resourcePath: approval.resourcePath })}`,
    );
  }
  return canonicalizeApprovalGrantScope(
    `${approval.resourceType}:${approval.action}:${approval.resourcePath}`,
  );
}
