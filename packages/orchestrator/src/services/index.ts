import type { PermissionMiddleware } from '@ujima/permissions';
import {
  SocketEventNames,
  channelRoom,
  memberRoom,
  orgRoom,
  threadRoom,
  type MemberAlertFailureStage,
  type WakeReason,
} from '@ujima/shared';
import { AiService } from '../ai-service.js';
import { ActiveSpiritRegistry } from './active-spirit-registry.js';
import { ApprovalService } from './approval.js';
import { AuthService } from './auth.js';
import { BootstrapService } from './bootstrap.js';
import { ChannelRetentionService } from './channel-retention.js';
import type { ApiServiceContext } from './context.js';
import { ConversationService } from './conversation.js';
import { GoalSystemService } from './goal-system.js';
import { MemoryReviewService } from './memory-review.js';
import { TrajectoryService } from './trajectory.js';
import { McpRegistryService } from './mcp-registry.js';
import { PluginRegistryService } from './plugin-registry.js';
import { OnboardingService } from './onboarding.js';
import {
  drainPendingMemberAlertAfterRun,
  enqueuePendingMemberAlert,
  type PendingMemberAlert,
} from './pending-member-alerts.js';
import type { ApiRepository } from './repository-reader.js';
import { SettingsService } from './settings.js';
import { WorkspaceService, type WorkspaceCatalog } from './workspace.js';
import { SpiritService, type ModelResolver, type SpiritMcpPool } from './spirit.js';
import { SchedulerService } from './scheduler.js';
import { TaskSessionService } from './task-session.js';
import type { TeamStore } from './team-store.js';
import {
  createPermissionGatedToolService,
  saveBlockedToolRunStep,
  type PermissionContextBuilder,
  type ToolService,
} from './tool-service.js';
import { ToolServiceImpl, type ApprovalRequester } from './tool-service-impl.js';
import { createSpiritModelResolver } from '../utils/create-spirit-model-resolver.js';

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
export {
  ACTIVE_WORKSPACE_SETTING_KEY,
  TEAM_CONFIG_SETTING_KEY,
  persistTeamConfig,
} from './config-sync.js';
export { ConversationService } from './conversation.js';
export { GoalSystemService } from './goal-system.js';
export type { ParsedPlanTask } from './goal-system.js';
export {
  SELF_NOTE_COMPACTED_MARKER,
  SELF_NOTE_SUMMARY_MARKER,
  buildStructuredConversationSummary,
  buildSelfNoteSummary,
  formatTimestampedContent,
  isMessageWithMarker,
  isCompactedSelfNote,
  isSelfSummaryNote,
  toReadableEnglishTimestamp,
} from './conversation-summary.js';
export { OnboardingService } from './onboarding.js';
export type {
  OnboardingInlineTeam,
  OnboardingInput,
  OnboardingResult,
} from './onboarding.js';
export type { CreateRunInput } from './spirit.js';
export {
  SchedulerService,
  createScheduledJobRecord,
  computeNextCronRun,
  parseCronExpression,
  resolveScheduledJobNextRunAt,
} from './scheduler.js';
export type { SchedulerServiceOptions } from './scheduler.js';
export { SettingsService } from './settings.js';
export {
  applyDashboardTeamOverrides,
  deleteDashboardTeamOverride,
  upsertDashboardTeamOverride,
} from './dashboard-team-overrides.js';
export { orgWorkspaceId, organizationIdFromWorkspaceId } from '@ujima/shared';
export {
  assertGrantableOwnerFromParentOrg,
  copyProviderCredentials,
  grantOrganizationAccessForMember,
  grantWorkspaceOwnerForMember,
  grantWorkspaceOwnerFromParentOrg,
  WORKSPACE_OWNER_MEMBER_ID,
} from './workspace-org-provision.js';
export {
  ensureChannelThread,
  ensureDirectMessageConversation,
} from './member-channels.js';
export { WorkspaceService } from './workspace.js';
export {
  migrateUnifiedWorkspaceOrg,
  ORGANIZATION_WORKSPACE_IDS_KEY,
} from './workspace-org-migration.js';
export type { WorkspaceOrgMigrationResult } from './workspace-org-migration.js';
export type {
  CreateWorkspaceInput,
  ListAccessibleWorkspacesResult,
  WorkspaceCatalog,
  WorkspaceListItem,
} from './workspace.js';
export type {
  OrganizationSettingsResponse,
  TeamSettingsResponse,
  UpdateOrganizationInput,
} from './settings.js';
export { TaskSessionService, taskRunChannelId } from './task-session.js';
export type { CreateTaskSessionInput, TaskSessionDetail } from './task-session.js';
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
export { McpRegistryService } from './mcp-registry.js';
export type {
  AttachMcpInput,
  CreateMcpServerInput,
  ImportMcpServersInput,
  ImportMcpServersResult,
  TestMcpResult,
  UpdateMcpServerInput,
} from './mcp-registry.js';
export { PluginRegistryService } from './plugin-registry.js';
export type {
  PluginInstallInput,
  SkillInvocation,
} from './plugin-registry.js';
export {
  ERR_NO_WORKSPACE_ROOT,
  WorkspaceRootRequiredError,
  assertWorkspaceRootPathExists,
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
  workspaces: WorkspaceCatalog;
  archiveRoot?: string;
  /**
   * Phase 2: optional model resolver override. Tests pass a mock that
   * returns a `MockLanguageModelV3`; production leaves it unset and
   * the SpiritService walks the team config + provider credentials.
   */
  spiritModelResolver?: ModelResolver;
  /**
   * Optional MCP pool. When provided, SpiritService injects per-agent
   * attached MCP tools into the runtime palette. Production wires the
   * runtime host's shared pool; tests can pass a stub or leave unset
   * (the spirit run path still works without MCP tools).
   */
  mcpPool?: SpiritMcpPool;
}

