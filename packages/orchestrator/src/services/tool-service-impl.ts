import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { AgentTeamHandle } from "@ujima/framework";
import {
  SocketEventNames,
  classifyTool,
  evaluatePolicy,
  memberRoom,
  normalizeOrgShellApprovalMode,
  resolveClassification,
  resolveEffectiveShellApprovalMode,
  runRoom,
  threadRoom,
  type AuditStatus,
  type Member,
  type SpiritRole,
  type WakeReason,
} from "@ujima/shared";
import type { RealtimeService } from "./context.js";
import type { ConversationService } from "./conversation.js";
import type { GoalSystemService } from "./goal-system.js";
import { requireTeam } from "../utils/require-team.js";
import { checkToolPolicy } from "./policy.js";
import { isToolApprovalSatisfied } from "./tool-approval-gate.js";
import type { ApiRepository } from "./repository-reader.js";
import type { TeamStore } from "./team-store.js";
import {
  ORCHESTRATOR_TOOLS,
  SUPERVISOR_TOOL_ALLOWLIST,
} from "../tools/index.js";
import {
  approvalWaitResult,
  buildToolApprovalScope,
  enrichToolApprovalScopeForRequest,
  type ToolInvocationInput,
  type ToolInvocationResult,
  type ToolService,
} from "./tool-service.js";
import {
  ERR_PATH_ESCAPE,
  createMemberBoundaryPathResolver,
  isPathEscapeError,
  type PathEscapeError,
} from "./workspace-root.js";
import { pathEscapeToolResult } from "./tool-service.js";
import { isGoalModeActiveForThread } from "./goal-mode-prompt.js";
import { normalizeShellScope } from "./shell-scope.js";
import type { ModelResolver } from "./spirit-types.js";
import { ShellAutoReviewService } from "./shell-auto-review.js";
import { materializeMcpDef, type McpRuntimePool } from "./mcp-runtime.js";
import { ApprovedRunScopeTracker } from "../utils/approved-run-scopes.js";
import { formatReadableToolOutput } from "../utils/tool-output.js";
import { isPathScopedToolId, usesPathResolution } from "../path-scoped-tools.js";

/** Merge top-level invocation fields into `input` for client / reasoning-trace payloads. */
function toolCallArgsForClient(inv: ToolInvocationInput): Record<string, unknown> {
  return {
    ...inv.input,
    action: inv.action,
    resourceType: inv.resourceType,
    ...(inv.resourcePath !== undefined ? { resourcePath: inv.resourcePath } : {}),
  };
}

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
  }): { id: string; toolCallId?: string };
}

export class ToolServiceImpl implements ToolService {
  private readonly approvedRunScopes = new ApprovedRunScopeTracker();

  constructor(
    private readonly teamStore: TeamStore,
    private readonly repo: ApiRepository,
    private readonly approvals: ApprovalRequester,
    private readonly conversations: ConversationService,
    private readonly goals: GoalSystemService,
    private readonly realtime: RealtimeService,
    private readonly mcpPool?: McpRuntimePool,
    private readonly modelResolver?: ModelResolver,
    private readonly shellAutoReview = new ShellAutoReviewService(),
  ) {}

  allowRun(organizationId: string, runId: string, approvalScope?: string): void {
    this.approvedRunScopes.allowRun(organizationId, runId, approvalScope);
  }

