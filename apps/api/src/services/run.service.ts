import { randomUUID } from "node:crypto";
import { MessageSchema, RunStateSchema, SocketEventNames, type RunState } from "@ujima/shared";
import type { AgentTeamHandle } from "@ujima/framework";
import type { Repository } from "../repositories.ts";
import { memberRoom, orgRoom, runRoom, threadRoom, type RealtimeService } from "../realtime.ts";
import { AiService } from "./ai.service.ts";
import { ConversationService } from "./conversation.service.ts";
import { ToolService } from "./tool.service.ts";

export class RunService {
  constructor(
    private readonly team: AgentTeamHandle | null,
    private readonly repo: Repository,
    private readonly realtime: RealtimeService,
    private readonly conversations: ConversationService,
    private readonly ai: AiService,
    private readonly tools: ToolService,
  ) {}

  async createRun(input: {
    organizationId: string;
    agentId: string;
    threadId: string;
    summary?: string;
  }): Promise<RunState> {
    const member = this.repo.getMember(input.organizationId, input.agentId);
    if (!member) {
      throw new Error(`Member not found: ${input.agentId}`);
    }

    if (member.kind !== "agent") {
      throw new Error(`Member "${input.agentId}" is not an agent`);
    }

    const run = RunStateSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      agentId: input.agentId,
      threadId: input.threadId,
      status: "queued",
      step: "queued",
      summary: input.summary ?? "Run queued",
      startedAt: new Date().toISOString(),
    });

    this.repo.saveRun(run);
    this.realtime.emit(SocketEventNames.runStarted, { organizationId: input.organizationId, run }, [
      orgRoom(input.organizationId),
      threadRoom(input.threadId),
      memberRoom(input.agentId),
      runRoom(run.id),
    ]);

    return this.advanceRun(run);
  }

  async resumeAfterApproval(organizationId: string, runId: string) {
    const run = this.repo.getRun(organizationId, runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    if (run.status !== "waiting_for_approval") {
      return run;
    }

    this.tools.allowRun(organizationId, runId);
    return this.advanceRun({
      ...run,
      status: "running",
      step: "running",
      summary: "Run resumed after approval",
    });
  }

  listRuns(organizationId: string) {
    return this.repo.listRuns(organizationId);
  }

  getRun(organizationId: string, runId: string) {
    return this.repo.getRun(organizationId, runId);
  }

  private async advanceRun(run: RunState): Promise<RunState> {
    const team = this.requireTeam();
    const member = this.repo.getMember(run.organizationId, run.agentId);
    if (!member) {
      throw new Error(`Member not found: ${run.agentId}`);
    }

    const role = team.getRole(member.roleName);
    if (!role) {
      throw new Error(`Role not found: ${member.roleName}`);
    }

    const agent = team.getAgent(member.id) ?? team.getAgent(member.name);
    if (!agent) {
      return this.failRun(run, `Agent not found: ${member.id}`);
    }

    const providerName = role.provider;
    if (providerName && !this.repo.getProviderCredential(run.organizationId, providerName)) {
      return this.failRun(run, `Provider key missing for "${providerName}"`);
    }

    const running = this.repo.saveRun({
      ...run,
      status: "running",
      step: "running",
      summary: "Run executing",
    });

    this.realtime.emit(SocketEventNames.runUpdated, { organizationId: run.organizationId, run: running }, [
      orgRoom(run.organizationId),
      threadRoom(run.threadId),
      memberRoom(run.agentId),
      runRoom(run.id),
    ]);

    try {
      const result = await this.ai.generateRunReply({
        organizationId: run.organizationId,
        agentId: run.agentId,
        threadId: run.threadId,
        runId: run.id,
        summary: run.summary,
      });

      const statuses = result.toolResults.map((toolResult) => (toolResult.output as { status?: string } | undefined)?.status);
      if (statuses.includes("blocked")) {
        return this.failRun(running, "Tool action blocked");
      }

      if (statuses.includes("waiting_for_approval")) {
        return this.waitForApproval(running, "Waiting for approval");
      }

      const text = result.text.trim();
      if (text.length > 0) {
        this.conversations.publishMessage(
          MessageSchema.parse({
            id: randomUUID(),
            organizationId: run.organizationId,
            threadId: run.threadId,
            channelId: this.repo.getThread(run.organizationId, run.threadId)?.channelId,
            senderId: run.agentId,
            senderKind: "agent",
            kind: "agent",
            content: text,
            createdAt: new Date().toISOString(),
          }),
        );
      }

      return this.completeRun(running, text || "Run completed");
    } catch (error) {
      return this.failRun(running, (error as Error).message);
    }
  }

  private completeRun(run: RunState, summary: string): RunState {
    const completed = this.repo.saveRun({
      ...run,
      status: "completed",
      step: "completed",
      summary,
      endedAt: new Date().toISOString(),
    });

    this.realtime.emit(SocketEventNames.runCompleted, { organizationId: run.organizationId, run: completed }, [
      orgRoom(run.organizationId),
      threadRoom(run.threadId),
      memberRoom(run.agentId),
      runRoom(run.id),
    ]);

    return completed;
  }

  private waitForApproval(run: RunState, summary: string): RunState {
    const waiting = this.repo.saveRun({
      ...run,
      status: "waiting_for_approval",
      step: "waiting_for_approval",
      summary,
    });

    this.realtime.emit(SocketEventNames.runUpdated, { organizationId: run.organizationId, run: waiting }, [
      orgRoom(run.organizationId),
      threadRoom(run.threadId),
      memberRoom(run.agentId),
      runRoom(run.id),
    ]);

    return waiting;
  }

  private failRun(run: RunState, summary: string): RunState {
    const failed = this.repo.saveRun({
      ...run,
      status: "failed",
      step: "failed",
      summary,
      endedAt: new Date().toISOString(),
    });

    this.realtime.emit(SocketEventNames.runCompleted, { organizationId: run.organizationId, run: failed }, [
      orgRoom(run.organizationId),
      threadRoom(run.threadId),
      memberRoom(run.agentId),
      runRoom(run.id),
    ]);

    return failed;
  }

  private requireTeam() {
    if (!this.team) {
      throw new Error("Team config not loaded");
    }

    return this.team;
  }
}
