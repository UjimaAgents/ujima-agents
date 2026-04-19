import type { AgentTeamHandle } from "@ujima/framework";
import type { Repository } from "../repositories.ts";
import type { RealtimeService } from "../realtime.ts";
import { ApprovalService } from "./approval.service.ts";
import { AiService } from "./ai.service.ts";
import { BootstrapService } from "./bootstrap.service.ts";
import { ConversationService } from "./conversation.service.ts";
import { OnboardingService } from "./onboarding.service.ts";
import { RunService } from "./run.service.ts";
import { SettingsService } from "./settings.service.ts";
import { ToolService } from "./tool.service.ts";

export interface ApiServicesContext {
  team: AgentTeamHandle | null;
  repo: Repository;
  realtime: RealtimeService;
}

export function createApiServices(context: ApiServicesContext) {
  const conversations = new ConversationService(context.repo, context.realtime);
  let runs: RunService;
  const approvals = new ApprovalService(context.repo, context.realtime, (organizationId, runId) =>
    runs.resumeAfterApproval(organizationId, runId),
  );
  const tools = new ToolService(context.team, context.repo, approvals, conversations, context.realtime);
  const ai = new AiService(context.team, context.repo, tools);
  runs = new RunService(context.team, context.repo, context.realtime, conversations, ai, tools);

  return {
    bootstrap: new BootstrapService(context),
    onboarding: new OnboardingService(context.repo),
    settings: new SettingsService(context),
    conversations,
    runs,
    approvals,
    tools,
  };
}

export type ApiServices = ReturnType<typeof createApiServices>;
