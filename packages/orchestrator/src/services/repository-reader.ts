import type {
  AgentMcpAttachment,
  AgentToolAttachment,
  ApprovalRequest,
  AuthSession,
  AuthUser,
  AuditEvent,
  Attachment,
  Channel,
  ChannelKind,
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
  Spirit,
  SpiritRole,
  SkillInstall,
  TaskSession,
  TaskSessionStatus,
  Todo,
  TodoStatus,
  ToolRiskClass,
  WorkspaceFile,
  WorkspaceMember,
} from '@ujima/shared';

export interface PaginatedTaskSessions {
  data: TaskSession[];
  nextCursor?: string;
  hasMore: boolean;
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
  listRunSteps?(organizationId: string, runId: string): RunStep[];
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
  setChannelMembers(channelId: string, memberIds: string[]): void;
  deleteChannel(channelId: string): void;
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
  saveRun(run: RunState): RunState;
  saveRunStep(step: RunStep): RunStep;
  listRunSteps(organizationId: string, runId: string): RunStep[];
  listRuns(
    organizationId: string,
    cursor?: string,
    limit?: number,
  ): PaginatedRuns;
  listThreadRuns(
    organizationId: string,
    threadId: string,
    cursor?: string,
    limit?: number,
  ): PaginatedRuns;
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
  saveTodo(todo: Todo): Todo;
  getTodo(organizationId: string, todoId: string): Todo | null;
  listTodosForSession(
    organizationId: string,
    taskSessionId: string,
    options?: { status?: TodoStatus; memberId?: string },
  ): Todo[];
  listTodosForChannel?(
    organizationId: string,
    channelId: string,
    options?: { status?: TodoStatus; memberId?: string },
  ): Todo[];
  listIdleCommitments?(options: {
    idleSinceIso: string;
    statuses?: readonly TodoStatus[];
    limit?: number;
  }): Todo[];
  /**
   * Open commitments owned by `memberId` across every channel.
   * Surfaces into `<workspace-state>` so an agent juggling multiple
   * channels sees what's owed across the workspace, not just the
   * current channel. Optional because the narrow test repo doesn't
   * implement it.
   */
  listOpenCommitmentsForMember?(
    organizationId: string,
    memberId: string,
    options?: { statuses?: readonly TodoStatus[]; limit?: number },
  ): Todo[];
  listExpiredCommitments?(options: { nowIso: string; limit?: number }): Todo[];
  /**
   * Atomic flip from "open + past due" → `expired`. Returns true on
   * successful claim. The sweeper claims first, then publishes the
   * system message, so a crash causes one missed letter rather than a
   * duplicate one.
   */
  claimExpiredCommitment?(todoId: string, nowIso: string): boolean;
  /**
   * Dedup lookup for the commitment extractor. Returns the most-
   * recently-created open commitment for a `(org, channel, member)`
   * triple within `sinceIso`. Optional because the existing in-memory
   * test repository doesn't implement it — the service falls back to
   * "always insert" if absent.
   */
  findOpenChannelCommitmentForMember?(
    organizationId: string,
    channelId: string,
    memberId: string,
    sinceIso: string,
  ): Todo | null;
  /** Reverse-lookup from a source message to its originating commitment. */
  findCommitmentBySourceMessage?(
    organizationId: string,
    sourceMessageId: string,
  ): Todo | null;

  // Bet 5 — memory_entries KV. All optional because the in-memory
  // test repos don't implement them; services degrade gracefully
  // when absent.
  upsertMemoryEntry?(entry: MemoryEntry): MemoryEntry;
  recallMemoryEntries?(input: {
    organizationId: string;
    memberId?: string;
    kind?: MemoryEntryKind;
    keyPrefix?: string;
    query?: string;
    limit?: number;
    touch?: boolean;
  }): MemoryEntry[];
  deleteMemoryEntry?(
    organizationId: string,
    memberId: string | null,
    key: string,
  ): boolean;
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
  /**
   * Recent-artifacts projection — used by `<workspace-state>` to
   * surface file paths written in the lookback window. Optional
   * because narrow test repos don't implement it.
   */
  listRecentWorkspaceArtifacts?(input: {
    organizationId: string;
    sinceIso?: string;
    memberId?: string;
    channelId?: string;
    limit?: number;
  }): {
    path: string;
    writtenBy: string;
    channelId?: string;
    updatedAt: string;
    sizeBytes: number;
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

  updateTodoStatus(
    organizationId: string,
    todoId: string,
    status: TodoStatus,
    options?: { notes?: string },
  ): Todo | null;
  deleteMessages(organizationId: string, messageIds: string[]): void;
  saveOrganization(organization: Organization): Organization;
  getLatestOrganization(): Organization | null;
  listOrganizations(): Organization[];
  listOrganizationsWithSignIn(): Organization[];
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
}
