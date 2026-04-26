import type {
  ApprovalRequest,
  AuditEvent,
  Channel,
  ChannelKind,
  ConfigFieldOwnership,
  ConversationThread,
  Member,
  Message,
  MessageMention,
  Organization,
  RunState,
  WorkspaceMember,
} from '@ujima/shared';

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
  listMessages(organizationId: string, threadId: string): PaginatedMessages;
  getProviderCredential(organizationId: string, providerName: string): string | null;
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
  getThread(organizationId: string, threadId: string): ConversationThread | null;
  ensureThread(thread: ConversationThread): ConversationThread;
  getMessage(organizationId: string, messageId: string): Message | null;
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
  saveMessage(message: Message): Message;
  updateMessage(message: Message): Message;
  replaceMessageMentions(messageId: string, mentions: MessageMention[]): MessageMention[];
  listMessageMentions(messageId: string): MessageMention[];
  deleteMessageMentions(messageId: string): void;
  getRun(organizationId: string, runId: string): RunState | null;
}

/**
 * Full repository surface used by run/tool/approval services. Extends the
 * conversation surface with run, approval, and audit persistence. The
 * runtime-core `Repository` class satisfies this structurally.
 */
export interface ApiRepository extends ConversationRepository {
  saveRun(run: RunState): RunState;
  listRuns(
    organizationId: string,
    cursor?: string,
    limit?: number,
  ): PaginatedRuns;
  saveApproval(approval: ApprovalRequest): ApprovalRequest;
  getApproval(organizationId: string, approvalId: string): ApprovalRequest | null;
  resolveApproval(
    organizationId: string,
    approvalId: string,
    status: 'approved' | 'rejected',
    reason?: string,
  ): ApprovalRequest | null;
  listPendingApprovals(organizationId: string): ApprovalRequest[];
  saveAuditEvent(event: AuditEvent): AuditEvent;
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
  getBootstrapSnapshot(): BootstrapSnapshot;
}
