import type { PermissionMiddleware } from '@ujima/permissions';
import { AiService } from '../ai-service.js';
import { ApprovalService } from './approval.js';
import { BootstrapService } from './bootstrap.js';
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
export { BootstrapService } from './bootstrap.js';
export type { BootstrapResponse } from './bootstrap.js';
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
}

export interface ApiServices {
  ai: AiService;
  tools: ToolService;
  conversations: ConversationService;
  runs: RunService;
  approvals: ApprovalService;
  bootstrap: BootstrapService;
  onboarding: OnboardingService;
  settings: SettingsService;
  taskPromoter: TaskPromoterService;
}

export function createApiServices(context: ApiServicesContext): ApiServices {
  const conversations = new ConversationService(context.repo, context.realtime);

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

  const bootstrap = new BootstrapService(context.repo, context.teamStore);
  const onboarding = new OnboardingService(context.repo, context.teamStore);
  const settings = new SettingsService(context.repo, context.teamStore);
  const taskPromoter = new TaskPromoterService(context.repo, runs);

  return {
    ai,
    tools,
    conversations,
    runs,
    approvals: approvalsImpl,
    bootstrap,
    onboarding,
    settings,
    taskPromoter,
  };
}
