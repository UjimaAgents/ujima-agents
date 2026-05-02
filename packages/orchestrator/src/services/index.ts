import type { PermissionMiddleware } from '@ujima/permissions';
import { AiService } from '../ai-service.js';
import { ActiveSpiritRegistry } from './active-spirit-registry.js';
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
import { SpiritService, type ModelResolver } from './spirit.js';
import { SupervisorService } from './supervisor.js';
import { SupervisorTodoService } from './supervisor-todo.js';
import { TaskPromoterService } from './task-promoter.js';
import { TaskSessionService } from './task-session.js';
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
export { TaskSessionService, taskRunChannelId } from './task-session.js';
export type { CreateTaskSessionInput, TaskSessionDetail } from './task-session.js';
export type { TaskPromotionInput, TaskPromotionResult } from './task-promoter.js';
export { SupervisorService } from './supervisor.js';
export type {
  SupervisorAlertInput,
  SupervisorDispatchResult,
  SupervisorReplyOutcome,
  SupervisorServiceOptions,
} from './supervisor.js';
export { SupervisorTodoService } from './supervisor-todo.js';
export type {
  SupervisorTodoAddInput,
  SupervisorTodoCheckInput,
  SupervisorTodoListInput,
} from './supervisor-todo.js';
export { ActiveSpiritRegistry, isAliveStatus } from './active-spirit-registry.js';
export type { ActiveSpiritEntry } from './active-spirit-registry.js';
export { SpiritService, pickProviderModel } from './spirit.js';
export type {
  ModelResolver,
  ModelResolverInput,
  RunSpiritInput,
  RunSpiritOutcome,
  SpawnSpiritInput,
  SpiritServiceOptions,
} from './spirit.js';
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
  PaginatedTaskSessions,
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
  /**
   * Phase 2: optional model resolver override. Tests pass a mock that
   * returns a `MockLanguageModelV3`; production leaves it unset and
   * the SpiritService walks the team config + provider credentials.
   */
  spiritModelResolver?: ModelResolver;
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
  taskSessions: TaskSessionService;
  spirits: SpiritService;
  supervisor: SupervisorService;
  supervisorTodos: SupervisorTodoService;
  activeSpirits: ActiveSpiritRegistry;
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

  const supervisorTodos = new SupervisorTodoService(context.repo);

  const innerTools = new ToolServiceImpl(
    context.teamStore,
    context.repo,
    approvalRequester,
    conversations,
    context.realtime,
    supervisorTodos,
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

  // Phase 2.C.1 — single shared in-memory registry. SpiritService writes
  // (spawn/retire/complete); SupervisorService reads on every alert.
  const activeSpirits = new ActiveSpiritRegistry();

  const spirits = new SpiritService(
    context.teamStore,
    context.repo,
    context.realtime,
    tools,
    {
      modelResolver: context.spiritModelResolver,
      registry: activeSpirits,
    },
  );
  // Hydrate the in-memory registry from persisted spirits BEFORE
  // SupervisorService is wired and able to receive alerts. Without
  // this, a daemon restart would see an empty registry, and
  // `handleAlert` would return `no-active-spirit` for already-running
  // work — falling through to the regular wake path and spawning
  // duplicate runs for active tasks until something in this process
  // re-spawns the spirit.
  spirits.bootstrapAll();
  const supervisor = new SupervisorService(
    context.repo,
    context.realtime,
    conversations,
    spirits,
    activeSpirits,
  );

  // Wake routing — replaces the simple `runs.createRun` fan-out.
  // The dispatch result is a discriminated union; only
  // `no-active-spirit` falls through to the regular run loop. A
  // `debounced` result means the supervisor intentionally suppressed
  // the alert (second mention in a 2s burst) — falling through there
  // would spawn a duplicate run that defeats the debounce.
  wakeMember = async (input) => {
    const dispatch = await supervisor.handleAlert({
      organizationId: input.organizationId,
      memberId: input.memberId,
      channelId: input.channelId,
      messageId: input.messageId,
      threadId: input.threadId,
      byMemberId: input.byMemberId,
      reason: input.reason,
    });
    if (dispatch.kind !== 'no-active-spirit') {
      return;
    }
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
  const taskSessions = new TaskSessionService(context.repo, conversations, spirits);

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
    taskSessions,
    spirits,
    supervisor,
    supervisorTodos,
    activeSpirits,
  };
}
