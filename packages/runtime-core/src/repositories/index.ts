import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import type {
  AgentAttachment,
  AgentMcpAttachment,
  AgentToolAttachment,
  ApprovalRequest,
  AuthSession,
  AuthUser,
  AuditEvent,
  Attachment,
  Channel,
  ChannelKind,
  ChannelMcpAttachment,
  ChannelMemberMode,
  ChannelMemberSettings,
  ConfigFieldOwnership,
  ConversationThread,
  DecisionLogEntry,
  GovernancePolicy,
  ProcedureRevision,
  RunProcedureApplied,
  McpServer,
  McpToolCache,
  McpToolClassification,
  Member,
  MemoryEntry,
  MemoryEntryKind,
  Message,
  MessageMention,
  Organization,
  RunState,
  RunStep,
  ScheduledJob,
  SelfImprovementReview,
  Spirit,
  SpiritRole,
  TaskSession,
  TaskSessionStatus,
  TierCurationSuggestion,
  Goal,
  GoalTask,
  GoalTaskStatus,
  InteractiveQuestion,
  WorkspaceFile,
  WorkspaceMember,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowNodeRun,
} from '@ujima/shared';
import {
  findAuthUsersByEmail as readAuthUsersByEmail,
  getAuthSessionByTokenHash as readAuthSessionByTokenHash,
  getAuthUserById as readAuthUserById,
  getAuthUserByMember as readAuthUserByMember,
  getAuthUserCredentials as readAuthUserCredentials,
  revokeAuthSession as writeAuthSessionRevoke,
  saveAuthSession as writeAuthSession,
  saveAuthUser as writeAuthUser,
  touchAuthSession as writeAuthSessionTouch,
  type StoredAuthSession,
  type StoredAuthUser,
} from './auth.js';
import {
  getApproval as readApproval,
  deleteApproval as deleteApprovalRecord,
  hasApprovalGrant as readApprovalGrant,
  listPendingApprovals as readPendingApprovals,
  resolveApproval as resolveApprovalRecord,
  saveApproval as writeApproval,
} from './approvals.js';
import { listAuditEvents as readAuditEvents, saveAuditEvent as writeAuditEvent } from './audit.js';
import {
  listTierCurationSuggestions as readTierCurationSuggestions,
  saveTierCurationSuggestion as writeTierCurationSuggestion,
  updateTierCurationSuggestionStatus as mutateTierCurationSuggestionStatus,
} from './tier-curation.js';
import {
  getBootstrapSnapshot as readBootstrapSnapshot,
  type BootstrapSnapshot,
} from './bootstrap.js';
import {
  deleteChannel as removeChannel,
  getChannel as readChannel,
  listAllChannels as readAllChannels,
  listChannels as readChannels,
  saveChannel as writeChannel,
  setChannelMembers as writeChannelMembers,
  setChannelMemberMode as writeChannelMemberMode,
  getChannelMemberMode as readChannelMemberMode,
  listChannelMemberModes as readChannelMemberModes,
  listChannelMemberModesForChannel as readChannelMemberModesForChannel,
  removeChannelMemberMode as deleteChannelMemberMode,
  type PaginatedChannels,
} from './channels.js';
import {
  getConfigFieldOwnership as readConfigFieldOwnership,
  listConfigFieldOwnership as readConfigFieldOwnershipList,
  saveConfigFieldOwnership as writeConfigFieldOwnership,
} from './config-ownership.js';
import {
  getMember as readMember,
  listMembers as readMembers,
  saveMember as writeMember,
} from './members.js';
import {
  getWorkspaceMember as readWorkspaceMember,
  listWorkspaceMembers as readWorkspaceMembers,
  saveWorkspaceMember as writeWorkspaceMember,
} from './workspace-members.js';
import {
  deleteMessageMentions as removeMessageMentions,
  listMessageMentions as readMessageMentions,
  replaceMessageMentions as writeMessageMentions,
} from './message-mentions.js';
import {
  getConversationRead as readConversationRead,
  saveConversationRead as writeConversationRead,
} from './conversation-reads.js';
import {
  deleteAttachment as removeAttachment,
  getAttachment as readAttachment,
  linkAttachmentsToMessage as writeMessageAttachments,
  listMessageAttachments as readMessageAttachments,
  saveAttachment as writeAttachment,
} from './attachments.js';
import {
  deleteMessages as removeMessages,
  findMessageByClientId as readMessageByClientId,
  getLatestHumanMessageInThread as readLatestHumanMessageInThread,
  getMessage as readMessage,
  countMessagesSince as readMessageCountSince,
  countUncompactedMessageChars as readUncompactedMessageChars,
  listMessages as readMessages,
  listChannelMessages as readChannelMessages,
  saveMessage as writeMessage,
  searchChannelMessages as searchMessagesByChannel,
  updateMessage as writeMessageUpdate,
  type PaginatedMessages,
} from './messages.js';
import type { SecretStore } from '../secret-store.js';
import { createInMemorySecretStore } from '../secret-store.js';
import {
  deleteWorkspaceSetting as removeWorkspaceSetting,
  deleteProviderCredential as removeProviderCredential,
  findOrganizationIdByWorkspaceSetting as readOrganizationIdByWorkspaceSetting,
  getWorkspaceSetting as readWorkspaceSetting,
  getLatestOrganization as readLatestOrganization,
  getOrganization as readOrganization,
  getProviderCredential as readProviderCredential,
  listOrganizations as readOrganizations,
  listOrganizationsForUser as readOrganizationsForUser,
  listOrganizationsWithSignIn as readOrganizationsWithSignIn,
  organizationHasAuthUsers as readOrganizationHasAuthUsers,
  deleteOrganizationData as removeOrganizationData,
  listProviderCredentials as readProviderCredentials,
  saveWorkspaceSetting as writeWorkspaceSetting,
  saveOrganization as writeOrganization,
  saveProviderCredential as writeProviderCredential,
} from './organization.js';
import {
  findActiveRunForMemberThread as readActiveRunForMemberThread,
  getRun as readRun,
  listActiveRuns as readActiveRuns,
  listRuns as readRuns,
  listThreadRuns as readThreadRuns,
  saveRun as writeRun,
  type PaginatedRuns,
} from './runs.js';
import {
  listRunSteps as readRunSteps,
  saveRunStep as writeRunStep,
} from './run-steps.js';
import {
  deleteWorkflowDefinition as removeWorkflowDefinition,
  getWorkflowDefinition as readWorkflowDefinition,
  getWorkflowDefinitionByName as readWorkflowDefinitionByName,
  getWorkflowNodeRun as readWorkflowNodeRun,
  getWorkflowNodeRunByNode as readWorkflowNodeRunByNode,
  getWorkflowRun as readWorkflowRun,
  listWorkflowDefinitions as readWorkflowDefinitions,
  listWorkflowNodeRuns as readWorkflowNodeRuns,
  listWorkflowRuns as readWorkflowRuns,
  listWorkflowRunsByStatus as readWorkflowRunsByStatus,
  saveWorkflowDefinition as writeWorkflowDefinition,
  saveWorkflowNodeRun as writeWorkflowNodeRun,
  saveWorkflowRun as writeWorkflowRun,
} from './workflow-store.js';
import {
  findOpenTaskSessionForChannel as readOpenTaskSessionForChannel,
  getTaskSession as readTaskSession,
  getTaskSessionByChannel as readTaskSessionByChannel,
  getTaskSessionBySlug as readTaskSessionBySlug,
  listTaskSessions as readTaskSessions,
  saveTaskSession as writeTaskSession,
  updateTaskSessionStatus as writeTaskSessionStatus,
  type PaginatedTaskSessions,
} from './task-sessions.js';
import {
  deleteGoalTasks as removeGoalTasks,
  getGoal as readGoal,
  getGoalByChannel as readGoalByChannel,
  getGoalTask as readGoalTask,
  getInteractiveQuestion as readInteractiveQuestion,
  listGoalTasks as readGoalTasks,
  listGoalTasksByOrganization as readAllGoalTasks,
  listGoalsByChannel as readGoalsByChannel,
  listGoals as readGoals,
  listPendingInteractiveQuestions as readPendingInteractiveQuestions,
  listInteractiveQuestionsByRunId as readInteractiveQuestionsByRunId,
  saveGoal as writeGoal,
  saveGoalTask as writeGoalTask,
  saveInteractiveQuestion as writeInteractiveQuestion,
  setGoalTaskLastNudgedAt as writeGoalTaskLastNudgedAt,
  updateGoalTaskStatus as writeGoalTaskStatus,
} from './goals.js';
import {
  deleteExpiredMemoryEntries as removeExpiredMemoryEntries,
  deleteMemoryEntry as removeMemoryEntry,
  recallMemoryEntries as readMemoryEntries,
  upsertMemoryEntry as writeMemoryEntry,
} from './memory-entries.js';
import {
  deleteWorkspaceFile as removeWorkspaceFile,
  searchWorkspaceFiles as searchWorkspaceFilesByQuery,
  upsertWorkspaceFile as writeWorkspaceFile,
  type WorkspaceFileSearchHit,
} from './workspace-files.js';
import {
  appendDecisionLogEntry as writeDecisionLogEntry,
  findDecisionBySourceMessage as readDecisionBySourceMessage,
  listDecisionLogForChannel as readDecisionLogForChannel,
} from './decision-log.js';
import {
  appendProcedureRevision as writeProcedureRevision,
  listProcedureRevisions as readProcedureRevisions,
  listRunProceduresApplied as readRunProceduresApplied,
  recordRunProceduresApplied as writeRunProceduresApplied,
} from './procedure-revisions.js';
import {
  ensureThread as ensureThreadRecord,
  getThread as readThread,
  saveThread as writeThread,
  setThreadMembers as writeThreadMembers,
} from './threads.js';
import {
  getSpirit as readSpirit,
  getSpiritByRunId as readSpiritByRunId,
  getSpiritByTriple as readSpiritByTriple,
  listActiveSpiritsForMember as readActiveSpiritsForMember,
  listSpiritsForSession as readSpiritsForSession,
  saveSpirit as writeSpirit,
} from './spirits.js';
import {
  deleteScheduledJob as removeScheduledJob,
  getScheduledJob as readScheduledJob,
  listDueJobsGlobally as readDueJobsGlobally,
  listScheduledJobs as readScheduledJobs,
  saveScheduledJob as writeScheduledJob,
} from './scheduled-jobs.js';
import {
  deleteSelfImprovementReview as removeSelfImprovementReview,
  getSelfImprovementReview as readSelfImprovementReview,
  listSelfImprovementReviews as readSelfImprovementReviews,
  listSelfImprovementReviewsByRun as readSelfImprovementReviewsByRun,
  saveSelfImprovementReview as writeSelfImprovementReview,
} from './self-improvement-reviews.js';
import {
  deleteMemory as removeMemory,
  getMemory as readMemory,
  listMemories as readMemories,
  listOrgMemories as readOrgMemories,
  saveMemory as writeMemory,
} from './memory.js';
import {
  deleteNotificationChannel as removeNotificationChannel,
  getNotificationChannel as readNotificationChannel,
  listNotificationChannels as readNotificationChannels,
  saveNotificationChannel as writeNotificationChannel,
  type NotificationChannelRow,
} from './notification-channels.js';
import {
  deleteAgentMcpAttachment as removeAgentMcpAttachment,
  deleteMcpServer as removeMcpServer,
  getMcpServer as readMcpServer,
  getMcpServerByName as readMcpServerByName,
  getMcpToolCache as readMcpToolCache,
  listAgentMcpAttachments as readAgentMcpAttachments,
  listAttachedServersForSpirit as readAttachedServersForSpirit,
  listMcpServerAttachments as readMcpServerAttachments,
  listMcpServers as readMcpServers,
  saveAgentMcpAttachment as writeAgentMcpAttachment,
  saveMcpServer as writeMcpServer,
  saveMcpToolCache as writeMcpToolCache,
  updateAttachmentTier as mutateAttachmentTier,
} from './mcp-servers.js';
import {
  deleteChannelMcpAttachment as removeChannelMcpAttachment,
  listChannelMcpAttachments as readChannelMcpAttachments,
  listChannelMcpAttachmentsForMember as readChannelMcpAttachmentsForMember,
  saveChannelMcpAttachment as writeChannelMcpAttachment,
  updateChannelAttachmentTier as mutateChannelAttachmentTier,
} from './channel-mcp-attachments.js';
import {
  saveAgentAttachment as writeAgentAttachment,
  getAgentAttachment as readAgentAttachment,
  findAgentAttachmentByToolCall as readAgentAttachmentByToolCall,
  pinAgentAttachmentToMessage as mutatePinAgentAttachmentToMessage,
  listAgentAttachmentsForRun as readAgentAttachmentsForRun,
  listExpiredUnpinnedAgentAttachments as readExpiredUnpinnedAgentAttachments,
  deleteAgentAttachment as removeAgentAttachment,
  sumAgentAttachmentBytes as readSumAgentAttachmentBytes,
} from './agent-attachments.js';
import {
  deleteMcpToolClassification as removeMcpToolClassification,
  getMcpToolClassification as readMcpToolClassification,
  listMcpToolClassifications as readMcpToolClassifications,
  seedInferredClassifications as writeSeedClassifications,
  upsertMcpToolClassification as writeMcpToolClassification,
  type SeedClassificationEntry,
} from './mcp-tool-classifications.js';
import {
  getGovernancePolicyForOrg as readGovernancePolicy,
  saveGovernancePolicyForOrg as writeGovernancePolicy,
} from './governance-policy-store.js';
import {
  countAgentToolAttachments as countToolAttachments,
  deleteAgentToolAttachment as removeAgentToolAttachment,
  deleteAgentToolAttachmentsForAgent as removeToolAttachmentsForAgent,
  listAgentToolAttachments as readAgentToolAttachments,
  listAgentsForTool as readAgentsForTool,
  saveAgentToolAttachment as writeAgentToolAttachment,
} from './agent-tool-attachments.js';
import { createPluginRepository, type PluginRepository } from './plugins.js';
import {
  deleteGovernanceRule as removeGovernanceRule,
  listGovernanceRules as readGovernanceRules,
  saveGovernanceRule as writeGovernanceRule,
  type GovernanceRuleRow,
} from './governance-rules.js';
import {
  clearPendingWakeIntents as dropPendingWakeIntents,
  enqueueWakeIntent as writeWakeIntent,
  hasPendingWakeIntent as readPendingWakeIntent,
  listPendingWakeIntents as readPendingWakeIntents,
  markWakeIntentDispatched as writeWakeIntentDispatched,
  markWakeIntentDropped as writeWakeIntentDropped,
  type WakeIntent,
  type WakeIntentInput,
} from './wake-intents.js';

