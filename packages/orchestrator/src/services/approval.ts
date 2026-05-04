import { randomUUID } from 'node:crypto';
import {
  ApprovalRequestSchema,
  MessageSchema,
  SocketEventNames,
  orgRoom,
  runRoom,
  threadRoom,
  type ApprovalRequest,
  type Message,
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

    if (existing) return existing;

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
    const resolvedApprovals = approvals
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
      const rooms = [orgRoom(input.organizationId), runRoom(resolved.runId ?? resolved.id)];
      const run = resolved.runId ? this.repo.getRun(input.organizationId, resolved.runId) : null;
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
      const run = this.repo.getRun(input.organizationId, approval.runId);
      if (run) {
        const rejectionMessage = buildRejectionMessage(input.organizationId, approval, run.threadId);
        if (rejectionMessage) {
          this.repo.saveMessage(rejectionMessage);
          this.realtime.emit(
            SocketEventNames.threadMessage,
            { organizationId: input.organizationId, threadId: rejectionMessage.threadId, message: rejectionMessage },
            [orgRoom(input.organizationId), runRoom(run.id), threadRoom(rejectionMessage.threadId)],
          );
        }

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

function buildRejectionMessage(
  organizationId: string,
  approval: ApprovalRequest,
  threadId?: string,
): Message | null {
  if (!threadId) return null;

  const scope = decodeApprovalScope(approval.reason);
  const content = scope
    ? formatApprovalRejection(scope, approval)
    : `Approval rejected for ${approval.resourceType} ${approval.resourcePath}.`;

  return MessageSchema.parse({
    id: randomUUID(),
    organizationId,
    threadId,
    senderId: 'system',
    senderKind: 'human',
    kind: 'system',
    content,
    createdAt: new Date().toISOString(),
  });
}

function formatApprovalRejection(scope: string, approval: ApprovalRequest): string {
  if (!scope.startsWith('shell:')) {
    return `Approval rejected for ${approval.resourceType} ${approval.resourcePath}.`;
  }

  const parsed = parseShellScope(scope);
  if (!parsed) {
    return `Approval rejected for shell command in ${approval.resourcePath}.`;
  }

  return `Approval rejected. The command was not approved:\n$ ${parsed.command}\nDirectory: ${parsed.cwd}`;
}

function parseShellScope(scope: string): { cwd: string; command: string } | null {
  const withoutPrefix = scope.slice('shell:'.length);
  if (!withoutPrefix) return null;
  try {
    const parsed = JSON.parse(withoutPrefix) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as { cwd?: unknown }).cwd !== 'string' ||
      typeof (parsed as { command?: unknown }).command !== 'string'
    ) {
      return null;
    }
    return {
      cwd: (parsed as { cwd: string }).cwd,
      command: (parsed as { command: string }).command,
    };
  } catch {
    return null;
  }
}