export interface ApiServices {
  ai: AiService;
  tools: ToolService;
  conversations: ConversationService;
  retention: ChannelRetentionService;
  runs: SpiritService;
  approvals: ApprovalService;
  auth: AuthService;
  bootstrap: BootstrapService;
  teamStore: TeamStore;
  onboarding: OnboardingService;
  settings: SettingsService;
  workspaces: WorkspaceService;
  scheduler: SchedulerService;
  taskSessions: TaskSessionService;
  goals: GoalSystemService;
  spirits: SpiritService;
  activeSpirits: ActiveSpiritRegistry;
  mcpRegistry: McpRegistryService;
  pluginRegistry: PluginRegistryService;
}

type WakeMemberInput = PendingMemberAlert;

interface WakeMemberDeps {
  spirits: Pick<SpiritService, 'handleAlert'>;
  runs: Pick<SpiritService, 'createRun'>;
  realtime: Pick<ApiServiceContext['realtime'], 'emit'>;
  repo: Pick<ApiRepository, 'findActiveRunForMemberThread'>;
}

/**
 * L10 — per-`(org, member, threadId)` async mutex around the
 * findActiveRunForMemberThread → createRun TOCTOU window. Without
 * this, two near-simultaneous broad-wake alerts for the same agent
 * on the same thread both observe "no active run" and each spawn
 * a fresh run, leaving two concurrent runs reading the same thread
 * state. Module-scoped so daemon-wide ordering is preserved across
 * the service builder.
 */
const createRunMutexes = new Map<string, Promise<unknown>>();

function createRunMutexKey(input: WakeMemberInput): string {
  return `${input.organizationId}:${input.memberId}:${input.threadId}`;
}