/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging -- PluginRepository methods are mixed onto Repository via Object.assign */
export class Repository {
  private readonly secrets: SecretStore;

  constructor(private readonly db: DbHandle, secrets?: SecretStore) {
    // Default to an in-memory secret store for tests / dev environments that
    // have not wired a file-backed store. Production callers (runtime/main.ts)
    // pass a createFileSecretStore() instance.
    this.secrets = secrets ?? createInMemorySecretStore();
    Object.assign(this, createPluginRepository(this.db));
  }

  getOrganization = (organizationId: string): Organization | null =>
    readOrganization(this.db, organizationId);
  getLatestOrganization = (): Organization | null => readLatestOrganization(this.db);
  listOrganizations = (): Organization[] => readOrganizations(this.db);
  listOrganizationsForUser = (emailNormalized: string): Organization[] =>
    readOrganizationsForUser(this.db, emailNormalized);
  listOrganizationsWithSignIn = (): Organization[] => readOrganizationsWithSignIn(this.db);
  organizationHasAuthUsers = (organizationId: string): boolean =>
    readOrganizationHasAuthUsers(this.db, organizationId);
  deleteOrganizationData = (organizationId: string): void => removeOrganizationData(this.db, organizationId);
  saveOrganization = (organization: Organization): Organization =>
    writeOrganization(this.db, organization);
  saveWorkspaceSetting = (organizationId: string, key: string, value: string): void =>
    writeWorkspaceSetting(this.db, organizationId, key, value);
  getWorkspaceSetting = (organizationId: string, key: string): string | null =>
    readWorkspaceSetting(this.db, organizationId, key);
  deleteWorkspaceSetting = (organizationId: string, key: string): void =>
    removeWorkspaceSetting(this.db, organizationId, key);
  findOrganizationIdByWorkspaceSetting = (key: string, value: string): string | null =>
    readOrganizationIdByWorkspaceSetting(this.db, key, value);
  saveProviderCredential = (
    organizationId: string,
    providerName: string,
    apiKey: string,
  ): void => {
    const previousKeyRef = readProviderCredential(this.db, organizationId, providerName);
    const keyRef = this.secrets.write(apiKey);
    writeProviderCredential(this.db, organizationId, providerName, keyRef);
    if (previousKeyRef) this.secrets.delete(previousKeyRef);
  };
  deleteProviderCredential = (organizationId: string, providerName: string): void => {
    const existing = readProviderCredential(this.db, organizationId, providerName);
    removeProviderCredential(this.db, organizationId, providerName);
    if (existing) this.secrets.delete(existing);
  };
  listProviderCredentials = (organizationId: string): Record<string, boolean> =>
    readProviderCredentials(this.db, organizationId);
  getProviderCredential = (organizationId: string, providerName: string): string | null => {
    const keyRef = readProviderCredential(this.db, organizationId, providerName);
    if (!keyRef) return null;
    return this.secrets.read(keyRef);
  };

