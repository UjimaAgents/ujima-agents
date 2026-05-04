import { randomUUID } from "node:crypto";
import type { AgentTeamHandle } from "@ujima/framework";
import {
  SocketEventNames,
  memberRoom,
  runRoom,
  threadRoom,
  type AuditStatus,
} from "@ujima/shared";
import type { RealtimeService } from "./context.js";
import type { ConversationService } from "./conversation.js";
import { requireTeam } from "../utils/require-team.js";
import { checkToolPolicy } from "./policy.js";
import type { ApiRepository } from "./repository-reader.js";
import type { SupervisorTodoService } from "./supervisor-todo.js";
import type { TeamStore } from "./team-store.js";
import {
  ORCHESTRATOR_TOOLS,
  SUPERVISOR_TOOL_ALLOWLIST,
} from "../tools/index.js";
import type {
  ToolInvocationInput,
  ToolInvocationResult,
  ToolService,
} from "./tool-service.js";
import {
  ERR_PATH_ESCAPE,
  createMemberPathResolver,
  isPathEscapeError,
} from "./workspace-root.js";

export interface ApprovalRequester {
  requestApproval(input: {
    organizationId: string;
    runId: string;
    toolCallId: string;
    requestedBy: string;
    resourceType: ToolInvocationInput["resourceType"];
    resourcePath: string;
    action: ToolInvocationInput["action"];
    reason: string;
    approvalScope?: string;
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
    /**
     * Phase 2.B — optional supervisor.todo.* backing service. Tools tagged
     * `permissionMcpId: 'supervisor'` go through here. Optional so the
     * pre-Phase-2 wiring still constructs.
     */
    private readonly supervisorTodos?: SupervisorTodoService,
  ) {}

  allowRun(organizationId: string, runId: string): void {
    this.approvedRuns.add(this.runKey(organizationId, runId));
  }

  async invoke(invocation: ToolInvocationInput): Promise<ToolInvocationResult> {
    const member = this.repo.getMember(
      invocation.organizationId,
      invocation.memberId,
    );
    if (!member) {
      throw new Error(`Member not found: ${invocation.memberId}`);
    }

    // Phase 2.C.2 — runtime supervisor allowlist enforcement.
    //
    // SpiritService restricts the model palette when role==='supervisor',
    // but a forged or out-of-band invocation could still try to drive a
    // non-allowlisted tool from supervisor mode. Reject anything that
    // either:
    //   (a) is tagged spiritRole='supervisor' but is not in the
    //       allowlist — covers a supervisor turn somehow reaching a
    //       forbidden tool (filesystem, shell, etc.), and
    //   (b) is tagged permissionMcpId='supervisor' but is not in the
    //       allowlist — covers a tool that hardcodes the supervisor
    //       MCP id without being on the canonical list.
    //
    // (a) is the stronger signal. (b) is kept as defence in depth so a
    // mis-registered tool is still rejected even when no spirit role
    // tag is present.
    const supervisorTagged =
      invocation.spiritRole === "supervisor" ||
      invocation.permissionMcpId === "supervisor";
    if (
      supervisorTagged &&
      !SUPERVISOR_TOOL_ALLOWLIST.includes(
        invocation.toolId as (typeof SUPERVISOR_TOOL_ALLOWLIST)[number],
      )
    ) {
      const reason = `Tool "${invocation.toolId}" is not in SUPERVISOR_TOOL_ALLOWLIST`;
      const run = this.repo.getRun(invocation.organizationId, invocation.runId);
      const threadId = invocation.threadId ?? run?.threadId;
      const rooms = [
        runRoom(invocation.runId),
        memberRoom(invocation.memberId),
        ...(threadId ? [threadRoom(threadId)] : []),
      ];
      this.audit(invocation, "blocked", { reason });
      this.realtime.emit(
        SocketEventNames.toolResult,
        {
          organizationId: invocation.organizationId,
          runId: invocation.runId,
          threadId,
          agentId: invocation.memberId,
          toolResult: {
            toolCallId: invocation.toolCallId,
            result: { error: reason, code: "ERR_SUPERVISOR_ALLOWLIST" },
            isError: true,
          },
        },
        rooms,
      );
      return {
        ok: false,
        error: reason,
        output: { status: "blocked", reason, code: "ERR_SUPERVISOR_ALLOWLIST" },
      };
    }

    const rooms = this.getRooms(
      invocation.organizationId,
      invocation.runId,
      invocation.memberId,
    );
    const team = requireTeam(this.teamStore);
    let preparedInvocation: ToolInvocationInput;

    try {
      preparedInvocation = await this.prepareInvocation(
        invocation,
        member.roleName,
        team,
      );
    } catch (error) {
      const message = (error as Error).message;
      this.audit(invocation, "blocked", {
        error: message,
        code: isPathEscapeError(error) ? ERR_PATH_ESCAPE : undefined,
      });
      this.realtime.emit(
        SocketEventNames.toolResult,
        {
          organizationId: invocation.organizationId,
          runId: invocation.runId,
          threadId: invocation.threadId ?? this.repo.getRun(invocation.organizationId, invocation.runId)?.threadId,
          agentId: invocation.memberId,
          toolResult: {
            toolCallId: invocation.toolCallId,
            result: {
              error: message,
              ...(isPathEscapeError(error) ? { code: ERR_PATH_ESCAPE } : {}),
            },
            isError: true,
          },
        },
        rooms,
      );
      throw error;
    }

    this.realtime.emit(
      SocketEventNames.toolCalled,
      {
        organizationId: invocation.organizationId,
        runId: invocation.runId,
        threadId: invocation.threadId ?? this.repo.getRun(invocation.organizationId, invocation.runId)?.threadId,
        agentId: invocation.memberId,
        toolCall: {
          toolCallId: preparedInvocation.toolCallId,
          toolName: preparedInvocation.toolId,
          args: preparedInvocation.input,
        },
      },
      rooms,
    );

    const policy = checkToolPolicy(
      team,
      member.roleName,
      preparedInvocation.toolId,
      preparedInvocation.action,
      preparedInvocation.resourcePath,
      { spiritRole: preparedInvocation.spiritRole },
    );

    if (!policy.allowed) {
      this.audit(preparedInvocation, "blocked", { reason: policy.reason });
      const run = this.repo.getRun(preparedInvocation.organizationId, preparedInvocation.runId);
      const threadId = preparedInvocation.threadId ?? run?.threadId;

      this.realtime.emit(
        SocketEventNames.toolResult,
        {
          organizationId: invocation.organizationId,
          runId: preparedInvocation.runId,
          threadId,
          agentId: preparedInvocation.memberId,
          toolResult: {
            toolCallId: preparedInvocation.toolCallId,
            result: { error: policy.reason },
            isError: true,
          },
        },
        rooms,
      );

      return {
        ok: false,
        error: policy.reason,
        output: { status: "blocked", reason: policy.reason },
      };
    }

    const approvalScope = this.buildApprovalScope(preparedInvocation);

    if (
      policy.requiresApproval &&
      !this.consumeApprovedRun(invocation.organizationId, invocation.runId) &&
      !this.repo.hasApprovalGrant({
        organizationId: preparedInvocation.organizationId,
        requestedBy: preparedInvocation.memberId,
        resourceType: preparedInvocation.resourceType,
        resourcePath: preparedInvocation.resourcePath ?? "",
        action: preparedInvocation.action,
        approvalScope,
      })
    ) {
      const approval = this.approvals.requestApproval({
        organizationId: preparedInvocation.organizationId,
        runId: preparedInvocation.runId,
        toolCallId: preparedInvocation.toolCallId,
        requestedBy: preparedInvocation.memberId,
        resourceType: preparedInvocation.resourceType,
        resourcePath: preparedInvocation.resourcePath ?? "",
        action: preparedInvocation.action,
        reason: `Tool action requires approval;scope=${encodeURIComponent(approvalScope)}`,
        approvalScope,
      });

      this.audit(preparedInvocation, "ok", {
        approvalId: approval.id,
        status: "pending_approval",
      });

      const run = this.repo.getRun(preparedInvocation.organizationId, preparedInvocation.runId);
      const threadId = preparedInvocation.threadId ?? run?.threadId;

      this.realtime.emit(
        SocketEventNames.toolResult,
        {
          organizationId: preparedInvocation.organizationId,
          runId: preparedInvocation.runId,
          threadId,
          agentId: preparedInvocation.memberId,
          toolResult: {
            toolCallId: preparedInvocation.toolCallId,
            result: { status: "waiting_for_approval" },
            isError: false,
          },
        },
        rooms,
      );

      return {
        ok: false,
        requiresApprovalId: approval.id,
        output: { status: "waiting_for_approval", approvalId: approval.id },
      };
    }

    try {
      const result = await this.executeTool(preparedInvocation);
      this.audit(preparedInvocation, "ok", { status: "completed" });
      const run = this.repo.getRun(preparedInvocation.organizationId, preparedInvocation.runId);
      const threadId = preparedInvocation.threadId ?? run?.threadId;

      this.realtime.emit(
        SocketEventNames.toolResult,
        {
          organizationId: preparedInvocation.organizationId,
          runId: preparedInvocation.runId,
          threadId,
          agentId: preparedInvocation.memberId,
          toolResult: {
            toolCallId: preparedInvocation.toolCallId,
            result,
            isError: false,
          },
        },
        rooms,
      );

      return { ok: true, output: { status: "completed", result } };
    } catch (error) {
      const message = (error as Error).message;
      this.audit(preparedInvocation, "error", {
        error: message,
        code: isPathEscapeError(error) ? ERR_PATH_ESCAPE : undefined,
      });
      const run = this.repo.getRun(preparedInvocation.organizationId, preparedInvocation.runId);
      const threadId = preparedInvocation.threadId ?? run?.threadId;

      this.realtime.emit(
        SocketEventNames.toolResult,
        {
          organizationId: preparedInvocation.organizationId,
          runId: preparedInvocation.runId,
          threadId,
          agentId: preparedInvocation.memberId,
          toolResult: {
            toolCallId: preparedInvocation.toolCallId,
            result: {
              error: message,
              ...(isPathEscapeError(error) ? { code: ERR_PATH_ESCAPE } : {}),
            },
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
        team: requireTeam(this.teamStore),
        repo: this.repo,
        conversations: this.conversations,
        supervisorTodos: this.supervisorTodos,
      });
    }

    if (invocation.toolId === "mcp") {
      throw new Error(
        "MCP proxying is not yet implemented in the local runtime",
      );
    }

    throw new Error(
      `Tool "${invocation.toolId}" action "${invocation.action}" is not implemented`,
    );
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

  private getRooms(
    organizationId: string,
    runId: string,
    memberId: string,
  ): string[] {
    const rooms = [runRoom(runId), memberRoom(memberId)];
    const run = this.repo.getRun(organizationId, runId);
    if (run?.threadId) {
      rooms.push(threadRoom(run.threadId));
    }
    return rooms;
  }

  private buildApprovalScope(invocation: ToolInvocationInput): string {
    if (invocation.toolId === "shell") {
      const input = invocation.input ?? {};
      const command = typeof input.command === "string" ? input.command : "";
      const cwd = typeof input.cwd === "string" ? input.cwd : invocation.resourcePath ?? "";
      return `shell:${JSON.stringify({ cwd, command })}`;
    }
    return `${invocation.toolId}:${invocation.action}:${invocation.resourcePath ?? ""}`;
  }

  private async prepareInvocation(
    invocation: ToolInvocationInput,
    roleName: string,
    team: AgentTeamHandle,
  ): Promise<ToolInvocationInput> {
    if (invocation.toolId !== "filesystem" && invocation.toolId !== "shell") {
      return invocation;
    }

    const resolver = await createMemberPathResolver(
      this.repo,
      team,
      invocation.organizationId,
      invocation.memberId,
      roleName,
    );

    if (invocation.toolId === "filesystem") {
      if (!invocation.resourcePath) {
        return invocation;
      }
      return {
        ...invocation,
        resourcePath: await resolver.resolve(invocation.resourcePath),
      };
    }

    const input = invocation.input ?? {};
    const command = typeof input.command === "string" ? input.command : "";
    const requestedCwd =
      typeof input.cwd === "string"
        ? input.cwd
        : (invocation.resourcePath ?? resolver.scopePaths[0] ?? ".");
    const resolvedCwd = await resolver.resolve(requestedCwd);

    return {
      ...invocation,
      resourcePath: resolvedCwd,
      input: {
        ...input,
        cwd: resolvedCwd,
        command,
      },
    };
  }
}
