import type {
  AgentAttachment,
  AgentMcpAttachment,
  ChannelMcpAttachment,
  AgentToolAttachment,
  ApprovalRequest,
  AuthSession,
  AuthUser,
  AuditEvent,
  Attachment,
  Channel,
  ChannelKind,
  ChannelMemberMode,
  ChannelMemberSettings,
  ChildTask,
  ConfigFieldOwnership,
  ConversationThread,
  DecisionLogEntry,
  GovernancePolicy,
  ProcedureRevision,
  RunProcedureApplied,
  McpServer,
  McpToolCache,
  McpToolClassification,
  PluginInstall,
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
  SkillInstall,
  TaskSession,
  TaskSessionStatus,
  TierCurationSuggestion,
  Goal,
  GoalTask,
  GoalTaskStatus,
  InteractiveQuestion,
  ToolRiskClass,
  WorkspaceFile,
  WorkspaceMember,
  WakeReason,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowNodeRun,
} from '@ujima/shared';

export interface GovernanceRuleRow {
  id: string;
  organizationId: string;
  agentId: string;
  mcpId: string;
  toolName: string;
  state: string;
  reason: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

/** Matches `@ujima/runtime-core` notification channel rows (kept here to avoid a circular import). */
export interface NotificationChannelRow {
  id: string;
  organizationId: string;
  provider: 'telegram' | 'whatsapp' | 'webhook';
  configJson: string;
  enabled: boolean;
  notifyMessages: boolean;
  notifyApprovals: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedTaskSessions {
  data: TaskSession[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface WakeIntentInput {
  organizationId: string;
  threadId: string;
  channelId?: string;
  memberId: string;
  messageId: string;
  messageCreatedAt: string;
  byMemberId: string;
  reason: string;
  wakeReason: WakeReason;
}

export interface WakeIntent extends WakeIntentInput {
  id: string;
  status: 'pending' | 'dispatched' | 'dropped';
  createdAt: string;
  dispatchedAt?: string;
  droppedAt?: string;
}

export interface BootstrapSnapshot {
  organization: Organization | null;
  members: Member[];
  channels: Channel[];
  pendingApprovals: ApprovalRequest[];
  activeRuns: RunState[];
  providerCredentials: Record<string, boolean>;
}

export interface PaginatedMessages {
  data: Message[];
  nextCursor?: string;
  hasMore: boolean;
  searchRanks?: Record<string, number>;
}

export interface PaginatedChannels {
  data: Channel[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface PaginatedRuns {
  data: RunState[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface StoredAuthUser {
  user: AuthUser;
  passwordHash: string;
  emailNormalized: string;
}

export interface StoredAuthSession {
  session: AuthSession;
  sessionTokenHash: string;
}

/**
 * Narrow read surface that `AiService` needs. `@ujima/runtime-core`'s
 * `Repository` class satisfies this shape structurally, avoiding a
 * workspace-cycle between orchestrator and runtime-core.
 */
export interface RepositoryReader {
  getOrganization(organizationId: string): Organization | null;
  getWorkspaceMember(organizationId: string, memberId: string): WorkspaceMember | null;
  listWorkspaceMembers(organizationId: string): WorkspaceMember[];
  getMember(organizationId: string, memberId: string): Member | null;
  listMembers(organizationId: string): Member[];
  countMessagesSince(
    organizationId: string,
    threadId: string,
    input?: { since?: string; excludeSenderId?: string },
  ): number;
  countUncompactedMessageChars?(organizationId: string, threadId: string): number;
  getConversationRead(
    organizationId: string,
    memberId: string,
    threadId: string,
  ): { organizationId: string; memberId: string; threadId: string; lastReadAt: string } | null;
  listMessages(
    organizationId: string,
    threadId: string,
    cursor?: string,
    limit?: number,
  ): PaginatedMessages;
  getProviderCredential(organizationId: string, providerName: string): string | null;
  listOrganizationSkillInstalls?(organizationId: string): SkillInstall[];
  listRunSteps(organizationId: string, runId: string): RunStep[];
  listRunsByIds?(organizationId: string, runIds: readonly string[]): RunState[];
  listRunStepsByRunIds?(
    organizationId: string,
    runIds: readonly string[],
    limit?: number,
  ): RunStep[];
  /**
   * Optional lookup so ai-service can read the wake-trigger
   * sourceMessageId off the run row to anchor the
   * `<thread-state>` injection. Optional for backwards
   * compatibility with narrower repo surfaces (mocks, tests).
   */
  getRun?(organizationId: string, runId: string): RunState | null;
  /**
   * Optional role-agnostic lookup so the wake-run path can pick the
   * correct `SpiritRole` (worker vs. supervisor) when resolving MCP
   * attachments. Without this, the resolver defaults to `'worker'`
   * and a supervisor-only attachment is silently dropped. Crucially
   * this is NOT `listActiveSpiritsForMember` — that helper filters
   * to `role = 'worker'` in SQL, so it would still hide supervisor
   * spirits. `getSpiritByRunId` is keyed directly on `runs.run_id`
   * and returns whichever role owns the row.
   */
  getSpiritByRunId?(organizationId: string, runId: string): Spirit | null;
}

/**
 * Wider repository surface used by conversation/realtime services. The
 * runtime-core `Repository` class satisfies this structurally.
 */
export interface ConversationRepository extends RepositoryReader {
  getChannel(organizationId: string, channelId: string): Channel | null;
  listAllChannels(organizationId: string): Channel[];
  listChannels(
    organizationId: string,
    cursor?: string,
    limit?: number,
    excludeKinds?: readonly ChannelKind[],
  ): PaginatedChannels;
  saveChannel(channel: Channel): Channel;
  setChannelMembers(organizationId: string, channelId: string, memberIds: string[]): void;
  setChannelMemberMode(
    organizationId: string,
    channelId: string,
    memberId: string,
    mode: ChannelMemberMode,
  ): void;
  getChannelMemberMode(
    organizationId: string,
    channelId: string,
    memberId: string,
  ): ChannelMemberMode | null;
  listChannelMemberModes(organizationId: string, memberId: string): ChannelMemberSettings[];
  listChannelMemberModesForChannel(
    organizationId: string,
    channelId: string,
  ): ChannelMemberSettings[];
  deleteChannelMemberMode(
    organizationId: string,
    channelId: string,
    memberId: string,
  ): void;
  deleteChannel(organizationId: string, channelId: string): void;
  getThread(organizationId: string, threadId: string): ConversationThread | null;
  ensureThread(thread: ConversationThread): ConversationThread;
  getMessage(organizationId: string, messageId: string): Message | null;
  /**
   * L10 — idempotency lookup. Returns a previously persisted
   * message with the same (org, sender, thread, clientMessageId)
   * tuple, or null. Optional on the interface so older repository
   * implementations don't have to implement it immediately — the
   * conversation service treats `undefined` as "no idempotency
   * support" and falls back to the always-insert path.
   */
  findMessageByClientId?(
    organizationId: string,
    senderId: string,
    threadId: string,
    clientMessageId: string,
  ): Message | null;
  getLatestHumanMessageInThread(organizationId: string, threadId: string): Message | null;
  listMessages(
    organizationId: string,
    threadId: string,
    cursor?: string,
    limit?: number,
  ): PaginatedMessages;
  listChannelMessages(
    organizationId: string,
    channelId: string,
    options?: { cursor?: string; since?: string; limit?: number },
  ): PaginatedMessages;
  searchChannelMessages(
    organizationId: string,
    channelId: string,
    query: string,
    options?: { cursor?: string; since?: string; limit?: number; ranked?: boolean },
  ): PaginatedMessages;
  getAttachment(organizationId: string, attachmentId: string): Attachment | null;
  listMessageAttachments(messageId: string): Attachment[];
  saveMessage(message: Message): Message;
  updateMessage(message: Message): Message;
  saveAttachment(attachment: Attachment): Attachment;
  deleteAttachment(organizationId: string, attachmentId: string): number;
  linkAttachmentsToMessage(messageId: string, attachmentIds: string[]): void;
  replaceMessageMentions(messageId: string, mentions: MessageMention[]): MessageMention[];
  listMessageMentions(messageId: string): MessageMention[];
  deleteMessageMentions(messageId: string): void;
  getRun(organizationId: string, runId: string): RunState | null;
  /**
   * Optional run-row write surface used by the mirror-loop guard
   * (Bet 1.5): when a posting tool's body would trip the mirror
   * detector, ConversationService overrides the run's terminator
   * to `channel.ack` and suppresses publish. Optional so narrower
   * conversation mocks aren't forced to implement it — the guard
   * silently no-ops in that case.
   */
  saveRun?(run: RunState): RunState;
  saveInteractiveQuestion?(question: InteractiveQuestion): InteractiveQuestion;
  listPendingInteractiveQuestions?(organizationId: string, channelId: string): InteractiveQuestion[];
  listInteractiveQuestionsByRunId?(organizationId: string, runId: string): InteractiveQuestion[];
  findActiveRunForMemberThread(
    organizationId: string,
    agentId: string,
    threadId: string,
  ): RunState | null;
  saveConversationRead(
    organizationId: string,
    memberId: string,
    threadId: string,
    lastReadAt?: string,
  ): void;
}

/**
 * Full repository surface used by run/tool/approval services. Extends the
 * conversation surface with run, approval, and audit persistence. The
 * runtime-core `Repository` class satisfies this structurally.
 */
export interface ApiRepository extends ConversationRepository {
  listOrganizationsForUser(emailNormalized: string): Organization[];
  saveScheduledJob(job: ScheduledJob): ScheduledJob;
  getScheduledJob(organizationId: string, jobId: string): ScheduledJob | null;
  listScheduledJobs(organizationId: string): ScheduledJob[];
  deleteScheduledJob(organizationId: string, jobId: string): void;
  listDueJobsGlobally(): ScheduledJob[];
  saveSelfImprovementReview(review: SelfImprovementReview): SelfImprovementReview;
  getSelfImprovementReview(organizationId: string, reviewId: string): SelfImprovementReview | null;
  listSelfImprovementReviews(organizationId: string, limit?: number): SelfImprovementReview[];
  listSelfImprovementReviewsByRun(organizationId: string, runId: string): SelfImprovementReview[];
  deleteSelfImprovementReview(organizationId: string, reviewId: string): void;
  listNotificationChannels(organizationId: string): NotificationChannelRow[];
  getNotificationChannel(organizationId: string, channelId: string): NotificationChannelRow | null;
  saveNotificationChannel(channel: NotificationChannelRow): void;
  deleteNotificationChannel(organizationId: string, channelId: string): void;
  saveRun(run: RunState): RunState;
  saveRunStep(step: RunStep): RunStep;
  listRunSteps(organizationId: string, runId: string): RunStep[];
  listRuns(
    organizationId: string,
    cursor?: string,
    limit?: number,
  ): PaginatedRuns;
  listActiveRuns(organizationId: string): RunState[];
  listThreadRuns(
    organizationId: string,
    threadId: string,
    cursor?: string,
    limit?: number,
  ): PaginatedRuns;
  saveWorkflowDefinition(def: WorkflowDefinition): WorkflowDefinition;
  getWorkflowDefinition(organizationId: string, id: string): WorkflowDefinition | null;
  getWorkflowDefinitionByName(organizationId: string, name: string): WorkflowDefinition | null;
  listWorkflowDefinitions(organizationId: string): WorkflowDefinition[];
  listWorkflowDefinitionsForChannel(organizationId: string, channelId: string): WorkflowDefinition[];
  deleteWorkflowDefinition(organizationId: string, id: string): void;
  saveWorkflowRun(run: WorkflowRun): WorkflowRun;
  getWorkflowRun(organizationId: string, runId: string): WorkflowRun | null;
  listWorkflowRuns(organizationId: string, status?: string): WorkflowRun[];
  listWorkflowRunsByStatus(organizationId: string, statuses: string[]): WorkflowRun[];
  saveWorkflowNodeRun(nodeRun: WorkflowNodeRun): WorkflowNodeRun;
  getWorkflowNodeRun(workflowRunId: string, id: string): WorkflowNodeRun | null;
  getWorkflowNodeRunByNode(workflowRunId: string, nodeId: string, attempt: number): WorkflowNodeRun | null;
  getWorkflowNodeRunByChildRun(childRunId: string): WorkflowNodeRun | null;
  listWorkflowNodeRuns(workflowRunId: string): WorkflowNodeRun[];
  enqueueWakeIntent(input: WakeIntentInput): WakeIntent;
  listPendingWakeIntents(organizationId: string, threadId: string): WakeIntent[];
  markWakeIntentDispatched(organizationId: string, intentId: string): void;
  markWakeIntentDropped(organizationId: string, intentId: string): void;
  clearPendingWakeIntents(organizationId: string, threadId: string): void;
  hasPendingWakeIntent(
    organizationId: string,
    memberId: string,
    threadId: string,
    messageId: string,
  ): boolean;
  saveTaskSession(session: TaskSession): TaskSession;
  getTaskSession(organizationId: string, taskSessionId: string): TaskSession | null;
  getTaskSessionBySlug(organizationId: string, slug: string): TaskSession | null;
  getTaskSessionByChannel(organizationId: string, channelId: string): TaskSession | null;
  findOpenTaskSessionForChannel?(
    organizationId: string,
    channelId: string,
  ): TaskSession | null;
  listTaskSessions(
    organizationId: string,
    options?: { cursor?: string; limit?: number; status?: TaskSessionStatus },
  ): PaginatedTaskSessions;
  updateTaskSessionStatus(
    organizationId: string,
    taskSessionId: string,
    status: TaskSessionStatus,
    options?: { summary?: string; completedAt?: string },
  ): TaskSession | null;
  saveApproval(approval: ApprovalRequest): ApprovalRequest;
  getApproval(organizationId: string, approvalId: string): ApprovalRequest | null;
  resolveApproval(
    organizationId: string,
    approvalId: string,
    status: 'approved' | 'rejected',
    reason?: string,
  ): ApprovalRequest | null;
  deleteApproval(organizationId: string, approvalId: string): void;
  listPendingApprovals(organizationId: string): ApprovalRequest[];
  hasApprovalGrant(input: {
    organizationId: string;
    resourceType: ApprovalRequest['resourceType'];
    action: ApprovalRequest['action'];
    approvalScope: string;
  }): boolean;
  saveAuditEvent(event: AuditEvent): AuditEvent;
  listAuditEvents(organizationId: string): AuditEvent[];
  // §9.4 / PR 9 — curation suggestions store. PR 8 ships the surface;
  // the analysis job in PR 9 will be the primary writer, and a settings
  // panel "Show usage" sublink the primary reader.
  saveTierCurationSuggestion(suggestion: TierCurationSuggestion): TierCurationSuggestion;
  listTierCurationSuggestions(organizationId: string): TierCurationSuggestion[];
  // PR 9 — persists the operator's Apply/Dismiss decision so a
  // refresh doesn't resurface a row they've already acted on.
  // Returns the updated row, or null if no such row exists.
  updateTierCurationSuggestionStatus(
    organizationId: string,
    suggestionId: string,
    nextStatus: 'pending' | 'applied' | 'dismissed',
    resolvedAt: string,
  ): TierCurationSuggestion | null;
  /**
   * Run a synchronous DB transaction. The callback must complete
   * synchronously — async work belongs after the commit. See
   * `Repository.transaction` for the underlying contract.
   */
  transaction<T>(fn: () => T): T;
  saveSpirit(spirit: Spirit): Spirit;
  getSpirit(organizationId: string, spiritId: string): Spirit | null;
  getSpiritByTriple(
    organizationId: string,
    taskSessionId: string,
    memberId: string,
    role: SpiritRole,
  ): Spirit | null;
  getSpiritByRunId(organizationId: string, runId: string): Spirit | null;
  listSpiritsForSession(organizationId: string, taskSessionId: string): Spirit[];
  listActiveSpiritsForMember(organizationId: string, memberId: string): Spirit[];
  /**
   * Generic secret-store passthrough. Values are opaque strings —
   * callers JSON-encode structured payloads (e.g. MCP env maps).
   */
  writeSecret(value: string): string;
  readSecret(keyRef: string): string | null;
  deleteSecret(keyRef: string): void;
  saveMcpServer(server: McpServer): McpServer;
  getMcpServer(organizationId: string, serverId: string): McpServer | null;
  getMcpServerByName(organizationId: string, name: string): McpServer | null;
  listMcpServers(organizationId: string): McpServer[];
  deleteMcpServer(organizationId: string, serverId: string): void;
  saveAgentMcpAttachment(attachment: AgentMcpAttachment): AgentMcpAttachment;
  // PR 1 substrate; surfaced on the interface in PR 6 so the API
  // service layer (McpRegistryService.updateAttachmentTier) can call
  // it via the abstract repo type rather than the concrete Repository.
  updateAttachmentTier(
    organizationId: string,
    memberId: string,
    mcpServerId: string,
    tier: AgentMcpAttachment['tier'],
    updatedAt: string,
  ): AgentMcpAttachment | null;
  deleteAgentMcpAttachment(
    organizationId: string,
    memberId: string,
    mcpServerId: string,
  ): void;
  listAgentMcpAttachments(
    organizationId: string,
    memberId: string,
  ): AgentMcpAttachment[];
  listMcpServerAttachments(
    organizationId: string,
    mcpServerId: string,
  ): AgentMcpAttachment[];
  // PR 10 — channel attachments. The V2 spawn's §17.5.3 union step
  // pulls every channel attachment for every channel the spawning
  // agent is a member of via listChannelMcpAttachmentsForMember; the
  // settings panel uses the per-channel list/save/delete surface.
  saveChannelMcpAttachment(attachment: ChannelMcpAttachment): ChannelMcpAttachment;
  updateChannelAttachmentTier(
    organizationId: string,
    channelId: string,
    mcpServerId: string,
    tier: ChannelMcpAttachment['tier'],
    updatedAt: string,
  ): ChannelMcpAttachment | null;
  deleteChannelMcpAttachment(
    organizationId: string,
    channelId: string,
    mcpServerId: string,
  ): void;
  listChannelMcpAttachments(
    organizationId: string,
    channelId: string,
  ): ChannelMcpAttachment[];
  listChannelMcpAttachmentsForMember(
    organizationId: string,
    memberId: string,
  ): ChannelMcpAttachment[];
  // Agent-generated attachments (agent_attachments_plan.md).
  saveAgentAttachment(attachment: AgentAttachment): AgentAttachment;
  getAgentAttachment(organizationId: string, id: string): AgentAttachment | null;
  findAgentAttachmentByToolCall(
    organizationId: string,
    toolCallId: string,
    index: number,
  ): AgentAttachment | null;
  pinAgentAttachmentToMessage(
    organizationId: string,
    id: string,
    messageId: string,
  ): AgentAttachment | null;
  listAgentAttachmentsForRun(
    organizationId: string,
    runId: string,
  ): AgentAttachment[];
  listExpiredUnpinnedAgentAttachments(
    organizationId: string,
    createdBefore: string,
  ): AgentAttachment[];
  deleteAgentAttachment(organizationId: string, id: string): void;
  sumAgentAttachmentBytes(organizationId: string): number;
  listAttachedServersForSpirit(
    organizationId: string,
    memberId: string,
    role: 'worker' | 'supervisor',
  ): { attachment: AgentMcpAttachment; server: McpServer }[];
  saveMcpToolCache(cache: McpToolCache): McpToolCache;
  getMcpToolCache(organizationId: string, mcpServerId: string): McpToolCache | null;
  getMcpToolClassification(
    organizationId: string,
    mcpServerId: string,
    toolName: string,
  ): McpToolClassification | null;
  listMcpToolClassifications(
    organizationId: string,
    mcpServerId?: string,
  ): McpToolClassification[];
  upsertMcpToolClassification(
    payload: McpToolClassification,
  ): McpToolClassification;
  seedInferredClassifications(
    organizationId: string,
    mcpServerId: string,
    entries: readonly {
      toolName: string;
      risk: ToolRiskClass;
      needsReview?: boolean;
      reason?: string;
    }[],
    updatedBy?: string,
  ): number;
  deleteMcpToolClassification(
    organizationId: string,
    mcpServerId: string,
    toolName: string,
  ): void;
  getGovernancePolicy(organizationId: string): GovernancePolicy;
  saveGovernancePolicy(
    organizationId: string,
    policy: GovernancePolicy,
  ): GovernancePolicy;
  saveAgentToolAttachment(attachment: AgentToolAttachment): AgentToolAttachment;
  deleteAgentToolAttachment(
    organizationId: string,
    memberId: string,
    mcpServerId: string,
    toolName: string,
  ): void;
  listAgentToolAttachments(
    organizationId: string,
    memberId: string,
    mcpServerId?: string,
  ): AgentToolAttachment[];
  listAgentsForTool(
    organizationId: string,
    mcpServerId: string,
    toolName: string,
  ): string[];
  countAgentToolAttachments(
    organizationId: string,
    memberId: string,
    mcpServerId: string,
  ): number;
  deleteAgentToolAttachmentsForAgent(
    organizationId: string,
    memberId: string,
    mcpServerId?: string,
  ): void;
  savePluginInstall(install: PluginInstall): PluginInstall;
  getPluginInstall(organizationId: string, installId: string): PluginInstall | null;
  getPluginInstallBySourceUrl(
    organizationId: string,
    sourceUrl: string,
  ): PluginInstall | null;
  listPluginInstalls(organizationId: string): PluginInstall[];
  deletePluginInstall(organizationId: string, installId: string): void;
  saveOrganizationSkillInstall(install: SkillInstall): SkillInstall;
  getOrganizationSkillInstall(organizationId: string, installId: string): SkillInstall | null;
  listOrganizationSkillInstalls(organizationId: string): SkillInstall[];
  deleteOrganizationSkillInstall(organizationId: string, installId: string): void;
  saveGoal(goal: Goal): Goal;
  getGoal(organizationId: string, goalId: string): Goal | null;
  getGoalByChannel(organizationId: string, channelId: string): Goal | null;
  listGoalsByChannel(organizationId: string, channelId: string): Goal[];
  listGoals(organizationId: string): Goal[];
  saveGoalTask(task: GoalTask): GoalTask;
  deleteGoalTasks(organizationId: string, goalId: string): void;
  getGoalTask(organizationId: string, taskId: string): GoalTask | null;
  listGoalTasks(organizationId: string, goalId: string): GoalTask[];
  listGoalTasksByOrganization(organizationId: string): GoalTask[];
  setGoalTaskLastNudgedAt?(
    organizationId: string,
    taskId: string,
    isoTimestamp: string,
  ): void;
  updateGoalTaskStatus(
    organizationId: string,
    taskId: string,
    status: GoalTaskStatus,
    options?: { handoverSummary?: string },
  ): GoalTask | null;
  saveInteractiveQuestion(question: InteractiveQuestion): InteractiveQuestion;
  getInteractiveQuestion(organizationId: string, questionId: string): InteractiveQuestion | null;
  listPendingInteractiveQuestions(organizationId: string, channelId: string): InteractiveQuestion[];
  listInteractiveQuestionsByRunId(organizationId: string, runId: string): InteractiveQuestion[];

  // Bet 5 — memory_entries KV. All optional because the in-memory
  // test repos don't implement them; services degrade gracefully
  // when absent.
  upsertMemoryEntry?(entry: MemoryEntry): Promise<MemoryEntry> | MemoryEntry;
  recallMemoryEntries?(input: {
    organizationId: string;
    memberId?: string;
    kind?: MemoryEntryKind;
    keyPrefix?: string;
    query?: string;
    limit?: number;
    touch?: boolean;
  }): Promise<MemoryEntry[]> | MemoryEntry[];
  deleteMemoryEntry?(
    organizationId: string,
    memberId: string | null,
    key: string,
  ): Promise<boolean> | boolean;
  deleteExpiredMemoryEntries?(nowIso: string): number;

  // Bet 4 — workspace files FTS index.
  upsertWorkspaceFile?(
    input: WorkspaceFile,
    caps?: { perOrgByteCap?: number; perFileByteCap?: number },
  ): WorkspaceFile;
  deleteWorkspaceFile?(organizationId: string, path: string): boolean;
  searchWorkspaceFiles?(input: {
    organizationId: string;
    query: string;
    limit?: number;
    sinceIso?: string;
  }): {
    path: string;
    snippet: string;
    rank: number;
    writtenBy: string;
    channelId?: string;
    updatedAt: string;
  }[];
  // Bet 6 — append-only decision log.
  appendDecisionLogEntry?(entry: DecisionLogEntry): DecisionLogEntry;
  listDecisionLogForChannel?(
    organizationId: string,
    channelId: string,
    limit?: number,
  ): DecisionLogEntry[];
  findDecisionBySourceMessage?(
    organizationId: string,
    sourceMessageId: string,
  ): DecisionLogEntry | null;

  // Procedures as Culture (docs/procedures-as-culture.md). Optional —
  // older Repository fakes in tests can omit these without breaking.
  appendProcedureRevision?(rev: ProcedureRevision): ProcedureRevision;
  listProcedureRevisions?(input: {
    organizationId: string;
    scope: string;
    scopeId: string;
    name: string;
    limit?: number;
  }): ProcedureRevision[];
  recordProceduresApplied?(input: {
    organizationId: string;
    runId: string;
    applied: { scope: string; scopeId: string; name: string; version: number; enforced: boolean }[];
  }): void;
  listRunProceduresApplied?(
    organizationId: string,
    runId: string,
  ): RunProcedureApplied[];

  deleteMessages(organizationId: string, messageIds: string[]): void;
  saveOrganization(organization: Organization): Organization;
  getLatestOrganization(): Organization | null;
  listOrganizations(): Organization[];
  listOrganizationsWithSignIn(): Organization[];
  organizationHasAuthUsers(organizationId: string): boolean;
  deleteOrganizationData(organizationId: string): void;
  saveWorkspaceSetting(organizationId: string, key: string, value: string): void;
  getWorkspaceSetting(organizationId: string, key: string): string | null;
  deleteWorkspaceSetting(organizationId: string, key: string): void;
  findOrganizationIdByWorkspaceSetting(key: string, value: string): string | null;
  saveProviderCredential(
    organizationId: string,
    providerName: string,
    apiKey: string,
  ): void;
  deleteProviderCredential(organizationId: string, providerName: string): void;
  listProviderCredentials(organizationId: string): Record<string, boolean>;
  saveConfigFieldOwnership(ownership: ConfigFieldOwnership): ConfigFieldOwnership;
  getConfigFieldOwnership(
    organizationId: string,
    entityType: ConfigFieldOwnership['entityType'],
    entityId: string,
    fieldName: string,
  ): ConfigFieldOwnership | null;
  listConfigFieldOwnership(
    organizationId: string,
    entityType?: ConfigFieldOwnership['entityType'],
  ): ConfigFieldOwnership[];
  saveMember(member: Member): Member;
  saveWorkspaceMember(workspaceMember: WorkspaceMember): WorkspaceMember;
  saveAuthUser(input: StoredAuthUser): AuthUser;
  getAuthUserById(userId: string): AuthUser | null;
  getAuthUserByMember(organizationId: string, memberId: string): AuthUser | null;
  getAuthUserCredentials(
    organizationId: string,
    emailNormalized: string,
  ): StoredAuthUser | null;
  findAuthUsersByEmail(emailNormalized: string): StoredAuthUser[];
  saveAuthSession(input: StoredAuthSession): AuthSession;
  getAuthSessionByTokenHash(sessionTokenHash: string): StoredAuthSession | null;
  revokeAuthSession(sessionId: string, revokedAt?: string): AuthSession | null;
  touchAuthSession(sessionId: string, lastSeenAt?: string): AuthSession | null;
  getBootstrapSnapshot(organizationId?: string): BootstrapSnapshot;
  saveMemory(entry: MemoryEntry): Promise<MemoryEntry> | MemoryEntry;
  getMemory(organizationId: string, memoryId: string): MemoryEntry | null;
  listMemories(organizationId: string, memberId: string): MemoryEntry[];
  listOrgMemories(organizationId: string): MemoryEntry[];
  deleteMemory(organizationId: string, memoryId: string): Promise<void> | void;
  listGovernanceRules?(organizationId: string, state?: string): GovernanceRuleRow[];
  deleteGovernanceRule?(
    organizationId: string,
    agentId: string,
    mcpId: string,
    toolName: string,
  ): GovernanceRuleRow | null;
  saveGovernanceRule?(rule: {
    id: string;
    organizationId: string;
    agentId: string;
    mcpId: string;
    toolName: string;
    state: string;
    reason?: string;
    updatedBy?: string;
  }): GovernanceRuleRow;

  // First-class child-task records (replaces message-metadata delegation).
  saveChildTask?(task: ChildTask): ChildTask;
  getChildTask?(organizationId: string, taskId: string): ChildTask | null;
  listChildTasksByParentRun?(organizationId: string, parentRunId: string): ChildTask[];
  listChildTasksByTargetAgent?(organizationId: string, targetAgentId: string): ChildTask[];
  updateChildTask?(organizationId: string, taskId: string, updates: Partial<ChildTask>): ChildTask | null;
}

// ── Narrow port types ─────────────────────────────────────────────
// Each picks only the methods its domain needs from ApiRepository.
// Services should migrate from ApiRepository to the narrowest port.

export type RunStore = Pick<
  ApiRepository,
  | 'saveRun'
  | 'getRun'
  | 'listRuns'
  | 'listActiveRuns'
  | 'listThreadRuns'
  | 'saveRunStep'
  | 'listRunSteps'
  | 'findActiveRunForMemberThread'
>;

export type MemberStore = Pick<
  ApiRepository,
  | 'getOrganization'
  | 'listOrganizations'
  | 'saveOrganization'
  | 'saveWorkspaceSetting'
  | 'getWorkspaceSetting'
  | 'deleteWorkspaceSetting'
  | 'saveMember'
  | 'saveWorkspaceMember'
  | 'getMember'
  | 'listMembers'
  | 'getWorkspaceMember'
  | 'listWorkspaceMembers'
  | 'saveSpirit'
  | 'getSpirit'
  | 'getSpiritByTriple'
  | 'getSpiritByRunId'
  | 'listActiveSpiritsForMember'
  | 'listSpiritsForSession'
  | 'getTaskSession'
>;

export type MessageStore = Pick<
  ApiRepository,
  | 'saveMessage'
  | 'updateMessage'
  | 'getMessage'
  | 'findMessageByClientId'
  | 'getLatestHumanMessageInThread'
  | 'listMessages'
  | 'listChannelMessages'
  | 'searchChannelMessages'
  | 'countMessagesSince'
  | 'countUncompactedMessageChars'
  | 'replaceMessageMentions'
  | 'getThread'
  | 'ensureThread'
  | 'getAttachment'
  | 'listMessageAttachments'
  | 'saveAttachment'
  | 'deleteAttachment'
  | 'linkAttachmentsToMessage'
>;

export type ChannelStore = Pick<
  ApiRepository,
  | 'saveChannel'
  | 'getChannel'
  | 'listAllChannels'
  | 'listChannels'
  | 'setChannelMembers'
  | 'deleteChannel'
  | 'setChannelMemberMode'
  | 'getChannelMemberMode'
  | 'listChannelMemberModes'
  | 'listChannelMemberModesForChannel'
  | 'deleteChannelMemberMode'
>;

/**
 * Everything ConversationService (plus its MentionResolver, WakeDispatcher,
 * and compaction collaborators) reads or writes. Services should take this
 * slice instead of the full ConversationRepository/ApiRepository.
 */
export type ConversationStore = Pick<
  ApiRepository,
  | 'ensureThread'
  | 'findMessageByClientId'
  | 'getAttachment'
  | 'getChannel'
  | 'getChannelMemberMode'
  | 'getMember'
  | 'getMessage'
  | 'getOrganization'
  | 'getRun'
  | 'getThread'
  | 'linkAttachmentsToMessage'
  | 'listAllChannels'
  | 'listChannelMessages'
  | 'listChannels'
  | 'listMembers'
  | 'listMessageAttachments'
  | 'listMessages'
  | 'replaceMessageMentions'
  | 'saveChannel'
  | 'saveMessage'
  | 'saveRun'
  | 'searchChannelMessages'
  | 'setChannelMembers'
  | 'updateMessage'
  | 'countUncompactedMessageChars'
  | 'listRunSteps'
>;

/** Persistence boundary for one Agent turn. Keep the turn off ApiRepository. */
export type AgentTurnStore = RunStore &
  MemberStore &
  MessageStore &
  ChannelStore &
  Pick<
    ApiRepository,
    | 'getInteractiveQuestion'
    | 'recordProceduresApplied'
    | 'listOrganizationSkillInstalls'
    | 'listPendingApprovals'
  >;