  saveConfigFieldOwnership = (ownership: ConfigFieldOwnership): ConfigFieldOwnership =>
    writeConfigFieldOwnership(this.db, ownership);
  getConfigFieldOwnership = (
    organizationId: string,
    entityType: ConfigFieldOwnership['entityType'],
    entityId: string,
    fieldName: string,
  ): ConfigFieldOwnership | null =>
    readConfigFieldOwnership(this.db, organizationId, entityType, entityId, fieldName);
  listConfigFieldOwnership = (
    organizationId: string,
    entityType?: ConfigFieldOwnership['entityType'],
  ): ConfigFieldOwnership[] => readConfigFieldOwnershipList(this.db, organizationId, entityType);

  saveMember = (member: Member): Member => writeMember(this.db, member);
  saveWorkspaceMember = (workspaceMember: WorkspaceMember): WorkspaceMember =>
    writeWorkspaceMember(this.db, workspaceMember);
  saveAuthUser = (input: StoredAuthUser): AuthUser =>
    writeAuthUser(this.db, input);
  getAuthUserById = (userId: string): AuthUser | null =>
    readAuthUserById(this.db, userId);
  getAuthUserByMember = (organizationId: string, memberId: string): AuthUser | null =>
    readAuthUserByMember(this.db, organizationId, memberId);
  getAuthUserCredentials = (
    organizationId: string,
    emailNormalized: string,
  ): StoredAuthUser | null => readAuthUserCredentials(this.db, organizationId, emailNormalized);
  findAuthUsersByEmail = (emailNormalized: string): StoredAuthUser[] =>
    readAuthUsersByEmail(this.db, emailNormalized);
  saveAuthSession = (input: StoredAuthSession): AuthSession =>
    writeAuthSession(this.db, input);
  getAuthSessionByTokenHash = (sessionTokenHash: string): StoredAuthSession | null =>
    readAuthSessionByTokenHash(this.db, sessionTokenHash);
  revokeAuthSession = (sessionId: string, revokedAt?: string): AuthSession | null =>
    writeAuthSessionRevoke(this.db, sessionId, revokedAt);
  touchAuthSession = (sessionId: string, lastSeenAt?: string): AuthSession | null =>
    writeAuthSessionTouch(this.db, sessionId, lastSeenAt);
  getWorkspaceMember = (
    organizationId: string,
    memberId: string,
  ): WorkspaceMember | null => readWorkspaceMember(this.db, organizationId, memberId);
  listWorkspaceMembers = (organizationId: string): WorkspaceMember[] =>
    readWorkspaceMembers(this.db, organizationId);
  getMember = (organizationId: string, memberId: string): Member | null =>
    readMember(this.db, organizationId, memberId);
  listMembers = (organizationId: string): Member[] => readMembers(this.db, organizationId);

