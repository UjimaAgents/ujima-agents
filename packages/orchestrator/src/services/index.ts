import type { PermissionMiddleware } from '@ujima/permissions';
import {
  AGENT_KIND,
  SocketEventNames,
  channelRoom,
  getDirectMessageThreadId,
  memberRoom,
  orgRoom,
  threadRoom,
  type MemberAlertFailureStage,
  type Message,
  type WakeReason,
} from '@ujima/shared';
import { AsyncMutex } from '../utils/async-mutex.js';
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
import { createConnectorAuditWriter } from './connector-audit.js';
import { findRegistryEntry } from '@ujima/mcp-client';
import { join } from 'node:path';
import { findRegistryMatch } from './connector-catalog.js';
import { captureToolResultAttachments, cleanupExpiredAgentAttachments } from './agent-attachment-capture.js';
import type { AttachmentCaptureClosure } from './connector-spawn-v2.js';
import { createTierCurationService, type TierCurationService } from './tier-curation.js';
import { GovernanceService } from './governance-service.js';
import { PluginRegistryService } from './plugin-registry.js';
import { OnboardingService } from './onboarding.js';
import {
  drainPendingMemberAlertAfterRun,
  enqueuePendingMemberAlert,
  hasPendingMemberAlert,
  type PendingMemberAlert,
} from './pending-member-alerts.js';
import type { ApiRepository } from './repository-reader.js';
import { SettingsService } from './settings.js';
import { WorkspaceService, type WorkspaceCatalog } from './workspace.js';
import { SpiritService, type ModelResolver, type SpiritMcpPool } from './spirit.js';
import { SchedulerService } from './scheduler.js';
import { NotificationService } from './notification.js';
import { TaskSessionService } from './task-session.js';
import { filterVisibleMessages } from '../utils/message-visibility.js';
import type { TeamStore } from './team-store.js';
import {
  createPermissionGatedToolService,
  saveBlockedToolRunStep,
  type PermissionContextBuilder,
  type ToolService,
} from './tool-service.js';
import { ToolServiceImpl, type ApprovalRequester } from './tool-service-impl.js';
import { createSpiritModelResolver } from '../utils/create-spirit-model-resolver.js';
import type { AgentDelegateResult } from '../tools/types.js';

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
export {
  GoalSystemService,
  IMPLEMENT_QUESTION_OPTION,
  IMPLEMENT_QUESTION_TEXT,
} from './goal-system.js';
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
export { createTierCurationService, type TierCurationService } from './tier-curation.js';
export type {
  AttachMcpInput,
  CreateMcpServerInput,
  ImportMcpServersInput,
  ImportMcpServersResult,
  TestMcpResult,
  UpdateMcpServerInput,
} from './mcp-registry.js';
export { GovernanceService } from './governance-service.js';
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
  notifications: NotificationService;
  taskSessions: TaskSessionService;
  goals: GoalSystemService;
  spirits: SpiritService;
  activeSpirits: ActiveSpiritRegistry;
  mcpRegistry: McpRegistryService;
  tierCuration: TierCurationService;
  governance: GovernanceService;
  pluginRegistry: PluginRegistryService;
}

type WakeMemberInput = PendingMemberAlert;
const AGENT_DELEGATE_POLL_INTERVAL_MS = 500;
const AGENT_DELEGATE_TIMEOUT_MS = 120_000;

interface WakeMemberDeps {
  spirits: Pick<SpiritService, 'handleAlert'>;
  runs: Pick<SpiritService, 'createRun'>;
  realtime: Pick<ApiServiceContext['realtime'], 'emit'>;
  repo: Pick<ApiRepository, 'findActiveRunForMemberThread' | 'saveRun'>;
}

const createRunMutex = new AsyncMutex();

