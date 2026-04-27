import type { PermissionMiddleware } from '@ujima/permissions';
import { AiService } from '../ai-service.js';
import { ApprovalService } from './approval.js';
import { AuthService } from './auth.js';
import { BootstrapService } from './bootstrap.js';
import { ChannelRetentionService } from './channel-retention.js';
import type { ApiServiceContext } from './context.js';
import { ConversationService } from './conversation.js';
import { OnboardingService } from './onboarding.js';
import type { ApiRepository } from './repository-reader.js';
import { RunService } from './run.js';
import { SettingsService } from './settings.js';
import { TaskPromoterService } from './task-promoter.js';
import {
  createPermissionGatedToolService,
  type PermissionContextBuilder,
  type ToolService,
} from './tool-service.js';
import { ToolServiceImpl, type ApprovalRequester } from './tool-service-impl.js';

export type { ApiServiceContext, RealtimeService } from './context.js';
export { createTeamStore } from './team-store.js';
export type { TeamStore } from './team-store.js';
export { ApprovalService } from './approval.js';
export type {
  ApprovalRequestInput,
  ApprovalResolveInput,
  ResumeRun,
} from './approval.js';
export { AuthService } from './auth.js';
export type {
  AuthState,
  AuthenticatedSession,
  LoginInput,
  RegisterOwnerAuthInput,
} from './auth.js';
export { BootstrapService } from './bootstrap.js';
export type { BootstrapResponse } from './bootstrap.js';
export { ChannelRetentionService } from './channel-retention.js';
export { ConfigSyncService } from './config-sync.js';
export type {
  ReconcileTeamConfigInput,
  ReconcileTeamConfigResult,
  ReconcileTeamConfigStats,
} from './config-sync.js';
export { ConversationService } from './conversation.js';
export { OnboardingService } from './onboarding.js';
export type {
  OnboardingInlineTeam,
  OnboardingInput,
  OnboardingResult,
} from './onboarding.js';
export { RunService } from './run.js';
export type { CreateRunInput } from './run.js';
export { SettingsService } from './settings.js';
export type {
  OrganizationSettingsResponse,
  TeamSettingsResponse,
  UpdateOrganizationInput,
} from './settings.js';
export { TaskPromoterService } from './task-promoter.js';
export type { TaskPromotionInput, TaskPromotionResult } from './task-promoter.js';
export {
  ERR_NO_WORKSPACE_ROOT,
  WorkspaceRootRequiredError,
  isWorkspaceRootRequiredError,
  requireOrganizationWorkspaceRoot,
} from './workspace-root.js';
export type {
  ApiRepository,
  BootstrapSnapshot,
  ConversationRepository,
  PaginatedChannels,
  PaginatedMessages,
  PaginatedRuns,
  RepositoryReader,
} from './repository-reader.js';
export {
  listProviderStatuses,
  summarizeTeam,
  validateProviderKeys,
} from './team.js';
export type { TeamSummary } from './team.js';
export { createPermissionGatedToolService } from './tool-service.js';
export type {
  PermissionContextBuilder,
  ToolInvocationInput,
  ToolInvocationResult,
  ToolService,
} from './tool-service.js';
export { ToolServiceImpl } from './tool-service-impl.js';
export type { ApprovalRequester } from './tool-service-impl.js';

export interface ApiServicesContext extends ApiServiceContext {
  permissions: PermissionMiddleware;
  buildPermissionContext: PermissionContextBuilder;
  repo: ApiRepository;
  archiveRoot?: string;
}

export interface ApiServices {
  ai: AiService;
  tools: ToolService;
  conversations: ConversationService;
  retention: ChannelRetentionService;
  runs: RunService;
  approvals: ApprovalService;
  auth: AuthService;
  bootstrap: BootstrapService;
  onboarding: OnboardingService;
  settings: SettingsService;
  taskPromoter: TaskPromoterService;
}

export function createApiServices(context: ApiServicesContext): ApiServices {
  const retention = new ChannelRetentionService(
    context.repo,
    context.archiveRoot ?? process.env.UJIMA_HOME ?? process.cwd(),
  );

  let wakeMember: (input: {
    organizationId: string;
    memberId: string;
    threadId: string;
    channelId?: string;
    messageId: string;
    byMemberId: string;
    reason: string;
  }) => Promise<void> | void = () => undefined;

  const conversations = new ConversationService(context.repo, context.realtime, {
    archiveStore: retention,
    onMemberAlerted: (input) => wakeMember(input),
  });

  // Late-bound resume callback — runs is constructed below and plugged in.
  let resumeRun: (organizationId: string, runId: string) => Promise<unknown> | unknown = () => {
    throw new Error('resumeRun not wired');
  };

  const approvalsImpl = new ApprovalService(context.repo, context.realtime, (orgId, runId) =>
    resumeRun(orgId, runId),
  );

  const approvalRequester: ApprovalRequester = {
    requestApproval: (input) => approvalsImpl.requestApproval(input),
  };

  const innerTools = new ToolServiceImpl(
    context.teamStore,
    context.repo,
    approvalRequester,
    conversations,
    context.realtime,
  );

  const tools = createPermissionGatedToolService(
    innerTools,
    context.permissions,
    context.buildPermissionContext,
  );

  const ai = new AiService(context.teamStore, context.repo, tools);

  const runs = new RunService(
    context.teamStore,
    context.repo,
    context.realtime,
    conversations,
    ai,
    tools,
  );
  resumeRun = (orgId, runId) => runs.resumeAfterApproval(orgId, runId);
  wakeMember = async (input) => {
    await runs.createRun({
      organizationId: input.organizationId,
      agentId: input.memberId,
      threadId: input.threadId,
      summary: `Mentioned by ${input.byMemberId} via ${input.reason} on message ${input.messageId}`,
    });
  };

  const auth = new AuthService(context.repo);
  const bootstrap = new BootstrapService(context.repo, context.teamStore, auth);
  const onboarding = new OnboardingService(context.repo, context.teamStore);
  const settings = new SettingsService(context.repo, context.teamStore);
  const taskPromoter = new TaskPromoterService(context.repo, runs);

  return {
    ai,
    tools,
    conversations,
    retention,
    runs,
    approvals: approvalsImpl,
    auth,
    bootstrap,
    onboarding,
    settings,
    taskPromoter,
  };
}