  saveChannel = (channel: Channel): Channel => writeChannel(this.db, channel);
  getChannel = (organizationId: string, channelId: string): Channel | null =>
    readChannel(this.db, organizationId, channelId);
  listAllChannels = (organizationId: string): Channel[] =>
    readAllChannels(this.db, organizationId);
  listChannels = (
    organizationId: string,
    cursor?: string,
    limit?: number,
    excludeKinds?: readonly ChannelKind[],
  ): PaginatedChannels => readChannels(this.db, organizationId, cursor, limit, excludeKinds);
  setChannelMembers = (
    organizationId: string,
    channelId: string,
    memberIds: string[],
  ): void => writeChannelMembers(this.db, organizationId, channelId, memberIds);
  deleteChannel = (organizationId: string, channelId: string): void =>
    removeChannel(this.db, organizationId, channelId);
  setChannelMemberMode = (
    organizationId: string,
    channelId: string,
    memberId: string,
    mode: ChannelMemberMode,
  ): void => writeChannelMemberMode(this.db, organizationId, channelId, memberId, mode);
  getChannelMemberMode = (
    organizationId: string,
    channelId: string,
    memberId: string,
  ): ChannelMemberMode | null =>
    readChannelMemberMode(this.db, organizationId, channelId, memberId);
  listChannelMemberModes = (
    organizationId: string,
    memberId: string,
  ): ChannelMemberSettings[] => readChannelMemberModes(this.db, organizationId, memberId);
  listChannelMemberModesForChannel = (
    organizationId: string,
    channelId: string,
  ): ChannelMemberSettings[] =>
    readChannelMemberModesForChannel(this.db, organizationId, channelId);
  deleteChannelMemberMode = (
    organizationId: string,
    channelId: string,
    memberId: string,
  ): void => deleteChannelMemberMode(this.db, organizationId, channelId, memberId);

  saveThread = (thread: ConversationThread): ConversationThread =>
    writeThread(this.db, thread);
  ensureThread = (thread: ConversationThread): ConversationThread =>
    ensureThreadRecord(this.db, thread);
  getThread = (organizationId: string, threadId: string): ConversationThread | null =>
    readThread(this.db, organizationId, threadId);
  setThreadMembers = (
    organizationId: string,
    threadId: string,
    memberIds: string[],
  ): void => writeThreadMembers(this.db, organizationId, threadId, memberIds);

  saveMessage = (message: Message): Message => writeMessage(this.db, message);
  updateMessage = (message: Message): Message => writeMessageUpdate(this.db, message);
  getMessage = (organizationId: string, messageId: string): Message | null =>
    readMessage(this.db, organizationId, messageId);
  /**
   * L10 — idempotency lookup. Returns a previously saved message
   * with the same (org, sender, thread, clientMessageId) tuple, or null.
   * Backed by a json_extract scan on the metadata blob.
   */
  findMessageByClientId = (
    organizationId: string,
    senderId: string,
    threadId: string,
    clientMessageId: string,
  ): Message | null =>
    readMessageByClientId(this.db, organizationId, senderId, threadId, clientMessageId);
  getLatestHumanMessageInThread = (organizationId: string, threadId: string): Message | null =>
    readLatestHumanMessageInThread(this.db, organizationId, threadId);
  saveAttachment = (attachment: Attachment): Attachment => writeAttachment(this.db, attachment);
  deleteAttachment = (organizationId: string, attachmentId: string): number =>
    removeAttachment(this.db, organizationId, attachmentId);
  getAttachment = (organizationId: string, attachmentId: string): Attachment | null =>
    readAttachment(this.db, organizationId, attachmentId);
  listMessageAttachments = (messageId: string): Attachment[] =>
    readMessageAttachments(this.db, messageId);
  linkAttachmentsToMessage = (messageId: string, attachmentIds: string[]): void =>
    writeMessageAttachments(this.db, messageId, attachmentIds);
  listMessages = (
    organizationId: string,
    threadId: string,
    cursor?: string,
    limit?: number,
  ): PaginatedMessages => readMessages(this.db, organizationId, threadId, cursor, limit);
  countMessagesSince = (
    organizationId: string,
    threadId: string,
    input?: { since?: string; excludeSenderId?: string },
  ): number => readMessageCountSince(this.db, organizationId, threadId, input);
  countUncompactedMessageChars = (organizationId: string, threadId: string): number =>
    readUncompactedMessageChars(this.db, organizationId, threadId);
  listChannelMessages = (
    organizationId: string,
    channelId: string,
    options?: { cursor?: string; since?: string; limit?: number },
  ): PaginatedMessages => readChannelMessages(this.db, organizationId, channelId, options);
  searchChannelMessages = (
    organizationId: string,
    channelId: string,
    query: string,
    options?: { cursor?: string; since?: string; limit?: number; ranked?: boolean },
  ): PaginatedMessages => searchMessagesByChannel(this.db, organizationId, channelId, query, options);
  replaceMessageMentions = (
    messageId: string,
    mentions: MessageMention[],
  ): MessageMention[] => writeMessageMentions(this.db, messageId, mentions);
  listMessageMentions = (messageId: string): MessageMention[] =>
    readMessageMentions(this.db, messageId);
  deleteMessageMentions = (messageId: string): void =>
    removeMessageMentions(this.db, messageId);
  deleteMessages = (organizationId: string, messageIds: string[]): void =>
    removeMessages(this.db, organizationId, messageIds);
  saveConversationRead = (
    organizationId: string,
    memberId: string,
    threadId: string,
    lastReadAt?: string,
  ): void => {
    void writeConversationRead(this.db, {
      organizationId,
      memberId,
      threadId,
      lastReadAt,
    });
  };
  getConversationRead = (
    organizationId: string,
    memberId: string,
    threadId: string,
  ): { organizationId: string; memberId: string; threadId: string; lastReadAt: string } | null => {
    const read = readConversationRead(this.db, organizationId, memberId, threadId);
    return read
      ? {
          organizationId: read.organization_id,
          memberId: read.member_id,
          threadId: read.thread_id,
        lastReadAt: read.last_read_at,
      }
      : null;
  };

