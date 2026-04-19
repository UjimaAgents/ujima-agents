import { randomUUID } from "node:crypto";
import { ApprovalRequestSchema, SocketEventNames, type ApprovalRequest } from "@ujima/shared";
import type { Repository } from "../repositories.ts";
import { orgRoom, runRoom, type RealtimeService } from "../realtime.ts";

export class ApprovalService {
  constructor(
    private readonly repo: Repository,
    private readonly realtime: RealtimeService,
    private readonly resumeRun: (organizationId: string, runId: string) => Promise<unknown> | unknown,
  ) {}

  requestApproval(input: {
    organizationId: string;
    runId: string;
    requestedBy: string;
    resourceType: "file" | "folder" | "shell" | "mcp" | "message";
    resourcePath: string;
    action: "read" | "write" | "execute" | "mcp" | "message";
    reason: string;
  }): ApprovalRequest {
    const approval = ApprovalRequestSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      runId: input.runId,
      requestedBy: input.requestedBy,
      resourceType: input.resourceType,
      resourcePath: input.resourcePath,
      action: input.action,
      status: "pending",
      reason: input.reason,
      createdAt: new Date().toISOString(),
    });

    this.repo.saveApproval(approval);
    this.realtime.emit(SocketEventNames.approvalRequested, { organizationId: input.organizationId, approval }, [
      orgRoom(input.organizationId),
      runRoom(input.runId),
    ]);

    return approval;
  }

  async resolveApproval(input: {
    organizationId: string;
    approvalId: string;
    status: "approved" | "rejected";
    reason?: string;
  }): Promise<ApprovalRequest> {
    const approval = this.repo.resolveApproval(
      input.organizationId,
      input.approvalId,
      input.status,
      input.reason,
    );

    if (!approval) {
      throw new Error(`Approval not found: ${input.approvalId}`);
    }

    this.realtime.emit(SocketEventNames.approvalResolved, { organizationId: input.organizationId, approval }, [
      orgRoom(input.organizationId),
      runRoom(approval.runId ?? approval.id),
    ]);

    if (approval.status === "approved" && approval.runId) {
      await this.resumeRun(approval.organizationId, approval.runId);
    }

    return approval;
  }
}
