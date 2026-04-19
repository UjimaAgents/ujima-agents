import { randomUUID } from "node:crypto";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { AgentTeamHandle } from "@ujima/framework";
import { assertWorkspaceBoundary, SocketEventNames, type AuditStatus, type ResourceType, type ToolAction } from "@ujima/shared";
import { checkToolPolicy } from "../policy.ts";
import type { Repository } from "../repositories.ts";
import { ApprovalService } from "./approval.service.ts";
import { ConversationService } from "./conversation.service.ts";
import { memberRoom, runRoom, type RealtimeService } from "../realtime.ts";

export interface ToolInvocation {
  organizationId: string;
  runId: string;
  memberId: string;
  toolCallId: string;
  toolId: string;
  action: ToolAction;
  resourceType: ResourceType;
  resourcePath?: string;
  threadId: string;
  input: Record<string, unknown>;
}

export type ToolInvocationResult =
  | { status: "blocked"; reason: string }
  | { status: "waiting_for_approval"; approvalId: string }
  | { status: "completed"; result: unknown };

export class ToolService {
  private readonly approvedRuns = new Set<string>();

  constructor(
    private readonly team: AgentTeamHandle | null,
    private readonly repo: Repository,
    private readonly approvals: ApprovalService,
    private readonly conversations: ConversationService,
    private readonly realtime: RealtimeService,
  ) {}

  allowRun(organizationId: string, runId: string) {
    this.approvedRuns.add(this.runKey(organizationId, runId));
  }

  async invoke(invocation: ToolInvocation) {
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
      this.audit(invocation, "blocked", { reason: policy.reason });

      this.realtime.emit(SocketEventNames.toolResult, {
        organizationId: invocation.organizationId,
        runId: invocation.runId,
        agentId: invocation.memberId,
        toolResult: { toolCallId: invocation.toolCallId, result: { error: policy.reason }, isError: true },
      }, rooms);

      return { status: "blocked", reason: policy.reason };
    }

    if (policy.requiresApproval && !this.consumeApprovedRun(invocation.organizationId, invocation.runId)) {
      const approval = this.approvals.requestApproval({
        organizationId: invocation.organizationId,
        runId: invocation.runId,
        requestedBy: invocation.memberId,
        resourceType: invocation.resourceType,
        resourcePath: invocation.resourcePath ?? "",
        action: invocation.action,
        reason: "Tool action requires approval",
      });

      this.audit(invocation, "ok", { approvalId: approval.id, status: "pending_approval" });

      this.realtime.emit(SocketEventNames.toolResult, {
        organizationId: invocation.organizationId,
        runId: invocation.runId,
        agentId: invocation.memberId,
        toolResult: { toolCallId: invocation.toolCallId, result: { status: "waiting_for_approval" }, isError: false },
      }, rooms);

      return { status: "waiting_for_approval", approvalId: approval.id };
    }