  saveRun = (run: RunState): RunState => writeRun(this.db, run);
  getRun = (organizationId: string, runId: string): RunState | null =>
    readRun(this.db, organizationId, runId);
  findActiveRunForMemberThread = (
    organizationId: string,
    agentId: string,
    threadId: string,
  ): RunState | null => readActiveRunForMemberThread(this.db, organizationId, agentId, threadId);
  listActiveRuns = (organizationId: string): RunState[] => readActiveRuns(this.db, organizationId);
  saveRunStep = (step: RunStep): RunStep => writeRunStep(this.db, step);
  listRunSteps = (organizationId: string, runId: string): RunStep[] =>
    readRunSteps(this.db, organizationId, runId);
  listRuns = (organizationId: string, cursor?: string, limit?: number): PaginatedRuns =>
    readRuns(this.db, organizationId, cursor, limit);
  listThreadRuns = (
    organizationId: string,
    threadId: string,
    cursor?: string,
    limit?: number,
  ): PaginatedRuns => readThreadRuns(this.db, organizationId, threadId, cursor, limit);
  enqueueWakeIntent = (input: WakeIntentInput): WakeIntent =>
    writeWakeIntent(this.db, input);
  listPendingWakeIntents = (organizationId: string, threadId: string): WakeIntent[] =>
    readPendingWakeIntents(this.db, organizationId, threadId);
  markWakeIntentDispatched = (organizationId: string, intentId: string): void =>
    writeWakeIntentDispatched(this.db, organizationId, intentId);
  markWakeIntentDropped = (organizationId: string, intentId: string): void =>
    writeWakeIntentDropped(this.db, organizationId, intentId);
  clearPendingWakeIntents = (organizationId: string, threadId: string): void =>
    dropPendingWakeIntents(this.db, organizationId, threadId);
  hasPendingWakeIntent = (
    organizationId: string,
    memberId: string,
    threadId: string,
    messageId: string,
  ): boolean => readPendingWakeIntent(this.db, organizationId, memberId, threadId, messageId);

  saveWorkflowDefinition = (def: WorkflowDefinition): WorkflowDefinition =>
    writeWorkflowDefinition(this.db, def);
  getWorkflowDefinition = (
    organizationId: string,
    id: string,
  ): WorkflowDefinition | null => readWorkflowDefinition(this.db, organizationId, id);
  getWorkflowDefinitionByName = (
    organizationId: string,
    name: string,
  ): WorkflowDefinition | null =>
    readWorkflowDefinitionByName(this.db, organizationId, name);
  listWorkflowDefinitions = (organizationId: string): WorkflowDefinition[] =>
    readWorkflowDefinitions(this.db, organizationId);
  deleteWorkflowDefinition = (organizationId: string, id: string): void =>
    removeWorkflowDefinition(this.db, organizationId, id);
  saveWorkflowRun = (run: WorkflowRun): WorkflowRun =>
    writeWorkflowRun(this.db, run);
  getWorkflowRun = (organizationId: string, runId: string): WorkflowRun | null =>
    readWorkflowRun(this.db, organizationId, runId);
  listWorkflowRuns = (organizationId: string, status?: string): WorkflowRun[] =>
    readWorkflowRuns(this.db, organizationId, status);
  listWorkflowRunsByStatus = (
    organizationId: string,
    statuses: string[],
  ): WorkflowRun[] => readWorkflowRunsByStatus(this.db, organizationId, statuses);
  saveWorkflowNodeRun = (nodeRun: WorkflowNodeRun): WorkflowNodeRun =>
    writeWorkflowNodeRun(this.db, nodeRun);
  getWorkflowNodeRun = (
    workflowRunId: string,
    id: string,
  ): WorkflowNodeRun | null => readWorkflowNodeRun(this.db, workflowRunId, id);
  getWorkflowNodeRunByNode = (
    workflowRunId: string,
    nodeId: string,
    attempt: number,
  ): WorkflowNodeRun | null =>
    readWorkflowNodeRunByNode(this.db, workflowRunId, nodeId, attempt);
  listWorkflowNodeRuns = (workflowRunId: string): WorkflowNodeRun[] =>
    readWorkflowNodeRuns(this.db, workflowRunId);

  saveTaskSession = (session: TaskSession): TaskSession =>
    writeTaskSession(this.db, session);
  getTaskSession = (organizationId: string, taskSessionId: string): TaskSession | null =>
    readTaskSession(this.db, organizationId, taskSessionId);
  getTaskSessionBySlug = (organizationId: string, slug: string): TaskSession | null =>
    readTaskSessionBySlug(this.db, organizationId, slug);
  getTaskSessionByChannel = (organizationId: string, channelId: string): TaskSession | null =>
    readTaskSessionByChannel(this.db, organizationId, channelId);
  findOpenTaskSessionForChannel = (
    organizationId: string,
    channelId: string,
  ): TaskSession | null =>
    readOpenTaskSessionForChannel(this.db, organizationId, channelId);
  listTaskSessions = (
    organizationId: string,
    options?: { cursor?: string; limit?: number; status?: TaskSessionStatus },
  ): PaginatedTaskSessions => readTaskSessions(this.db, organizationId, options);
  updateTaskSessionStatus = (
    organizationId: string,
    taskSessionId: string,
    status: TaskSessionStatus,
    options?: { summary?: string; completedAt?: string },
  ): TaskSession | null =>
    writeTaskSessionStatus(this.db, organizationId, taskSessionId, status, options);

  saveApproval = (approval: ApprovalRequest): ApprovalRequest =>
    writeApproval(this.db, approval);
  getApproval = (organizationId: string, approvalId: string): ApprovalRequest | null =>
    readApproval(this.db, organizationId, approvalId);
  resolveApproval = (
    organizationId: string,
    approvalId: string,
    status: 'approved' | 'rejected',
    reason = '',
  ): ApprovalRequest | null =>
    resolveApprovalRecord(this.db, organizationId, approvalId, status, reason);
  deleteApproval = (organizationId: string, approvalId: string): void =>
    deleteApprovalRecord(this.db, organizationId, approvalId);
  listPendingApprovals = (organizationId: string): ApprovalRequest[] => {
    return readPendingApprovals(this.db, organizationId);
  };
  hasApprovalGrant = (input: {
    organizationId: string;
    resourceType: ApprovalRequest['resourceType'];
    action: ApprovalRequest['action'];
    approvalScope: string;
  }): boolean => readApprovalGrant(this.db, input);

  saveAuditEvent = (event: AuditEvent): AuditEvent => writeAuditEvent(this.db, event);
  listAuditEvents = (organizationId: string): AuditEvent[] => readAuditEvents(this.db, organizationId);

