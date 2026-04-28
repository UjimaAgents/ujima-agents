export { runTask } from './run-task';
export { resolveManualTeam, groupAgentsByMCP } from './manual-mode';
export type { ManualTeamResolution } from './manual-mode';
export { wireApprovalsGate } from './approvals-gate';
export type { ApprovalsGateInputs, ApprovalsGateHandle } from './approvals-gate';
export { synthesizeTask } from './synthesis';
export type { SynthesizeInputs } from './synthesis';
export { planAssignments } from './plan';
export type { PlanAssignment, PlanInputs, PlanResult } from './plan';
export {
  ORCHESTRATOR_EVENT_CHANNEL,
  type OrchestratorDeps,
  type RunTaskInputs,
  type RunTaskResult,
  type SessionHandle,
  type TaskStatus,
  type TaskSynthesis,
  type OrchestratorEvent,
  type OrchestratorEventType,
} from './types';

export { AiService } from './ai-service.js';
export type { GenerateRunReplyInput } from './ai-service.js';
export { ALWAYS_AVAILABLE_AGENT_TOOLS } from './tools/index.js';
export {
  ApprovalService,
  AuthService,
  BootstrapService,
  ChannelRetentionService,
  ConfigSyncService,
  ConversationService,
  OnboardingService,
  RunService,
  SettingsService,
  TaskPromoterService,
  TaskSessionService,
  ToolServiceImpl,
  createApiServices,
  createPermissionGatedToolService,
  createTeamStore,
  ERR_NO_WORKSPACE_ROOT,
  WorkspaceRootRequiredError,
  isWorkspaceRootRequiredError,
  requireOrganizationWorkspaceRoot,
  listProviderStatuses,
  summarizeTeam,
  validateProviderKeys,
} from './services/index.js';
export type {
  ApiRepository,
  ApiServices,
  ApiServicesContext,
  ApiServiceContext,
  AuthState,
  AuthenticatedSession,
  ApprovalRequester,
  ApprovalRequestInput,
  ApprovalResolveInput,
  BootstrapResponse,
  BootstrapSnapshot,
  ConversationRepository,
  CreateRunInput,
  OnboardingInlineTeam,
  OnboardingInput,
  OnboardingResult,
  OrganizationSettingsResponse,
  PaginatedChannels,
  PaginatedMessages,
  PaginatedRuns,
  PermissionContextBuilder,
  RealtimeService,
  ReconcileTeamConfigInput,
  ReconcileTeamConfigResult,
  ReconcileTeamConfigStats,
  RepositoryReader,
  ResumeRun,
  RegisterOwnerAuthInput,
  TaskPromotionInput,
  TaskPromotionResult,
  CreateTaskSessionInput,
  TaskSessionDetail,
  PaginatedTaskSessions,
  TeamSettingsResponse,
  TeamStore,
  TeamSummary,
  LoginInput,
  ToolInvocationInput,
  ToolInvocationResult,
  ToolService,
  UpdateOrganizationInput,
} from './services/index.js';