async function withCreateRunMutex<T>(
  input: WakeMemberInput,
  body: () => Promise<T>,
): Promise<T> {
  const key = createRunMutexKey(input);
  const previous = createRunMutexes.get(key) ?? Promise.resolve();
  const next = previous.then(body, body);
  createRunMutexes.set(
    key,
    next.catch(() => undefined).finally(() => {
      if (createRunMutexes.get(key) === next) {
        createRunMutexes.delete(key);
      }
    }),
  );
  return next;
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emitMemberAlertFailed(
  realtime: Pick<ApiServiceContext['realtime'], 'emit'>,
  input: WakeMemberInput,
  stage: MemberAlertFailureStage,
  error: string,
  runId?: string,
): void {
  const rooms = [
    orgRoom(input.organizationId),
    threadRoom(input.threadId),
    memberRoom(input.memberId),
    ...(input.channelId ? [channelRoom(input.channelId)] : []),
  ];

  realtime.emit(
    SocketEventNames.memberAlertFailed,
    {
      organizationId: input.organizationId,
      memberId: input.memberId,
      channelId: input.channelId,
      threadId: input.threadId,
      messageId: input.messageId,
      byMemberId: input.byMemberId,
      reason: input.reason,
      stage,
      runId,
      error,
      occurredAt: new Date().toISOString(),
    },
    rooms,
  );
}

export async function wakeMemberWithFailureEvents(
  deps: WakeMemberDeps,
  input: WakeMemberInput,
): Promise<void> {
  let dispatch: Awaited<ReturnType<SpiritService['handleAlert']>>;
  try {
    dispatch = await deps.spirits.handleAlert({
      organizationId: input.organizationId,
      memberId: input.memberId,
      channelId: input.channelId,
      messageId: input.messageId,
      threadId: input.threadId,
      byMemberId: input.byMemberId,
      reason: input.reason,
      wakeReason: input.wakeReason,
    });
  } catch (error) {
    emitMemberAlertFailed(
      deps.realtime,
      input,
      'supervisor_dispatch',
      errMessage(error),
    );
    return;
  }

  // Emit a spirit-dispatch observability event regardless of kind so
  // `debounced` and `no-active-spirit` are no longer invisible.
  deps.realtime.emit(
    SocketEventNames.spiritDispatch,
    {
      organizationId: input.organizationId,
      memberId: input.memberId,
      kind: dispatch.kind,
      occurredAt: new Date().toISOString(),
    },
    [orgRoom(input.organizationId), memberRoom(input.memberId)],
  );

  if (dispatch.kind !== 'no-active-spirit') {
    return;
  }

  // L10 — serialize the findActiveRunForMemberThread → createRun
  // window per `(org, member, threadId)` so two near-simultaneous
  // broad-wake alerts can't both observe "no run" and each spawn
  // their own.
  await withCreateRunMutex(input, async () => {
    const activeRun = deps.repo.findActiveRunForMemberThread(
      input.organizationId,
      input.memberId,
      input.threadId,
    );
    if (activeRun) {
      enqueuePendingMemberAlert(input);
      return;
    }

    let run: Awaited<ReturnType<SpiritService['createRun']>>;
    try {
      run = await deps.runs.createRun({
        organizationId: input.organizationId,
        agentId: input.memberId,
        threadId: input.threadId,
        summary: `Wake (${input.wakeReason}) by ${input.byMemberId} on message ${input.messageId}`,
        wakeReason: input.wakeReason,
        sourceMessageId: input.messageId,
        byMemberId: input.byMemberId,
      });
    } catch (error) {
      emitMemberAlertFailed(deps.realtime, input, 'run_create', errMessage(error));
      return;
    }

    if (run.status === 'failed') {
      emitMemberAlertFailed(
        deps.realtime,
        input,
        'run_failed',
        run.summary || 'Run failed',
        run.id,
      );
    }
  });
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
    wakeReason: WakeReason;
  }) => Promise<void> | void = () => undefined;

  const conversations = new ConversationService(context.repo, context.realtime, {
    archiveStore: retention,
    onMemberAlerted: (input) => wakeMember(input),
  });

  // Late-bound resume callback — runs is constructed below and plugged in.
  let resumeRun: (
    organizationId: string,
    runId: string,
    allowRun?: boolean,
    approvalScope?: string,
  ) => Promise<unknown> | unknown = () => {
    throw new Error('resumeRun not wired');
  };

  let resumeInputRun: (
    organizationId: string,
    runId: string,
  ) => Promise<unknown> | unknown = () => {
    throw new Error('resumeInputRun not wired');
  };

  const approvalsImpl = new ApprovalService(
    context.repo,
    context.realtime,
    (orgId, runId, allowRun, approvalScope) =>
      resumeRun(orgId, runId, allowRun, approvalScope),
  );

  const approvalRequester: ApprovalRequester = {
    requestApproval: (input) => approvalsImpl.requestApproval(input),
  };

  const spiritModelResolver =
    context.spiritModelResolver ??
    createSpiritModelResolver(context.teamStore, context.repo);
  const goals = new GoalSystemService(context.repo, (orgId, runId) => resumeInputRun(orgId, runId));

  const innerTools = new ToolServiceImpl(
    context.teamStore,
    context.repo,
    approvalRequester,
    conversations,
    goals,
    context.realtime,
    context.mcpPool,
    spiritModelResolver,
  );

  const tools = createPermissionGatedToolService(
    innerTools,
    context.permissions,
    context.buildPermissionContext,
    approvalRequester.requestApproval,
    (invocation, approvalId) => {
      saveBlockedToolRunStep(
        context.repo,
        invocation,
        { status: 'waiting_for_approval', approvalId },
        'ok',
      );
    },
    (invocation, decision) => {
      saveBlockedToolRunStep(
        context.repo,
        invocation,
        {
          status: 'blocked',
          code: decision.code,
          error: decision.reason,
        },
        'blocked',
      );
    },
  );

  const ai = new AiService(context.teamStore, context.repo, tools);

  // Phase 2.C.1 — single shared in-memory registry. SpiritService writes
  // (spawn/retire/complete) and reads on every alert.
  const activeSpirits = new ActiveSpiritRegistry();

  const spirits = new SpiritService(
    context.teamStore,
    context.repo,
    context.realtime,
    tools,
    {
      conversations,
      ai,
      modelResolver: spiritModelResolver,
      registry: activeSpirits,
      mcpPool: context.mcpPool,
    },
  );

  // Plug SpiritService's MCP tool resolver into AiService now that
  // both exist. This is what gives the wake-run path (advanceRun ->
  // generateRunReply) access to MCP tools — without it, an agent with
  // a Playwright MCP attached wakes via @mention and answers "I don't
  // have a Playwright tool" because the AI-SDK palette and the system
  // prompt only ever saw the baseline channel tools.
  ai.setMcpToolResolver((ctx) => spirits.buildMcpToolDefinitions(ctx));
  const runs = spirits;
  resumeRun = async (orgId, runId, allowRun = true, approvalScope) =>
    spirits.resumeAfterApproval(orgId, runId, allowRun, approvalScope);
  resumeInputRun = async (orgId, runId) =>
    spirits.resumeAfterInput(orgId, runId);
  // Hydrate the in-memory registry from persisted spirits BEFORE alert
  // handling begins. Without this, a daemon restart would see an empty
  // registry and fall through to regular wake runs for already-active work.
  spirits.bootstrapAll();

  const wakeMemberDeps = {
    spirits,
    runs: spirits,
    realtime: context.realtime,
    repo: context.repo,
  };

  // Wake routing — replaces the simple `runs.createRun` fan-out.
  // The dispatch result is a discriminated union; only
  // `no-active-spirit` falls through to the regular run loop. A
  // `debounced` result means the supervisor intentionally suppressed
  // the alert (second mention in a 2s burst) — falling through there
  // would spawn a duplicate run that defeats the debounce.
  wakeMember = async (input) => {
    await wakeMemberWithFailureEvents(wakeMemberDeps, input);
  };

  const auth = new AuthService(context.repo);
  const bootstrap = new BootstrapService(context.repo, context.teamStore, auth);
  const onboarding = new OnboardingService(context.repo, context.teamStore);
  const scheduler = new SchedulerService(context.repo, conversations, context.realtime);
  const settings = new SettingsService(context.repo, context.teamStore);
  const workspaces = new WorkspaceService(
    context.repo,
    context.teamStore,
    context.workspaces,
    auth,
  );
  const taskSessions = new TaskSessionService(context.repo, conversations, spirits);
  const mcpRegistry = new McpRegistryService(context.repo);
  const pluginRegistry = new PluginRegistryService(
    context.repo,
    context.archiveRoot ?? process.env.UJIMA_HOME ?? process.cwd(),
  );

  // Bet 5 (Hermes review) — trajectory JSONL projection. One JSONL
  // line per completed run, gated by env var. Fire-and-forget, no
  // schema, no service dependencies: pure projection over runs +
  // run_steps + messages tables we already keep.
  const trajectory = new TrajectoryService();

  // Bet 1c (Hermes review) — post-turn memory-review counter.
  // Counter ticks per completed run; threshold-hit spawns a
  // restricted memory-only review fork (stub for follow-up wiring).
  const memoryReview = new MemoryReviewService(
    context.teamStore,
    context.repo,
    tools,
    ai,
  );

  // Late-bind the run-completed hook. The single hook routes to
  // drain-pending-member-alert, memory-review's turn counter, and
  // the trajectory writer.
  spirits.setRunCompletedHook(async (run) => {
    // Post the implement-prompt synchronously before any awaits so the
    // question is persisted in the same tick as the run-completed SSE
    // emit. Otherwise the frontend re-fetches questions before this
    // callback creates one and the prompt never appears.
    if (run.threadId) {
      try {
        const channelId = context.repo.getThread(run.organizationId, run.threadId)?.channelId;
        if (channelId) {
          const agentName = context.repo.getMember(run.organizationId, run.agentId)?.name || 'the agent';
          goals.maybePromptImplement({
            organizationId: run.organizationId,
            channelId,
            agentName,
            runId: run.id,
          });
        }
      } catch {
        // best-effort: question posting is non-critical
      }
    }

    await drainPendingMemberAlertAfterRun(run, (pending) =>
      wakeMemberWithFailureEvents(wakeMemberDeps, pending),
    );
    try {
      const team = context.teamStore.getTeam(run.organizationId);
      const workspaceRoot = team?.workspace.root;
      if (workspaceRoot) {
        void trajectory.record({ run, repo: context.repo, workspaceRoot });
      }
    } catch {
      // best-effort
    }

    // Memory-review counter — only ticks for publishing terminators
    // so empty wakes and silent acks don't burn the nudge.
    const isPublishing =
      run.terminatingTool === 'channel.reply' ||
      run.terminatingTool === 'channel.post' ||
      run.terminatingTool === 'channel.dm' ||
      run.terminatingTool === 'message';
    if (isPublishing && run.threadId) {
      const channelId = context.repo.getThread(run.organizationId, run.threadId)?.channelId;
      memoryReview.noteTurn({
        organizationId: run.organizationId,
        memberId: run.agentId,
        channelId,
        runId: run.id,
      });
    }
  });

  return {
    ai,
    tools,
    conversations,
    retention,
    runs,
    approvals: approvalsImpl,
    auth,
    bootstrap,
    teamStore: context.teamStore,
    onboarding,
    settings,
    workspaces,
    taskSessions,
    goals,
    spirits,
    scheduler,
    activeSpirits,
    mcpRegistry,
    pluginRegistry,
  };
}