function createRunMutexKey(input: WakeMemberInput): string {
  return `${input.organizationId}:${input.memberId}:${input.threadId}`;
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function latestDelegateReply(
  repo: Pick<ApiRepository, 'listMessages'>,
  organizationId: string,
  threadId: string,
  agentId: string,
  after: { createdAt: string; id: string },
) {
  const messages = filterVisibleMessages(repo.listMessages(organizationId, threadId, undefined, 100).data);
  const anchorIndex = messages.findIndex((message) => message.id === after.id);
  const candidates = anchorIndex >= 0
    ? messages.slice(anchorIndex + 1)
    : messages.filter((message) => message.createdAt > after.createdAt);
  return candidates.filter((message) => message.senderId === agentId).at(-1);
}

function delegateRunForMessage(
  repo: Pick<ApiRepository, 'listThreadRuns'>,
  organizationId: string,
  threadId: string,
  agentId: string,
  messageId: string,
): ReturnType<ApiRepository['listThreadRuns']>['data'][number] | undefined {
  return repo
    .listThreadRuns(organizationId, threadId, undefined, 25)
    .data.find((candidate) => candidate.agentId === agentId && candidate.sourceMessageId === messageId);
}

function runIsTerminal(status: string): boolean {
  return !['queued', 'running', 'waiting_for_approval', 'waiting_for_input'].includes(status);
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

  if (dispatch.kind === 'debounced') {
    enqueuePendingMemberAlert(input);
    return;
  }

  if (dispatch.kind !== 'no-active-spirit') {
    return;
  }

  // L10 — serialize the findActiveRunForMemberThread → createRun
  // window per `(org, member, threadId)` so two near-simultaneous
  // broad-wake alerts can't both observe "no run" and each spawn
  // their own.
  await createRunMutex.run(createRunMutexKey(input), async () => {
    const activeRun = deps.repo.findActiveRunForMemberThread(
      input.organizationId,
      input.memberId,
      input.threadId,
    );
    if (activeRun) {
      if (input.wakeReason === 'mention' && activeRun.wakeReason !== 'mention') {
        deps.repo.saveRun({
          ...activeRun,
          wakeReason: 'mention',
          sourceMessageId: input.messageId,
          byMemberId: input.byMemberId,
          summary: `Wake (mention) by ${input.byMemberId} on message ${input.messageId}`,
        });
      } else {
        enqueuePendingMemberAlert(input);
      }
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

async function waitForAgentDelegateReply(input: {
  repo: ApiRepository;
  organizationId: string;
  agentId: string;
  agentName: string;
  threadId: string;
  delegateMessage: { id: string; createdAt: string };
  parentRunId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<AgentDelegateResult> {
  let startedAt = Date.now();
  const timeoutMs = input.timeoutMs ?? AGENT_DELEGATE_TIMEOUT_MS;
  const pollIntervalMs = input.pollIntervalMs ?? AGENT_DELEGATE_POLL_INTERVAL_MS;
  while (Date.now() - startedAt < timeoutMs) {
    const isAlertQueued = hasPendingMemberAlert(
      input.organizationId,
      input.agentId,
      input.threadId,
      input.delegateMessage.id,
    );
    if (isAlertQueued) {
      startedAt = Date.now();
    }
    const reply = latestDelegateReply(
      input.repo,
      input.organizationId,
      input.threadId,
      input.agentId,
      input.delegateMessage,
    );
    const activeRun = input.repo.findActiveRunForMemberThread(
      input.organizationId,
      input.agentId,
      input.threadId,
    );
    const blockingRun = activeRun?.id === input.parentRunId ? null : activeRun;
    const delegateRun = delegateRunForMessage(
      input.repo,
      input.organizationId,
      input.threadId,
      input.agentId,
      input.delegateMessage.id,
    );
    if (delegateRun?.status === 'failed' || delegateRun?.status === 'cancelled') {
      return {
        status: 'delegate_failed',
        agent: input.agentName,
        agent_id: input.agentId,
        thread_id: input.threadId,
        message_id: input.delegateMessage.id,
        run_status: delegateRun.status,
        error: delegateRun.summary,
      };
    }
    if (reply && !blockingRun) {
      return {
        status: 'completed',
        agent: input.agentName,
        agent_id: input.agentId,
        thread_id: input.threadId,
        message_id: input.delegateMessage.id,
        reply_id: reply.id,
        reply_content: reply.content,
      };
    }
    if (
      !reply &&
      !blockingRun &&
      delegateRun &&
      runIsTerminal(delegateRun.status)
    ) {
      return {
        status: 'no_reply',
        agent: input.agentName,
        agent_id: input.agentId,
        thread_id: input.threadId,
        message_id: input.delegateMessage.id,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return {
    status: 'timed_out',
    agent: input.agentName,
    agent_id: input.agentId,
    thread_id: input.threadId,
    message_id: input.delegateMessage.id,
  };
}

export async function runAgentDelegateTurn(input: {
  repo: ApiRepository;
  conversations: ConversationService;
  wakeMember: (alert: {
    organizationId: string;
    memberId: string;
    threadId: string;
    channelId?: string;
    messageId: string;
    byMemberId: string;
    reason: string;
    wakeReason: WakeReason;
  }) => Promise<void> | void;
  createRun: (run: {
    organizationId: string;
    agentId: string;
    threadId: string;
    summary?: string;
    wakeReason?: WakeReason;
    sourceMessageId?: string;
    byMemberId?: string;
  }) => Promise<unknown>;
  organizationId: string;
  fromMemberId: string;
  to: string;
  message: string;
  runId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<AgentDelegateResult> {
  const members = input.repo.listMembers(input.organizationId);
  const activeAgents = members.filter(
    (member) => member.kind === AGENT_KIND && !member.retiredAt,
  );
  const target = activeAgents.find(
    (member) => member.id === input.to || member.name === input.to,
  );
  if (!target) {
    const names = activeAgents.map((member) => member.name).join(', ');
    const retiredMatch = members.find(
      (member) =>
        member.kind === AGENT_KIND &&
        member.retiredAt &&
        (member.id === input.to || member.name === input.to),
    );
    if (retiredMatch) {
      throw new Error(
        `Agent "${input.to}" has been retired. Available agents: ${names}`,
      );
    }
    throw new Error(`Agent "${input.to}" not found. Available agents: ${names}`);
  }

  const threadId = getDirectMessageThreadId(input.fromMemberId, target.id);
  const delegateMessage = input.conversations.sendDirectMessage({
    organizationId: input.organizationId,
    senderId: input.fromMemberId,
    recipientId: target.id,
    content: input.message,
    ignore: true,
    metadata: { runId: input.runId, delegate: { parentRunId: input.runId } },
  });

  await input.wakeMember({
    organizationId: input.organizationId,
    memberId: target.id,
    threadId,
    channelId: threadId,
    messageId: delegateMessage.id,
    byMemberId: input.fromMemberId,
    reason: 'dm',
    wakeReason: 'dm',
  });

  return waitForAgentDelegateReply({
    repo: input.repo,
    organizationId: input.organizationId,
    agentId: target.id,
    agentName: target.name,
    threadId,
    delegateMessage,
    parentRunId: input.runId,
    timeoutMs: input.timeoutMs,
    pollIntervalMs: input.pollIntervalMs,
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
  let createDelegateRun: Parameters<typeof runAgentDelegateTurn>[0]['createRun'] = async () => {
    throw new Error('createDelegateRun not wired');
  };

  // eslint-disable-next-line prefer-const
  let handleMessagePublished: ((msg: Message) => void) | undefined;
  const conversations = new ConversationService(context.repo, context.realtime, {
    archiveStore: retention,
    onMemberAlerted: (input) => wakeMember(input),
    onMessagePublished: (msg) => handleMessagePublished?.(msg),
  });

  const delegateAgentTurn = async (input: {
    organizationId: string;
    fromMemberId: string;
    to: string;
    message: string;
    runId: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<AgentDelegateResult> =>
    runAgentDelegateTurn({
      repo: context.repo,
      conversations,
      wakeMember,
      createRun: createDelegateRun,
      ...input,
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
  const goals = new GoalSystemService(
    context.repo,
    (orgId, runId) => resumeInputRun(orgId, runId),
    conversations,
  );

  // storagePath column is canonical `agent-generated/<org>/<run>/<id>.<ext>`,
  // joined against attachmentStoreRoot by the web API + LRU sweeper.
  // Writers join the bare path against the agent-generated subroot.
  const ujimaHome = context.archiveRoot ?? process.env.UJIMA_HOME ?? process.cwd();
  const attachmentStoreRoot = join(ujimaHome, 'attachments');
  const agentAttachmentRoot = join(attachmentStoreRoot, 'agent-generated');

  const innerTools = new ToolServiceImpl(
    context.teamStore,
    context.repo,
    approvalRequester,
    conversations,
    goals,
    context.realtime,
    delegateAgentTurn,
    context.mcpPool,
    spiritModelResolver,
    undefined,
    agentAttachmentRoot,
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

  // Shared audit writer for agent-attachment events + the existing
  // attachment-request flow. Declared early so the capture closure
  // below can pass it in.
  const attachmentAuditWriter = createConnectorAuditWriter({ repo: context.repo });

  const attachmentCaptureClosure: AttachmentCaptureClosure = (input) => {
    const server = context.repo.getMcpServer(input.organizationId, input.serverId);
    const registryHint = server ? findRegistryMatch(server)?.capturesAttachments : undefined;
    return captureToolResultAttachments(
      {
        repo: context.repo,
        agentAttachmentRoot,
        attachmentStoreRoot,
        audit: attachmentAuditWriter,
      },
      {
        organizationId: input.organizationId,
        runId: input.runId,
        memberId: input.memberId,
        serverId: input.serverId,
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        toolResult: input.toolResult,
        registryHint,
      },
    );
  };

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
      // PR 11 — wire the §17.5.6 attachment-request surface so
      // request_attachment (registered in V2 spawn) can fire an
      // approval card via the active ApprovalService.
      attachmentApprovalRequester: (input) =>
        approvalsImpl.requestAttachmentApproval(input),
      attachmentCapture: attachmentCaptureClosure,
    },
  );
  createDelegateRun = (run) => spirits.createRun(run);

  // Plug SpiritService's MCP tool resolver into AiService now that
  // both exist. This is what gives the wake-run path (advanceRun ->
  // generateRunReply) access to MCP tools — without it, an agent with
  // a Playwright MCP attached wakes via @mention and answers "I don't
  // have a Playwright tool" because the AI-SDK palette and the system
  // prompt only ever saw the baseline channel tools.
  // Routes through the §3.5 rule 3 flag gate: dispatch-enabled orgs
  // get the V2 spawn (catalog + meta-tools + §12 audit emitters);
  // others get byte-for-byte legacy. Without this the wake-run path
  // bypassed the flag and DM → agent calls produced zero connector_*
  // events even when V2 was on.
  ai.setMcpToolResolver((ctx) => spirits.buildMcpToolDefinitionsRouted(ctx));
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
  const scheduler = new SchedulerService(context.repo, conversations, context.realtime, {
    onTick: async () => {
      await goals.sweepAllPendingTasks();
      // Agent-attachments LRU pass. Best-effort — wrapped so a
      // sweep failure doesn't kill the scheduler tick (which is
      // mission-critical for goal scheduling).
      try {
        cleanupExpiredAgentAttachments({
          repo: context.repo,
          attachmentStoreRoot,
        });
      } catch (err) {
        console.warn('[agent-attachment-cleanup] sweep threw', err);
      }
    },
  });
  const notifications = new NotificationService(context.repo);
  handleMessagePublished = (msg) => {
    if (msg.senderId !== '__ujima_scheduler__') {
      const id = msg.channelId ?? msg.threadId;
      if (!id) return;
      let channelName = id;
      if (id.startsWith('self:')) {
        const m = context.repo.getMember(msg.organizationId, id.slice(5));
        channelName = m ? `${m.name} (self)` : 'Self';
      } else if (id.startsWith('dm:')) {
        const parts = id.split(':');
        const other = parts[2] || parts[1] || '';
        const m = other ? context.repo.getMember(msg.organizationId, other) : null;
        channelName = m ? `DM with @${m.name}` : 'DM';
      } else {
        const ch = context.repo.getChannel(msg.organizationId, id);
        if (ch?.name) channelName = ch.name;
      }
      void notifications.notifyMessage({
        organizationId: msg.organizationId,
        channelName,
        senderName: context.repo.getMember(msg.organizationId, msg.senderId)?.name ?? msg.senderId,
        content: msg.content ?? '',
      });
    }
  };
  notifications.setApprovalResolver(async (orgId, approvalId, status) => {
    await approvalsImpl.resolveApproval({ organizationId: orgId, approvalId, status });
  });
  approvalsImpl.setOnApprovalRequested((input) => {
    void notifications.notifyApproval({
      organizationId: input.organizationId,
      requesterName:
        context.repo.getMember(input.organizationId, input.requestedBy)?.name ??
        input.requestedBy,
      resourceType: input.resourceType,
      action: input.action,
      resourcePath: input.resourcePath,
      approvalId: input.approvalId,
    });
  });
  const settings = new SettingsService(context.repo, context.teamStore, approvalsImpl);
  const workspaces = new WorkspaceService(
    context.repo,
    context.teamStore,
    context.workspaces,
    auth,
  );
  const taskSessions = new TaskSessionService(context.repo, conversations, spirits);
  const mcpRegistry = new McpRegistryService(context.repo);

  // PR 11 — wire the §17.5.6 attachment-request resolution handler.
  // On approve, write the attachment row (channel or per-agent) via
  // the same McpRegistryService surface the settings UI uses, so the
  // audit + UNIQUE-constraint shape stays identical. On reject, emit
  // the attachment_request_resolved audit row only.
  approvalsImpl.setAttachmentApprovalResolver((input) => {
    // PR 11 (bot fix) — search_catalog returns `registry:<entryId>`
    // synthetic ids for marketplace entries the org has never
    // instantiated. Those ids can't be passed to
    // mcpRegistry.attach{,ServerToChannel} because requireServer
    // would reject them — the attach surface needs a real
    // mcp_servers row. Materialise the registry entry into a real
    // org MCP first, then use the returned serverId for the
    // attachment.
    //
    // The instantiation is scope-discipline-conscious: we do it
    // ONLY when the attachment is being approved (input.approved
    // === true). A rejection should never spawn a server row, and
    // a previously-instantiated entry stays untouched.
    //
    // Failure paths: if the registry entry is missing (unknown id)
    // OR `create()` rejects (name clash, validation), the outer
    // try/catch logs a warning and the approval stays resolved
    // without an attachment row. The operator sees the resolved
    // approval in the activity feed without the connector — they
    // can retry the attach manually via the settings UI.
    // PR 11 (bot fix) — split attach vs audit handling. Earlier this
    // wrapped both in one try/catch and silently swallowed attach
    // failures (registry instantiation rejection, name clash,
    // duplicate row, transient repo error). The approval was already
    // resolved by then, so the run resumed but the operator had no
    // surfaced error and the attachment_request_resolved audit row
    // never landed. Now: attach runs in its own try; whether it
    // succeeded or threw, the audit row ALWAYS lands with a
    // resolution value that distinguishes the outcomes.
    let serverIdForAttach = input.payload.serverId;
    let attachOk = false;
    let attachError: Error | undefined;
    if (input.approved) {
      try {
        if (serverIdForAttach.startsWith('registry:')) {
          const registryId = serverIdForAttach.slice('registry:'.length);
          const entry = findRegistryEntry(registryId);
          if (!entry) {
            throw new Error(`Registry entry not found: ${registryId}`);
          }
          // Re-check by URL/command in case another path already
          // instantiated this entry between search_catalog and
          // resolve-approval. buildSearchCorpus dedupes at search
          // time but a parallel attach via the settings UI could
          // race in between.
          const existing = context.repo
            .listMcpServers(input.organizationId)
            .find((s) => findRegistryMatch(s)?.id === entry.id);
          if (existing) {
            serverIdForAttach = existing.id;
          } else {
            const created = mcpRegistry.create({
              organizationId: input.organizationId,
              name: entry.name,
              description: entry.description,
              category: entry.category,
              transport: entry.defaults.transport,
              command: entry.defaults.command,
              args: entry.defaults.args,
              url: entry.defaults.url,
              isolation: entry.defaults.isolation,
              createdBy: input.resolverMemberId ?? 'system:attachment_request',
            });
            serverIdForAttach = created.id;
            // Auto-test the freshly instantiated MCP so the tool cache
            // populates without forcing the operator into Settings →
            // MCPs → Test. For credential-less connectors (fetch,
            // memory, sequential-thinking, etc.) this just works — the
            // listTools call returns the inventory and saveMcpToolCache
            // writes it. For connectors that need secrets (GitHub PAT,
            // Slack OAuth, etc.) the listTools call will fail; we log
            // a warn and the operator still gets the attachment row
            // PLUS a settings-UI affordance to fill in creds. Without
            // this, the model attached the connector but immediately
            // told the operator to "run Test in Settings" — exactly
            // the failure mode the live test caught.
            //
            // Fire-and-forget: mcpRegistry.test is async but the
            // resolver callback is sync. .catch swallows the rejection
            // (already logged inside test()) so an unhandled rejection
            // doesn't blow up the resolver. The test result lands in
            // the cache before the agent's NEXT spawn that hits this
            // server, which is when get_connector_tools would consult
            // the cache.
            void mcpRegistry
              .test(input.organizationId, created.id)
              .catch((err) => {
                console.warn(
                  `[attachment-approval] auto-test failed for instantiated MCP "${entry.name}" — operator must complete setup via Settings → MCPs`,
                  err,
                );
              });
          }
        }
        if (input.payload.target === 'channel') {
          mcpRegistry.attachServerToChannel({
            organizationId: input.organizationId,
            channelId: input.payload.targetId,
            mcpServerId: serverIdForAttach,
          });
        } else {
          mcpRegistry.attach({
            organizationId: input.organizationId,
            memberId: input.payload.targetId,
            mcpServerId: serverIdForAttach,
          });
        }
        attachOk = true;
      } catch (err) {
        attachError = err instanceof Error ? err : new Error(String(err));
        console.warn(
          '[attachment-approval] attach failed; approval already resolved, audit will fire with resolution=attach_failed',
          attachError,
        );
      }
    }

    // Audit emit ALWAYS runs, in its own try. The connector-audit
    // writer is itself best-effort (PR 8) so the inner saveAuditEvent
    // can drop without throwing, but we still wrap defensively here
    // so a future writer-level throw can't take down the closure.
    try {
      attachmentAuditWriter.attachmentRequestResolved({
        organizationId: input.organizationId,
        resolverMemberId: input.resolverMemberId,
        approvalId: input.approvalId,
        ...(input.runId ? { runId: input.runId } : {}),
        // Audit carries the RESOLVED serverId (post-instantiation
        // for registry entries) so operators can grep their audit
        // log without translating registry:<id> synthetic ids
        // separately. On attach failure, this is the
        // partially-resolved id (the registry instantiation may
        // have succeeded before the actual attach threw).
        serverId: serverIdForAttach,
        target: input.payload.target,
        targetId: input.payload.targetId,
        resolution: !input.approved
          ? 'rejected'
          : attachOk
            // PR 11 ships single-grant approval — the action grant
            // defaults to "Allow once" and re-prompts at the
            // standard §5.2 card on the next invoke. PR 11.5 will
            // add the two-grant card variant; until then the audit
            // value is always `attached_allow_action` for
            // successful approvals.
            ? 'attached_allow_action'
            : 'attach_failed',
      });
    } catch (auditErr) {
      console.warn(
        '[attachment-approval] audit row emit failed; attach state preserved in attachment row',
        auditErr,
      );
    }
  });

  const tierCuration = createTierCurationService({ repo: context.repo });
  const governance = new GovernanceService(context.repo);
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
    notifications,
    activeSpirits,
    mcpRegistry,
    tierCuration,
    governance,
    pluginRegistry,
  };
}
