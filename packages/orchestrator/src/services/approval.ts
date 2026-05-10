import { randomUUID } from 'node:crypto';
import {
  ApprovalRequestSchema,
  SocketEventNames,
  formatApprovalRelayMarkdown,
  orgRoom,
  runRoom,
  threadRoom,
  getDirectMessageThreadId,
  type ApprovalRequest,
  type ResourceType,
  type ToolAction,
} from '@ujima/shared';
import type { RealtimeService } from './context.js';
import type { ApiRepository } from './repository-reader.js';
import type { ConversationService } from './conversation.js';

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
    private readonly conversations: ConversationService,
    private readonly resumeRun: ResumeRun,
  ) {}

  requestApproval(input: ApprovalRequestInput): ApprovalRequest {
    const runForApproval = this.repo.getRun(input.organizationId, input.runId);
    const threadIdFromRun = runForApproval?.threadId;

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
    void this.relayApprovalToOwner(approval);
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
    const scopeMatch = existing?.reason.match(/(?:^|[;:])scope=([^;]+)/);
    // The scope in the reason is stored URL-encoded by ToolServiceImpl. We decode
    // it here so we have the raw scope, then re-encode it when building the
    // permanent grant reason string. This ensures consistency with how
    // hasApprovalGrant searches for the record.
    const rawScope = scopeMatch && scopeMatch[1] ? decodeURIComponent(scopeMatch[1]) : undefined;
    const canPersistGrant =
      (input.resolution === 'allow_always' || input.resolution === 'allow_family') &&
      !!rawScope;
    const persistedScope =
      input.resolution === 'allow_family' && rawScope ? buildFamilyApprovalScope(rawScope) : rawScope;
    const effectiveReason =
      input.status === 'rejected' && rawScope
        ? `reject:scope=${encodeURIComponent(rawScope)};note=${input.reason ?? ''}`
        : canPersistGrant && persistedScope
          ? `grant:always_allow:scope=${encodeURIComponent(persistedScope)};note=${input.reason ?? ''}`
          : input.reason;
    const matchingPendingApprovals =
      existing?.runId && input.status === 'rejected'
        ? this.repo
            .listPendingApprovals(input.organizationId)
            .filter((approval) => approval.runId === existing.runId)
        : existing && rawScope
          ? this.repo
              .listPendingApprovals(input.organizationId)
              .filter((approval) =>
                pendingApprovalMatchesResolution({
                  approval,
                  existing,
                  rawScope,
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

      const ownerRelayThreadId = this.getOwnerRelayThreadId(input.organizationId, resolved.requestedBy);
      if (ownerRelayThreadId) {
        const ownerRooms = [orgRoom(input.organizationId), threadRoom(ownerRelayThreadId)];
        if (runId) {
          ownerRooms.push(runRoom(runId));
        }
        this.realtime.emit(
          SocketEventNames.approvalResolved,
          { organizationId: input.organizationId, threadId: ownerRelayThreadId, approval: resolved },
          ownerRooms,
        );
      }
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
      await this.resumeRun(
        approval.organizationId,
        approval.runId,
        true,
        input.resolution === 'allow_once' ? rawScope : undefined,
      );
    }

    return approval;
  }

  listPending(organizationId: string): ApprovalRequest[] {
    return this.repo
      .listPendingApprovals(organizationId)
      .filter((approval) => {
        const run = approval.runId ? this.repo.getRun(organizationId, approval.runId) : null;
        return !!run && isActiveRunStatus(run.status);
      });
  }

  private async relayApprovalToOwner(approval: ApprovalRequest): Promise<void> {
    const owner = this.getOwnerMember(approval.organizationId);
    if (!owner || owner.id === approval.requestedBy) return;

    try {
      const relay = buildApprovalRelayMessage(approval);
      const message = this.conversations.sendDirectMessage({
        organizationId: approval.organizationId,
        senderId: approval.requestedBy,
        recipientId: owner.id,
        content: relay,
        ignore: true,
      });
      const rooms = [orgRoom(approval.organizationId), threadRoom(message.threadId)];
      this.realtime.emit(
        SocketEventNames.approvalRequested,
        { organizationId: approval.organizationId, threadId: message.threadId, approval },
        rooms,
      );
    } catch (error) {
      console.warn('Failed to relay approval to owner', {
        organizationId: approval.organizationId,
        approvalId: approval.id,
        error,
      });
    }
  }

  private getOwnerRelayThreadId(organizationId: string, requestedBy: string): string | null {
    const owner = this.getOwnerMember(organizationId);
    if (!owner || owner.id === requestedBy) return null;
    return getDirectMessageThreadId(owner.id, requestedBy);
  }

  private getOwnerMember(organizationId: string) {
    return this.repo
      .listMembers(organizationId)
      .find((member) => member.kind === 'human' && member.roleName === 'owner');
  }
}

function decodeApprovalScope(reason: string): string | undefined {
  const scopeMatch = reason.match(/(?:^|[;:])scope=([^;]+)/);
  return scopeMatch?.[1] ? decodeURIComponent(scopeMatch[1]) : undefined;
}

function buildFamilyApprovalScope(rawScope: string): string {
  if (!rawScope.startsWith('shell:')) return rawScope;
  try {
    const parsed = JSON.parse(rawScope.slice('shell:'.length)) as {
      cwd?: unknown;
      command?: unknown;
    };
    if (typeof parsed?.cwd !== 'string' || typeof parsed?.command !== 'string') {
      return rawScope;
    }
    return `shell:${JSON.stringify({ cwd: parsed.cwd, command: parsed.command })}`;
  } catch {
    return rawScope;
  }
}

function pendingApprovalMatchesResolution(input: {
  approval: ApprovalRequest;
  existing: ApprovalRequest;
  rawScope: string;
  persistedScope: string | undefined;
  resolution: ApprovalResolveInput['resolution'];
}): boolean {
  const { approval, existing, rawScope, persistedScope, resolution } = input;
  if (
    approval.runId !== existing.runId ||
    approval.requestedBy !== existing.requestedBy ||
    approval.resourceType !== existing.resourceType ||
    approval.resourcePath !== existing.resourcePath ||
    approval.action !== existing.action
  ) {
    return false;
  }

  const approvalScope = decodeApprovalScope(approval.reason);
  if (resolution === 'allow_family' && persistedScope) {
    return approvalScope ? buildFamilyApprovalScope(approvalScope) === persistedScope : false;
  }
  return approvalScope === rawScope;
}

function buildApprovalRelayMessage(approval: ApprovalRequest): string {
  return formatApprovalRelayMarkdown(approval);
}

function isActiveRunStatus(status: string): boolean {
  return status === 'queued' || status === 'running' || status === 'waiting_for_approval';
}
