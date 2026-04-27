import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
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
import {
  getApproval as readApproval,
  listPendingApprovals as readPendingApprovals,
  resolveApproval as resolveApprovalRecord,
  saveApproval as writeApproval,
} from './approvals.js';
import { saveAuditEvent as writeAuditEvent } from './audit.js';
import {
  getBootstrapSnapshot as readBootstrapSnapshot,
  type BootstrapSnapshot,
} from './bootstrap.js';
import {
  getChannel as readChannel,
  listAllChannels as readAllChannels,
  listChannels as readChannels,
  saveChannel as writeChannel,
  setChannelMembers as writeChannelMembers,
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
  deleteMessages as removeMessages,
  getMessage as readMessage,
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
  deleteProviderCredential as removeProviderCredential,
  findOrganizationIdByWorkspaceSetting as readOrganizationIdByWorkspaceSetting,
  getWorkspaceSetting as readWorkspaceSetting,
  getLatestOrganization as readLatestOrganization,
  getOrganization as readOrganization,
  getProviderCredential as readProviderCredential,
  listOrganizations as readOrganizations,
  listProviderCredentials as readProviderCredentials,
  saveWorkspaceSetting as writeWorkspaceSetting,
  saveOrganization as writeOrganization,
  saveProviderCredential as writeProviderCredential,
} from './organization.js';
import {
  getRun as readRun,
  listRuns as readRuns,
  saveRun as writeRun,
  type PaginatedRuns,
} from './runs.js';
import {
  ensureThread as ensureThreadRecord,
  getThread as readThread,
  saveThread as writeThread,
  setThreadMembers as writeThreadMembers,
} from './threads.js';

export class Repository {
  private readonly secrets: SecretStore;

  constructor(private readonly db: DbHandle, secrets?: SecretStore) {
    // Default to an in-memory secret store for tests / dev environments that
    // have not wired a file-backed store. Production callers (runtime/main.ts)
    // pass a createFileSecretStore() instance.
    this.secrets = secrets ?? createInMemorySecretStore();
  }

  getOrganization = (organizationId: string): Organization | null =>
    readOrganization(this.db, organizationId);
  getLatestOrganization = (): Organization | null => readLatestOrganization(this.db);
  listOrganizations = (): Organization[] => readOrganizations(this.db);
  saveOrganization = (organization: Organization): Organization =>
    writeOrganization(this.db, organization);
  saveWorkspaceSetting = (organizationId: string, key: string, value: string): void =>
    writeWorkspaceSetting(this.db, organizationId, key, value);
  getWorkspaceSetting = (organizationId: string, key: string): string | null =>
    readWorkspaceSetting(this.db, organizationId, key);
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
  setChannelMembers = (channelId: string, memberIds: string[]): void =>
    writeChannelMembers(this.db, channelId, memberIds);

  saveThread = (thread: ConversationThread): ConversationThread =>
    writeThread(this.db, thread);
  ensureThread = (thread: ConversationThread): ConversationThread =>
    ensureThreadRecord(this.db, thread);
  getThread = (organizationId: string, threadId: string): ConversationThread | null =>
    readThread(this.db, organizationId, threadId);
  setThreadMembers = (threadId: string, memberIds: string[]): void =>
    writeThreadMembers(this.db, threadId, memberIds);

  saveMessage = (message: Message): Message => writeMessage(this.db, message);
  updateMessage = (message: Message): Message => writeMessageUpdate(this.db, message);
  getMessage = (organizationId: string, messageId: string): Message | null =>
    readMessage(this.db, organizationId, messageId);
  listMessages = (
    organizationId: string,
    threadId: string,
    cursor?: string,
    limit?: number,
  ): PaginatedMessages => readMessages(this.db, organizationId, threadId, cursor, limit);
  listChannelMessages = (
    organizationId: string,
    channelId: string,
    options?: { cursor?: string; since?: string; limit?: number },
  ): PaginatedMessages => readChannelMessages(this.db, organizationId, channelId, options);
  searchChannelMessages = (
    organizationId: string,
    channelId: string,
    query: string,
    options?: { cursor?: string; since?: string; limit?: number },
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

  saveRun = (run: RunState): RunState => writeRun(this.db, run);
  getRun = (organizationId: string, runId: string): RunState | null =>
    readRun(this.db, organizationId, runId);
  listRuns = (organizationId: string, cursor?: string, limit?: number): PaginatedRuns =>
    readRuns(this.db, organizationId, cursor, limit);

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
  listPendingApprovals = (organizationId: string): ApprovalRequest[] =>
    readPendingApprovals(this.db, organizationId);

  saveAuditEvent = (event: AuditEvent): AuditEvent => writeAuditEvent(this.db, event);

  getBootstrapSnapshot = (): BootstrapSnapshot => readBootstrapSnapshot(this.db);
}

export type {
  BootstrapSnapshot,
  PaginatedChannels,
  PaginatedMessages,
  PaginatedRuns,
};