  async invoke(invocation: ToolInvocationInput): Promise<ToolInvocationResult> {
    const run = this.repo.getRun(invocation.organizationId, invocation.runId);
    if (run && (run.status === "failed" || run.status === "cancelled")) {
      return {
        ok: false,
        error: "Run is no longer active",
        output: { status: "blocked", reason: "Run is no longer active" },
      };
    }

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
      invocation.toolId !== "mcp" &&
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
      this.saveRunStep(invocation, "blocked", {
        status: "blocked",
        reason,
        code: "ERR_SUPERVISOR_ALLOWLIST",
      });
      this.emitToolCalled(invocation, rooms);
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
    const team = requireTeam(this.teamStore, invocation.organizationId);
    let preparedInvocation: ToolInvocationInput;

    try {
      preparedInvocation = await this.prepareInvocation(
        invocation,
        member.roleName,
        team,
      );
    } catch (error) {
      if (isPathEscapeError(error)) {
        return this.finishPathEscapeFailure(invocation, rooms, error);
      }
      throw error;
    }

    this.emitToolCalled(preparedInvocation, rooms);

    const isSubOperation =
      preparedInvocation.toolId === "shell" &&
      preparedInvocation.input?.operation &&
      preparedInvocation.input.operation !== "execute";

    // Resolve wakeReason: prefer the value the caller passed in on
    // the invocation (the spirit-supervisor path threads it directly);
    // otherwise read it from the persisted run row. Either way it
    // flows into checkToolPolicy so the mandatory-reply gate fires.
    const wakeReason: WakeReason | null | undefined =
      preparedInvocation.wakeReason ??
      (run?.wakeReason as WakeReason | null | undefined);
    const threadId = preparedInvocation.threadId ?? run?.threadId;
    const goalModeActive = isGoalModeActiveForThread(
      this.repo,
      preparedInvocation.organizationId,
      threadId,
    );
    const effectiveShellApprovalMode = resolveEffectiveShellApprovalMode({
      orgMode: normalizeOrgShellApprovalMode(team.config.policies),
      memberMode: member.shellApprovalMode,
      goalModeActive,
    });

    const policy = isSubOperation
      ? { allowed: true, requiresApproval: false, shellAutoReview: false, reason: "sub-operation" }
      : preparedInvocation.toolId === "mcp"
        ? this.resolveMcpPolicy(preparedInvocation)
      : checkToolPolicy(
          team,
          member.roleName,
          preparedInvocation.toolId,
          preparedInvocation.action,
          preparedInvocation.resourcePath,
          {
            spiritRole: preparedInvocation.spiritRole,
            wakeReason,
            threadId,
            effectiveShellApprovalMode,
          },
        );

    if (!policy.allowed) {
      this.audit(preparedInvocation, "blocked", { reason: policy.reason });
      this.saveRunStep(preparedInvocation, "blocked", {
        status: "blocked",
        reason: policy.reason,
      });

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

    const approvalScope = buildToolApprovalScope(preparedInvocation);

    if (
      !isToolApprovalSatisfied({
        policy,
        organizationId: invocation.organizationId,
        runId: invocation.runId,
        approvalScope,
        approvedRunScopes: this.approvedRunScopes,
        repo: this.repo,
        invocation: preparedInvocation,
      })
    ) {
      if (policy.shellAutoReview) {
        await this.tryAutoReviewShell({
          invocation: preparedInvocation,
          member,
          teamRoleName: member.roleName,
          approvalScope,
          spiritRole: preparedInvocation.spiritRole ?? "worker",
        });
      }

      if (
        !isToolApprovalSatisfied({
          policy,
          organizationId: invocation.organizationId,
          runId: invocation.runId,
          approvalScope,
          approvedRunScopes: this.approvedRunScopes,
          repo: this.repo,
          invocation: preparedInvocation,
        })
      ) {
        return this.requestHumanApproval(preparedInvocation, approvalScope);
      }
    }

    try {
      const result = await this.executeTool(preparedInvocation);
      const output = summarizeToolOutput(result);
      this.audit(preparedInvocation, "ok", { status: "completed" });
      this.saveRunStep(preparedInvocation, "ok", output);
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

      if (isWaitingForInputResult(result)) {
        const waitingRun = this.repo.getRun(preparedInvocation.organizationId, preparedInvocation.runId);
        if (waitingRun) {
          this.realtime.emit(
            SocketEventNames.runUpdated,
            { organizationId: preparedInvocation.organizationId, run: waitingRun },
            rooms,
          );
        }
        return { ok: true, output: result };
      }

      return { ok: true, output: { status: "completed", result } };
    } catch (error) {
      if (isPathEscapeError(error)) {
        return this.finishPathEscapeFailure(preparedInvocation, rooms, error);
      }
      throw error;
    }
  }

  private finishPathEscapeFailure(
    invocation: ToolInvocationInput,
    rooms: string[],
    error: PathEscapeError,
  ): ToolInvocationResult {
    const result = pathEscapeToolResult(error.message);
    this.audit(invocation, "blocked", {
      error: error.message,
      code: ERR_PATH_ESCAPE,
    });
    this.saveRunStep(invocation, "blocked", result.output);
    this.emitToolCalled(invocation, rooms);
    const run = this.repo.getRun(invocation.organizationId, invocation.runId);
    const threadId = invocation.threadId ?? run?.threadId;
    this.realtime.emit(
      SocketEventNames.toolResult,
      {
        organizationId: invocation.organizationId,
        runId: invocation.runId,
        threadId,
        agentId: invocation.memberId,
        toolResult: {
          toolCallId: invocation.toolCallId,
          result: result.output,
          isError: true,
        },
      },
      rooms,
    );
    return result;
  }

  private async executeTool(invocation: ToolInvocationInput): Promise<unknown> {
    const tool = ORCHESTRATOR_TOOLS[invocation.toolId];

    if (tool) {
      return tool.execute({
        invocation,
        team: requireTeam(this.teamStore, invocation.organizationId),
        repo: this.repo,
        conversations: this.conversations,
        goals: this.goals,
        reportProgress: (output) => this.emitToolProgress(invocation, output),
      });
    }

    if (invocation.toolId === "mcp") {
      return this.executeMcpTool(invocation);
    }

    throw new Error(
      `Tool "${invocation.toolId}" action "${invocation.action}" is not implemented`,
    );
  }

  // Evaluate the governance policy + classification for an MCP call.
  // `inherit` preserves the pre-governance default of "require approval".
  private resolveMcpPolicy(invocation: ToolInvocationInput): {
    allowed: boolean;
    requiresApproval: boolean;
    shellAutoReview: boolean;
    reason?: string;
  } {
    const serverId =
      invocation.permissionMcpId ?? readString(invocation.input, "mcpServerId");
    const rawToolName =
      readString(invocation.input, "toolName") ??
      (invocation.permissionToolName?.startsWith("mcp:")
        ? undefined
        : invocation.permissionToolName);
    if (!serverId || !rawToolName) {
      return {
        allowed: false,
        requiresApproval: false,
        shellAutoReview: false,
        reason: "MCP invocation missing serverId or toolName",
      };
    }

    const policy = this.repo.getGovernancePolicy(invocation.organizationId);
    const stored = this.repo.getMcpToolClassification(
      invocation.organizationId,
      serverId,
      rawToolName,
    );
    // Inferred fallback for tools that reached us via a live MCP
    // listTools but haven't been seeded into the classifications
    // table yet (no Test run, or first-seen tool surfaced
    // dynamically). Only classify when we have a real cache
    // descriptor — without one the heuristic falls through to its
    // "no signal" default ('write') and the policy would fire the
    // wrong bucket for a tool the system has literally never seen.
    // When no descriptor exists, leave `inferred` undefined so
    // evaluatePolicy hits the `unknown` bucket and the catalog +
    // runtime decisions agree.
    let inferred: ReturnType<typeof classifyTool>["risk"] | undefined;
    if (!stored) {
      const cache = this.repo.getMcpToolCache(invocation.organizationId, serverId);
      const descriptor = cache?.tools.find((t) => t.name === rawToolName);
      if (descriptor) {
        const server = this.repo.getMcpServer(invocation.organizationId, serverId);
        const inf = classifyTool({
          name: rawToolName,
          description: descriptor.description,
          category: server?.category,
          declaredDestructive: descriptor.destructive,
        });
        inferred = inf.risk;
      }
    }
    const effective = resolveClassification(stored, inferred);
    const evaluation = evaluatePolicy(policy, {
      agentId: invocation.memberId,
      mcpId: serverId,
      toolName: rawToolName,
      classification: effective.risk,
    });

    switch (evaluation.state) {
      case "deny":
        return {
          allowed: false,
          requiresApproval: false,
          shellAutoReview: false,
          reason:
            evaluation.reason ??
            `Tool "${rawToolName}" denied by governance policy`,
        };
      case "allow":
        return { allowed: true, requiresApproval: false, shellAutoReview: false, reason: evaluation.reason };
      case "require_approval":
      case "require_input":
        return { allowed: true, requiresApproval: true, shellAutoReview: false, reason: evaluation.reason };
      case "inherit":
      default:
        return { allowed: true, requiresApproval: true, shellAutoReview: false };
    }
  }

  private async executeMcpTool(invocation: ToolInvocationInput): Promise<unknown> {
    if (!this.mcpPool) {
      throw new Error("MCP proxying is not configured in the local runtime");
    }

    const serverId =
      invocation.permissionMcpId ?? readString(invocation.input, "mcpServerId");
    const permissionToolName = invocation.permissionToolName;
    const toolName =
      readString(invocation.input, "toolName") ??
      (permissionToolName?.startsWith("mcp:") ? undefined : permissionToolName);
    if (!serverId) {
      throw new Error("MCP invocation is missing mcpServerId");
    }
    if (!toolName) {
      throw new Error("MCP invocation is missing toolName");
    }

    const role = invocation.spiritRole ?? "worker";
    const attachment = this.repo
      .listAttachedServersForSpirit(invocation.organizationId, invocation.memberId, role)
      .find((current) => current.server.id === serverId);
    if (!attachment) {
      throw new Error(
        `MCP server "${serverId}" is not attached to member "${invocation.memberId}" for ${role} spirits`,
      );
    }

    const def = materializeMcpDef(this.repo, attachment.server);
    const connection = await this.mcpPool.get(def, { agentId: invocation.memberId });
    const result = await connection.callTool(
      {
        agentId: invocation.memberId,
        taskId: invocation.taskSessionId,
        sessionId: invocation.runId,
      },
      toolName,
      Object.prototype.hasOwnProperty.call(invocation.input, "args")
        ? invocation.input.args
        : {},
    );
    if (result.isError) {
      throw new Error(formatMcpError(result.content, toolName));
    }
    return result.content;
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
      metadata: {
        runId: invocation.runId,
        toolCallId: invocation.toolCallId,
        ...invocation.input,
        ...metadata,
      },
      createdAt: new Date().toISOString(),
    });
  }

  private saveRunStep(
    invocation: ToolInvocationInput,
    status: AuditStatus,
    output: unknown,
  ): void {
    const existing = this.repo
      .listRunSteps(invocation.organizationId, invocation.runId)
      .find((step) => step.toolCallId === invocation.toolCallId);

    this.repo.saveRunStep({
      id: existing?.id ?? randomUUID(),
      organizationId: invocation.organizationId,
      runId: invocation.runId,
      threadId: invocation.threadId,
      agentId: invocation.memberId,
      toolCallId: invocation.toolCallId,
      toolId: invocation.toolId,
      action: invocation.action,
      resourceType: invocation.resourceType,
      resourcePath: invocation.resourcePath ?? "",
      input: invocation.input ?? {},
      output,
      status,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    });
  }

  /** Emits tool:called so clients / traces see args before policy, approval, or execute. */
  private emitToolCalled(invocation: ToolInvocationInput, rooms: string[]): void {
    const run = this.repo.getRun(invocation.organizationId, invocation.runId);
    const threadId = invocation.threadId ?? run?.threadId;
    this.realtime.emit(
      SocketEventNames.toolCalled,
      {
        organizationId: invocation.organizationId,
        runId: invocation.runId,
        threadId,
        agentId: invocation.memberId,
        toolCall: {
          toolCallId: invocation.toolCallId,
          toolName: invocation.toolId,
          args: toolCallArgsForClient(invocation),
        },
      },
      rooms,
    );
  }

  private emitToolProgress(invocation: ToolInvocationInput, output: unknown): void {
    const rooms = this.getRooms(invocation.organizationId, invocation.runId, invocation.memberId);
    const run = this.repo.getRun(invocation.organizationId, invocation.runId);
    const threadId = invocation.threadId ?? run?.threadId;
    this.realtime.emit(
      SocketEventNames.toolResult,
      {
        organizationId: invocation.organizationId,
        runId: invocation.runId,
        threadId,
        agentId: invocation.memberId,
        toolResult: {
          toolCallId: invocation.toolCallId,
          result: output,
          isError: false,
        },
      },
      rooms,
    );
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

  private async prepareInvocation(
    invocation: ToolInvocationInput,
    roleName: string,
    team: AgentTeamHandle,
  ): Promise<ToolInvocationInput> {
    if (!usesPathResolution(invocation.toolId)) {
      return invocation;
    }

    const resolver = await createMemberBoundaryPathResolver(
      this.repo,
      team,
      invocation.organizationId,
      invocation.memberId,
      roleName,
    );

    if (isPathScopedToolId(invocation.toolId)) {
      if (!invocation.resourcePath) {
        return invocation;
      }
      return {
        ...invocation,
        resourcePath: await resolver.resolve(invocation.resourcePath),
      };
    }

    const input = invocation.input ?? {};

    if (
      input.operation === "send_input" ||
      input.operation === "read_output" ||
      input.operation === "wait" ||
      input.operation === "terminate"
    ) {
      return invocation;
    }

    const commandText = typeof input.command === "string" ? input.command : "";
    const requestedCwd =
      typeof input.cwd === "string"
        ? input.cwd
        : (invocation.resourcePath ?? resolver.scopePaths[0] ?? ".");
    const resolvedCwd = await resolver.resolve(requestedCwd);
    const explicitArgs = Array.isArray(input.args) ? input.args : undefined;
    const normalizedShell = normalizeShellScope({
      input: {
        ...input,
        command: commandText,
        ...(explicitArgs ? { args: explicitArgs } : {}),
      },
      resourcePath: invocation.resourcePath,
    });
    const argsForScopeChecks = explicitArgs ?? normalizedShell.args;
    const resolvePathOperands = normalizedShell.command === "cat";
    const resolvedArgs =
      resolvePathOperands && argsForScopeChecks
        ? await Promise.all(
            argsForScopeChecks.map(async (arg) => {
              if (typeof arg !== "string" || arg.startsWith("-")) return arg;
              return await resolver.resolve(resolve(resolvedCwd, arg));
            }),
          )
        : argsForScopeChecks;
    const nextInput = {
      ...input,
      cwd: resolvedCwd,
      command: commandText,
      ...(explicitArgs && resolvedArgs ? { args: resolvedArgs } : {}),
    };

    return {
      ...invocation,
      resourcePath:
        resolvePathOperands
          ? resolvedArgs?.find((arg) => typeof arg === "string" && !arg.startsWith("-")) ??
            resolvedCwd
          : resolvedCwd,
      input: nextInput,
    };
  }

  private requestHumanApproval(
    preparedInvocation: ToolInvocationInput,
    approvalScope: string,
  ): ToolInvocationResult {
    const displayScope = enrichToolApprovalScopeForRequest(approvalScope, preparedInvocation);
    const approval = this.approvals.requestApproval({
      organizationId: preparedInvocation.organizationId,
      runId: preparedInvocation.runId,
      toolCallId: preparedInvocation.toolCallId,
      requestedBy: preparedInvocation.memberId,
      resourceType: preparedInvocation.resourceType,
      resourcePath: preparedInvocation.resourcePath ?? "",
      action: preparedInvocation.action,
      reason: `Tool action requires approval;scope=${encodeURIComponent(displayScope)}`,
      approvalScope,
    });

    this.audit(preparedInvocation, "ok", {
      approvalId: approval.id,
      status: "pending_approval",
    });
    if (approval.toolCallId === preparedInvocation.toolCallId) {
      this.saveRunStep(preparedInvocation, "ok", {
        status: "waiting_for_approval",
        approvalId: approval.id,
      });
    }

    return approvalWaitResult(approval.id);
  }

  private async tryAutoReviewShell(input: {
    invocation: ToolInvocationInput;
    member: Member;
    teamRoleName: string;
    approvalScope: string;
    spiritRole: SpiritRole;
  }): Promise<void> {
    if (!this.modelResolver) {
      this.audit(input.invocation, "ok", {
        status: "auto_review_escalated",
        reason: "auto_review:escalated;note=Model resolver unavailable",
      });
      return;
    }
    try {
      const model = await Promise.resolve(
        this.modelResolver({
          organizationId: input.invocation.organizationId,
          memberId: input.invocation.memberId,
          role: input.spiritRole,
        }),
      );
      const scope = normalizeShellScope({
        input: input.invocation.input ?? {},
        resourcePath: input.invocation.resourcePath,
      });
      const review = await this.shellAutoReview.review({
        model,
        scope,
        memberName: input.member.name,
        roleName: input.teamRoleName,
      });
      const note = review.rationale.trim() || "Auto review";
      if (review.decision === "approve") {
        this.allowRun(
          input.invocation.organizationId,
          input.invocation.runId,
          input.approvalScope,
        );
        this.audit(input.invocation, "ok", {
          status: "auto_review_approved",
          reason: `auto_review:approved;note=${note}`,
        });
        return;
      }
      this.audit(input.invocation, "ok", {
        status: "auto_review_escalated",
        reason: `auto_review:escalated;note=${note}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Auto review failed";
      this.audit(input.invocation, "ok", {
        status: "auto_review_escalated",
        reason: `auto_review:escalated;note=${message}`,
      });
    }
  }
}

function isWaitingForInputResult(value: unknown): value is { status: "waiting_for_input"; questionId: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { status?: unknown }).status === "waiting_for_input" &&
    typeof (value as { questionId?: unknown }).questionId === "string"
  );
}

export function summarizeToolOutput(value: unknown): unknown {
  const output = value as { status?: unknown; stdout?: unknown; stderr?: unknown } | undefined;
  const formatted = formatReadableToolOutput(value);
  if (formatted) return truncateText(formatted);

  if (output && typeof output.status === "string") return value;

  if (!value || typeof value !== "object") return value;
  if (typeof output?.stdout === "string" || typeof output?.stderr === "string") {
    return {
      stdout: truncateText(output.stdout),
      stderr: truncateText(output.stderr),
    };
  }
  return truncateText(JSON.stringify(value));
}

function truncateText(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  return text.length > 4000 ? `${text.slice(0, 4000)}\n[truncated]` : text;
}

function readString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function formatMcpError(content: unknown, toolName: string): string {
  if (typeof content === "string" && content.length > 0) return content;
  if (content === undefined || content === null) return `MCP tool "${toolName}" failed`;
  try {
    return JSON.stringify(content);
  } catch {
    return `MCP tool "${toolName}" failed`;
  }
}
