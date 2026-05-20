import type {
  AgentMcpAttachment,
  ApprovalRequest,
  AuthSession,
  AuthUser,
  AuditEvent,
  Attachment,
  Channel,
  ChannelKind,
  ConfigFieldOwnership,
  ConversationThread,
  McpServer,
  McpToolCache,
  Member,
  Message,
  MessageMention,
  Organization,
  RunState,
  RunStep,
  Spirit,
  SpiritRole,
  TaskSession,
  TaskSessionStatus,
  Todo,
  TodoStatus,
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
  listRunSteps?(organizationId: string, runId: string): RunStep[];
  /**
   * Optional lookup so ai-service can read the wake-trigger
   * sourceMessageId off the run row to anchor the
   * `<thread-state>` injection. Optional for backwards
   * compatibility with narrower repo surfaces (mocks, tests).
   */
  getRun?(organizationId: string, runId: string): RunState | null;
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
   * message with the same (org, sender, clientMessageId) triple,
   * or null. Optional on the interface so older repository
   * implementations don't have to implement it immediately — the
   * conversation service treats `undefined` as "no idempotency
   * support" and falls back to the always-insert path.
   */
  findMessageByClientId?(
    organizationId: string,
    senderId: string,
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
    options?: { cursor?: string; since?: string; limit?: number },
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
    requestedBy: string;
    resourceType: ApprovalRequest['resourceType'];
    resourcePath: string;
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
  saveTodo(todo: Todo): Todo;
  getTodo(organizationId: string, todoId: string): Todo | null;
  listTodosForSession(
    organizationId: string,
    taskSessionId: string,
    options?: { status?: TodoStatus; memberId?: string },
  ): Todo[];
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
  saveWorkspaceSetting(organizationId: string, key: string, value: string): void;
  getWorkspaceSetting(organizationId: string, key: string): string | null;
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
  getBootstrapSnapshot(): BootstrapSnapshot;
}