    try {
      const result = await this.executeTool(invocation);
      this.audit(invocation, "ok", { status: "completed" });

      this.realtime.emit(SocketEventNames.toolResult, {
        organizationId: invocation.organizationId,
        runId: invocation.runId,
        agentId: invocation.memberId,
        toolResult: { toolCallId: invocation.toolCallId, result, isError: false },
      }, rooms);

      return { status: "completed", result };
    } catch (error) {
      this.audit(invocation, "error", { error: (error as Error).message });

      this.realtime.emit(SocketEventNames.toolResult, {
        organizationId: invocation.organizationId,
        runId: invocation.runId,
        agentId: invocation.memberId,
        toolResult: { toolCallId: invocation.toolCallId, result: { error: (error as Error).message }, isError: true },
      }, rooms);

      throw error;
    }
  }

  private async executeTool(invocation: ToolInvocation) {
    if (invocation.toolId === "filesystem") {
      if (invocation.action === "read") {
        return this.readFilesystemResource(invocation);
      }
      if (invocation.action === "write") {
        return this.writeFilesystemResource(invocation);
      }
    }

    if (invocation.toolId === "shell") {
      return this.executeShell(invocation);
    }

    if (invocation.toolId === "mcp") {
      throw new Error("MCP proxying is not yet implemented in the local runtime");
    }

    if (invocation.toolId === "message") {
      return this.sendMessage(invocation);
    }

    throw new Error(`Tool "${invocation.toolId}" action "${invocation.action}" is not implemented`);
  }

  private sendMessage(invocation: ToolInvocation) {
    const destination = invocation.input?.destination as string | undefined;
    const content = invocation.input?.content as string | undefined;
    const mentions = Array.isArray(invocation.input?.mentions)
      ? invocation.input.mentions.filter((mention): mention is string => typeof mention === "string")
      : [];

    if (typeof destination !== "string") {
      throw new Error("Input 'destination' must be a string");
    }

    if (typeof content !== "string") {
      throw new Error("Input 'content' must be a string");
    }

    if (destination === "thread") {
      return this.conversations.sendMessage({
        organizationId: invocation.organizationId,
        threadId: invocation.threadId,
        senderId: invocation.memberId,
        content,
        mentions,
      });
    }

    if (destination === "channel") {
      const channelId = invocation.input?.channelId as string | undefined;
      if (typeof channelId !== "string") {
        throw new Error("Input 'channelId' must be a string");
      }

      return this.conversations.sendMessage({
        organizationId: invocation.organizationId,
        threadId: invocation.threadId,
        channelId,
        senderId: invocation.memberId,
        content,
        mentions,
      });
    }

    if (destination === "dm") {
      const recipientId = invocation.input?.recipientId as string | undefined;
      if (typeof recipientId !== "string") {
        throw new Error("Input 'recipientId' must be a string");
      }

      return this.conversations.sendDirectMessage({
        organizationId: invocation.organizationId,
        senderId: invocation.memberId,
        recipientId,
        content,
        mentions,
      });
    }

    throw new Error(`Unknown message destination "${destination}"`);
  }

  private async readFilesystemResource(invocation: ToolInvocation) {
    if (!invocation.resourcePath) {
      throw new Error("resourcePath is required");
    }

    const path = assertWorkspaceBoundary(this.requireTeam().workspace.root, invocation.resourcePath);
    const resource = await stat(path);

    if (resource.isDirectory()) {
      const entries = await readdir(path);
      return {
        type: "folder",
        path,
        entries,
      };
    }

    return {
      type: "file",
      path,
      content: await readFile(path, "utf8"),
    };
  }

  private async writeFilesystemResource(invocation: ToolInvocation) {
    if (!invocation.resourcePath) {
      throw new Error("resourcePath is required");
    }

    const path = assertWorkspaceBoundary(this.requireTeam().workspace.root, invocation.resourcePath);
    const content = invocation.input?.content as string | undefined;

    if (typeof content !== "string") {
      throw new Error("Input 'content' must be a string");
    }

    await writeFile(path, content, "utf8");
    return { success: true, path };
  }

  private async executeShell(invocation: ToolInvocation) {
    const command = invocation.input?.command as string | undefined;
    const args = Array.isArray(invocation.input?.args)
      ? invocation.input.args.filter((arg): arg is string => typeof arg === "string")
      : [];

    if (typeof command !== "string") {
      throw new Error("Input 'command' must be a string");
    }

    return this.runProcess(command, args);
  }

  private async runProcess(command: string, args: string[]) {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: this.requireTeam().workspace.root,
        shell: false,
      });

      // Type workaround: bun-types sometimes conflicts with @types/node EventEmitter typings
      const proc = child as any;

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (chunk: any) => {
        stdout += chunk.toString();
      });

      proc.stderr.on("data", (chunk: any) => {
        stderr += chunk.toString();
      });

      proc.on("error", (error: any) => {
        reject(error);
      });

      proc.on("close", (code: number) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `Command "${command}" exited with code ${code}`));
          return;
        }

        resolve({ stdout, stderr });
      });
    });
  }

  private requireTeam() {
    if (!this.team) {
      throw new Error("Team config not loaded");
    }

    return this.team;
  }

  private consumeApprovedRun(organizationId: string, runId: string) {
    const key = this.runKey(organizationId, runId);
    if (!this.approvedRuns.has(key)) {
      return false;
    }

    this.approvedRuns.delete(key);
    return true;
  }

  private runKey(organizationId: string, runId: string) {
    return `${organizationId}:${runId}`;
  }

  private audit(invocation: ToolInvocation, status: AuditStatus, metadata: Record<string, unknown>) {
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