  // §9.4 / PR 9 — table exists from migration 050, callers are the
  // suggestion writer scaffolded in PR 8 (no-op analysis) and the
  // settings panel's "Show usage" sublink (renders zero-state today).
  saveTierCurationSuggestion = (suggestion: TierCurationSuggestion): TierCurationSuggestion =>
    writeTierCurationSuggestion(this.db, suggestion);
  listTierCurationSuggestions = (organizationId: string): TierCurationSuggestion[] =>
    readTierCurationSuggestions(this.db, organizationId);
  updateTierCurationSuggestionStatus = (
    organizationId: string,
    suggestionId: string,
    nextStatus: 'pending' | 'applied' | 'dismissed',
    resolvedAt: string,
  ): TierCurationSuggestion | null =>
    mutateTierCurationSuggestionStatus(
      this.db,
      organizationId,
      suggestionId,
      nextStatus,
      resolvedAt,
    );

  /**
   * Execute `fn` inside a synchronous DB transaction. Commits on
   * normal return, rolls back on throw. The callback must run
   * synchronously — bun:sqlite / better-sqlite3 don't support async
   * statement queues so awaiting inside the transaction would either
   * suspend it (better-sqlite3) or escape it (bun:sqlite). Async work
   * (network, LLM calls, message publishing) belongs after the commit.
   *
   * Nested transactions are NOT supported — the SQLite drivers raise
   * "cannot start a transaction within a transaction". Callers should
   * compose the entire write at the top of the chain.
   */
  transaction = <T>(fn: () => T): T => {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // best-effort rollback — surface the original error
      }
      throw err;
    }
  };

  saveSpirit = (spirit: Spirit): Spirit => writeSpirit(this.db, spirit);
  getSpirit = (organizationId: string, spiritId: string): Spirit | null =>
    readSpirit(this.db, organizationId, spiritId);
  getSpiritByTriple = (
    organizationId: string,
    taskSessionId: string,
    memberId: string,
    role: SpiritRole,
  ): Spirit | null => readSpiritByTriple(this.db, organizationId, taskSessionId, memberId, role);
  getSpiritByRunId = (organizationId: string, runId: string): Spirit | null =>
    readSpiritByRunId(this.db, organizationId, runId);
  listSpiritsForSession = (organizationId: string, taskSessionId: string): Spirit[] =>
    readSpiritsForSession(this.db, organizationId, taskSessionId);
  listActiveSpiritsForMember = (organizationId: string, memberId: string): Spirit[] =>
    readActiveSpiritsForMember(this.db, organizationId, memberId);

  saveGoal = (goal: Goal): Goal => writeGoal(this.db, goal);
  getGoal = (organizationId: string, goalId: string): Goal | null =>
    readGoal(this.db, organizationId, goalId);
  getGoalByChannel = (organizationId: string, channelId: string): Goal | null =>
    readGoalByChannel(this.db, organizationId, channelId);
  listGoalsByChannel = (organizationId: string, channelId: string): Goal[] =>
    readGoalsByChannel(this.db, organizationId, channelId);
  listGoals = (organizationId: string): Goal[] => readGoals(this.db, organizationId);
  saveGoalTask = (task: GoalTask): GoalTask => writeGoalTask(this.db, task);
  deleteGoalTasks = (organizationId: string, goalId: string): void =>
    removeGoalTasks(this.db, organizationId, goalId);
  getGoalTask = (organizationId: string, taskId: string): GoalTask | null =>
    readGoalTask(this.db, organizationId, taskId);
  listGoalTasks = (organizationId: string, goalId: string): GoalTask[] =>
    readGoalTasks(this.db, organizationId, goalId);
  listGoalTasksByOrganization = (organizationId: string): GoalTask[] =>
    readAllGoalTasks(this.db, organizationId);
  setGoalTaskLastNudgedAt = (
    organizationId: string,
    taskId: string,
    isoTimestamp: string,
  ): void => writeGoalTaskLastNudgedAt(this.db, organizationId, taskId, isoTimestamp);
  updateGoalTaskStatus = (
    organizationId: string,
    taskId: string,
    status: GoalTaskStatus,
    options?: { handoverSummary?: string },
  ): GoalTask | null => writeGoalTaskStatus(this.db, organizationId, taskId, status, options);
  saveInteractiveQuestion = (question: InteractiveQuestion): InteractiveQuestion =>
    writeInteractiveQuestion(this.db, question);
  getInteractiveQuestion = (organizationId: string, questionId: string): InteractiveQuestion | null =>
    readInteractiveQuestion(this.db, organizationId, questionId);
  listPendingInteractiveQuestions = (
    organizationId: string,
    channelId: string,
  ): InteractiveQuestion[] => readPendingInteractiveQuestions(this.db, organizationId, channelId);
  listInteractiveQuestionsByRunId = (
    organizationId: string,
    runId: string,
  ): InteractiveQuestion[] => readInteractiveQuestionsByRunId(this.db, organizationId, runId);

  // Bet 5 — memory_entries KV (SQLite)
  upsertMemoryEntry = (entry: MemoryEntry): Promise<MemoryEntry> =>
    writeMemoryEntry(this.db, entry);
  recallMemoryEntries = (input: {
    organizationId: string;
    memberId?: string;
    kind?: MemoryEntryKind;
    keyPrefix?: string;
    query?: string;
    limit?: number;
    touch?: boolean;
  }): Promise<MemoryEntry[]> => readMemoryEntries(this.db, input);
  deleteMemoryEntry = (
    organizationId: string,
    memberId: string | null,
    key: string,
  ): Promise<boolean> => removeMemoryEntry(this.db, organizationId, memberId, key);
  deleteExpiredMemoryEntries = (nowIso: string): number =>
    removeExpiredMemoryEntries(this.db, nowIso);

  // Bet 4 — workspace files FTS
  upsertWorkspaceFile = (
    input: WorkspaceFile,
    caps?: { perOrgByteCap?: number; perFileByteCap?: number },
  ): WorkspaceFile => writeWorkspaceFile(this.db, input, caps);
  deleteWorkspaceFile = (organizationId: string, path: string): boolean =>
    removeWorkspaceFile(this.db, organizationId, path);
  searchWorkspaceFiles = (input: {
    organizationId: string;
    query: string;
    limit?: number;
    sinceIso?: string;
  }): WorkspaceFileSearchHit[] => searchWorkspaceFilesByQuery(this.db, input);
  // Bet 6 — decision log
  appendDecisionLogEntry = (entry: DecisionLogEntry): DecisionLogEntry =>
    writeDecisionLogEntry(this.db, entry);
  listDecisionLogForChannel = (
    organizationId: string,
    channelId: string,
    limit?: number,
  ): DecisionLogEntry[] => readDecisionLogForChannel(this.db, organizationId, channelId, limit);
  findDecisionBySourceMessage = (
    organizationId: string,
    sourceMessageId: string,
  ): DecisionLogEntry | null =>
    readDecisionBySourceMessage(this.db, organizationId, sourceMessageId);

  // Procedures as Culture (docs/procedures-as-culture.md).
  appendProcedureRevision = (rev: ProcedureRevision): ProcedureRevision =>
    writeProcedureRevision(this.db, rev);
  listProcedureRevisions = (input: {
    organizationId: string;
    scope: string;
    scopeId: string;
    name: string;
    limit?: number;
  }): ProcedureRevision[] => readProcedureRevisions(this.db, input);
  recordProceduresApplied = (input: {
    organizationId: string;
    runId: string;
    applied: { scope: string; scopeId: string; name: string; version: number; enforced: boolean }[];
  }): void => writeRunProceduresApplied(this.db, input);
  listRunProceduresApplied = (
    organizationId: string,
    runId: string,
  ): RunProcedureApplied[] => readRunProceduresApplied(this.db, organizationId, runId);

  saveScheduledJob = (job: ScheduledJob): ScheduledJob =>
    writeScheduledJob(this.db, job);
  getScheduledJob = (organizationId: string, jobId: string): ScheduledJob | null =>
    readScheduledJob(this.db, organizationId, jobId);
  listScheduledJobs = (organizationId: string): ScheduledJob[] =>
    readScheduledJobs(this.db, organizationId);
  deleteScheduledJob = (organizationId: string, jobId: string): void =>
    removeScheduledJob(this.db, organizationId, jobId);
  listDueJobsGlobally = (): ScheduledJob[] => readDueJobsGlobally(this.db);

  saveSelfImprovementReview = (review: SelfImprovementReview): SelfImprovementReview =>
    writeSelfImprovementReview(this.db, review);
  getSelfImprovementReview = (organizationId: string, reviewId: string): SelfImprovementReview | null =>
    readSelfImprovementReview(this.db, organizationId, reviewId);
  listSelfImprovementReviews = (organizationId: string, limit?: number): SelfImprovementReview[] =>
    readSelfImprovementReviews(this.db, organizationId, limit);
  listSelfImprovementReviewsByRun = (organizationId: string, runId: string): SelfImprovementReview[] =>
    readSelfImprovementReviewsByRun(this.db, organizationId, runId);
  deleteSelfImprovementReview = (organizationId: string, reviewId: string): void =>
    removeSelfImprovementReview(this.db, organizationId, reviewId);

  // Generic secret-store passthrough — used by the MCP registry (env
  // maps + auth headers) and any other component that needs to put
  // sensitive material in the file-backed store without going through
  // the provider-credential helper. Values are written / read as
  // opaque strings; the caller JSON-encodes structured payloads.
  writeSecret = (value: string): string => this.secrets.write(value);
  readSecret = (keyRef: string): string | null => this.secrets.read(keyRef);
  deleteSecret = (keyRef: string): void => this.secrets.delete(keyRef);

  saveMcpServer = (server: McpServer): McpServer => writeMcpServer(this.db, server);
  getMcpServer = (organizationId: string, serverId: string): McpServer | null =>
    readMcpServer(this.db, organizationId, serverId);
  getMcpServerByName = (organizationId: string, name: string): McpServer | null =>
    readMcpServerByName(this.db, organizationId, name);
  listMcpServers = (organizationId: string): McpServer[] => readMcpServers(this.db, organizationId);
  deleteMcpServer = (organizationId: string, serverId: string): void =>
    removeMcpServer(this.db, organizationId, serverId);

  saveAgentMcpAttachment = (
    attachment: AgentMcpAttachment,
  ): AgentMcpAttachment => writeAgentMcpAttachment(this.db, attachment);
  updateAttachmentTier = (
    organizationId: string,
    memberId: string,
    mcpServerId: string,
    tier: AgentMcpAttachment['tier'],
    updatedAt: string,
  ): AgentMcpAttachment | null =>
    mutateAttachmentTier(this.db, organizationId, memberId, mcpServerId, tier, updatedAt);
  deleteAgentMcpAttachment = (
    organizationId: string,
    memberId: string,
    mcpServerId: string,
  ): void => removeAgentMcpAttachment(this.db, organizationId, memberId, mcpServerId);
  listAgentMcpAttachments = (
    organizationId: string,
    memberId: string,
  ): AgentMcpAttachment[] => readAgentMcpAttachments(this.db, organizationId, memberId);

  // PR 10 — channel attachments. Parallel surface to the agent
  // attachment methods above. The V2 spawn's §17.5.3 union step calls
  // listChannelMcpAttachmentsForMember to fold the channel side into
  // the agent's effective set.
  saveChannelMcpAttachment = (
    attachment: ChannelMcpAttachment,
  ): ChannelMcpAttachment => writeChannelMcpAttachment(this.db, attachment);
  updateChannelAttachmentTier = (
    organizationId: string,
    channelId: string,
    mcpServerId: string,
    tier: ChannelMcpAttachment['tier'],
    updatedAt: string,
  ): ChannelMcpAttachment | null =>
    mutateChannelAttachmentTier(
      this.db,
      organizationId,
      channelId,
      mcpServerId,
      tier,
      updatedAt,
    );
  deleteChannelMcpAttachment = (
    organizationId: string,
    channelId: string,
    mcpServerId: string,
  ): void => removeChannelMcpAttachment(this.db, organizationId, channelId, mcpServerId);
  listChannelMcpAttachments = (
    organizationId: string,
    channelId: string,
  ): ChannelMcpAttachment[] =>
    readChannelMcpAttachments(this.db, organizationId, channelId);
  listChannelMcpAttachmentsForMember = (
    organizationId: string,
    memberId: string,
  ): ChannelMcpAttachment[] =>
    readChannelMcpAttachmentsForMember(this.db, organizationId, memberId);

  // Agent-generated attachments (agent_attachments_plan.md). Captured
  // tool-result bytes + workspace-file copies. Pinned rows survive
  // for their message's lifetime; unpinned rows age out via the LRU
  // cleanup job.
  saveAgentAttachment = (attachment: AgentAttachment): AgentAttachment =>
    writeAgentAttachment(this.db, attachment);
  getAgentAttachment = (
    organizationId: string,
    id: string,
  ): AgentAttachment | null => readAgentAttachment(this.db, organizationId, id);
  findAgentAttachmentByToolCall = (
    organizationId: string,
    toolCallId: string,
    index: number,
  ): AgentAttachment | null =>
    readAgentAttachmentByToolCall(this.db, organizationId, toolCallId, index);
  pinAgentAttachmentToMessage = (
    organizationId: string,
    id: string,
    messageId: string,
  ): AgentAttachment | null =>
    mutatePinAgentAttachmentToMessage(this.db, organizationId, id, messageId);
  listAgentAttachmentsForRun = (
    organizationId: string,
    runId: string,
  ): AgentAttachment[] =>
    readAgentAttachmentsForRun(this.db, organizationId, runId);
  listExpiredUnpinnedAgentAttachments = (
    organizationId: string,
    createdBefore: string,
  ): AgentAttachment[] =>
    readExpiredUnpinnedAgentAttachments(this.db, organizationId, createdBefore);
  deleteAgentAttachment = (organizationId: string, id: string): void =>
    removeAgentAttachment(this.db, organizationId, id);
  sumAgentAttachmentBytes = (organizationId: string): number =>
    readSumAgentAttachmentBytes(this.db, organizationId);

  listMcpServerAttachments = (
    organizationId: string,
    mcpServerId: string,
  ): AgentMcpAttachment[] => readMcpServerAttachments(this.db, organizationId, mcpServerId);
  listAttachedServersForSpirit = (
    organizationId: string,
    memberId: string,
    role: 'worker' | 'supervisor',
  ): { attachment: AgentMcpAttachment; server: McpServer }[] =>
    readAttachedServersForSpirit(this.db, organizationId, memberId, role);

  saveMcpToolCache = (cache: McpToolCache): McpToolCache => writeMcpToolCache(this.db, cache);
  getMcpToolCache = (organizationId: string, mcpServerId: string): McpToolCache | null =>
    readMcpToolCache(this.db, organizationId, mcpServerId);

  getMcpToolClassification = (
    organizationId: string,
    mcpServerId: string,
    toolName: string,
  ): McpToolClassification | null =>
    readMcpToolClassification(this.db, organizationId, mcpServerId, toolName);
  listMcpToolClassifications = (
    organizationId: string,
    mcpServerId?: string,
  ): McpToolClassification[] =>
    readMcpToolClassifications(this.db, organizationId, mcpServerId);
  upsertMcpToolClassification = (
    payload: McpToolClassification,
  ): McpToolClassification => writeMcpToolClassification(this.db, payload);
  seedInferredClassifications = (
    organizationId: string,
    mcpServerId: string,
    entries: readonly SeedClassificationEntry[],
    updatedBy?: string,
  ): number => writeSeedClassifications(this.db, organizationId, mcpServerId, entries, updatedBy);
  deleteMcpToolClassification = (
    organizationId: string,
    mcpServerId: string,
    toolName: string,
  ): void => removeMcpToolClassification(this.db, organizationId, mcpServerId, toolName);

  getGovernancePolicy = (organizationId: string): GovernancePolicy =>
    readGovernancePolicy(this.db, organizationId);
  saveGovernancePolicy = (
    organizationId: string,
    policy: GovernancePolicy,
  ): GovernancePolicy => writeGovernancePolicy(this.db, organizationId, policy);

  // Per-tool agent grants. When any rows exist for (agent, mcp_server),
  // the runtime palette filters to exactly those tools.
  saveAgentToolAttachment = (
    attachment: AgentToolAttachment,
  ): AgentToolAttachment => writeAgentToolAttachment(this.db, attachment);
  deleteAgentToolAttachment = (
    organizationId: string,
    memberId: string,
    mcpServerId: string,
    toolName: string,
  ): void => removeAgentToolAttachment(this.db, organizationId, memberId, mcpServerId, toolName);
  listAgentToolAttachments = (
    organizationId: string,
    memberId: string,
    mcpServerId?: string,
  ): AgentToolAttachment[] =>
    readAgentToolAttachments(this.db, organizationId, memberId, mcpServerId);
  listAgentsForTool = (
    organizationId: string,
    mcpServerId: string,
    toolName: string,
  ): string[] => readAgentsForTool(this.db, organizationId, mcpServerId, toolName);
  countAgentToolAttachments = (
    organizationId: string,
    memberId: string,
    mcpServerId: string,
  ): number => countToolAttachments(this.db, organizationId, memberId, mcpServerId);
  deleteAgentToolAttachmentsForAgent = (
    organizationId: string,
    memberId: string,
    mcpServerId?: string,
  ): void => removeToolAttachmentsForAgent(this.db, organizationId, memberId, mcpServerId);

  saveMemory = (entry: MemoryEntry): Promise<MemoryEntry> => writeMemory(this.db, entry);
  getMemory = (organizationId: string, memoryId: string): MemoryEntry | null =>
    readMemory(this.db, organizationId, memoryId);
  listMemories = (organizationId: string, memberId: string): MemoryEntry[] =>
    readMemories(this.db, organizationId, memberId);
  listOrgMemories = (organizationId: string): MemoryEntry[] =>
    readOrgMemories(this.db, organizationId);
  deleteMemory = (organizationId: string, memoryId: string): Promise<void> =>
    removeMemory(this.db, organizationId, memoryId);

  getBootstrapSnapshot = (organizationId?: string): BootstrapSnapshot =>
    readBootstrapSnapshot(this.db, organizationId);

  listNotificationChannels = (organizationId: string): NotificationChannelRow[] =>
    readNotificationChannels(this.db, organizationId);
  getNotificationChannel = (organizationId: string, channelId: string): NotificationChannelRow | null =>
    readNotificationChannel(this.db, organizationId, channelId);
  saveNotificationChannel = (channel: NotificationChannelRow): void =>
    writeNotificationChannel(this.db, channel);
  deleteNotificationChannel = (organizationId: string, channelId: string): void =>
    removeNotificationChannel(this.db, organizationId, channelId);

  listGovernanceRules = (organizationId: string, state?: string): GovernanceRuleRow[] =>
    readGovernanceRules(this.db, organizationId, state);
  deleteGovernanceRule = (
    organizationId: string,
    agentId: string,
    mcpId: string,
    toolName: string,
  ): GovernanceRuleRow | null =>
    removeGovernanceRule(this.db, organizationId, agentId, mcpId, toolName);
  saveGovernanceRule = (rule: {
    id: string;
    organizationId: string;
    agentId: string;
    mcpId: string;
    toolName: string;
    state: string;
    reason?: string;
    updatedBy?: string;
  }): GovernanceRuleRow => writeGovernanceRule(this.db, rule);
}

import type { ChannelStore } from './channel-store.js';
import type { MessageStore } from './message-store.js';
import type { MemberStore } from './member-store.js';
import type { RunStore } from './run-store.js';
import type { WorkflowStore } from './workflow-store.js';

export interface Repository extends PluginRepository, ChannelStore, MessageStore, MemberStore, RunStore, WorkflowStore {}

export type {
  BootstrapSnapshot,
  NotificationChannelRow,
  PaginatedChannels,
  PaginatedMessages,
  PaginatedRuns,
  StoredAuthSession,
  StoredAuthUser,
  GovernanceRuleRow,
};
