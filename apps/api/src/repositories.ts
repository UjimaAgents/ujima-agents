import type { Database } from "bun:sqlite";
import type {
  ApprovalRequest,
  AuditEvent,
  Channel,
  ConversationThread,
  Message,
  Member,
  Organization,
  RunState,
} from "@ujima/shared";
import { getBootstrapSnapshot as readBootstrapSnapshot } from "./repositories/bootstrap.ts";
import {
  getApproval as readApproval,
  listPendingApprovals as readPendingApprovals,
  resolveApproval as resolveApprovalRecord,
  saveApproval as writeApproval,
} from "./repositories/approvals.ts";
import { getChannel as readChannel, listChannels as readChannels, saveChannel as writeChannel, setChannelMembers } from "./repositories/channels.ts";
import { saveAuditEvent as writeAuditEvent } from "./repositories/audit.ts";
import { getMember as readMember, listMembers as readMembers, saveMember as writeMember } from "./repositories/members.ts";
import {
  getOrganization as readOrganization,
  getLatestOrganization as readLatestOrganization,
  getProviderCredential as readProviderCredential,
  listProviderCredentials as readProviderCredentials,
  saveOrganization as writeOrganization,
  saveProviderCredential as writeProviderCredential,
} from "./repositories/organization.ts";
import { getRun as readRun, listRuns as readRuns, saveRun as writeRun } from "./repositories/runs.ts";
import { ensureThread as ensureThreadRecord, getThread as readThread, saveThread as writeThread, setThreadMembers as writeThreadMembers } from "./repositories/threads.ts";
import { listMessages as readMessages, saveMessage as writeMessage } from "./repositories/messages.ts";

export class Repository {
  constructor(private readonly db: Database) {}

  getOrganization = (organizationId: string): Organization | null => readOrganization(this.db, organizationId);
  getLatestOrganization = (): Organization | null => readLatestOrganization(this.db);
  saveOrganization = (organization: Organization): Organization => writeOrganization(this.db, organization);
  saveProviderCredential = (organizationId: string, providerName: string, apiKey: string) =>
    writeProviderCredential(this.db, organizationId, providerName, apiKey);
  listProviderCredentials = (organizationId: string): Record<string, boolean> =>
    readProviderCredentials(this.db, organizationId);
  getProviderCredential = (organizationId: string, providerName: string): string | null =>
    readProviderCredential(this.db, organizationId, providerName);

  saveMember = (member: Member): Member => writeMember(this.db, member);
  getMember = (organizationId: string, memberId: string): Member | null => readMember(this.db, organizationId, memberId);
  listMembers = (organizationId: string): Member[] => readMembers(this.db, organizationId);

  saveChannel = (channel: Channel): Channel => writeChannel(this.db, channel);
  getChannel = (organizationId: string, channelId: string): Channel | null =>
    readChannel(this.db, organizationId, channelId);
  listChannels = (organizationId: string): Channel[] => readChannels(this.db, organizationId);
  setChannelMembers = (channelId: string, memberIds: string[]) => setChannelMembers(this.db, channelId, memberIds);

  saveThread = (thread: ConversationThread): ConversationThread => writeThread(this.db, thread);
  ensureThread = (thread: ConversationThread): ConversationThread => ensureThreadRecord(this.db, thread);
  getThread = (organizationId: string, threadId: string): ConversationThread | null =>
    readThread(this.db, organizationId, threadId);
  setThreadMembers = (threadId: string, memberIds: string[]) => writeThreadMembers(this.db, threadId, memberIds);

  saveMessage = (message: Message): Message => writeMessage(this.db, message);
  listMessages = (organizationId: string, threadId: string): Message[] =>
    readMessages(this.db, organizationId, threadId);

  saveRun = (run: RunState): RunState => writeRun(this.db, run);
  getRun = (organizationId: string, runId: string): RunState | null => readRun(this.db, organizationId, runId);
  listRuns = (organizationId: string): RunState[] => readRuns(this.db, organizationId);

  saveApproval = (approval: ApprovalRequest): ApprovalRequest => writeApproval(this.db, approval);
  getApproval = (organizationId: string, approvalId: string): ApprovalRequest | null =>
    readApproval(this.db, organizationId, approvalId);
  resolveApproval = (
    organizationId: string,
    approvalId: string,
    status: "approved" | "rejected",
    reason = "",
  ): ApprovalRequest | null => resolveApprovalRecord(this.db, organizationId, approvalId, status, reason);
  listPendingApprovals = (organizationId: string): ApprovalRequest[] =>
    readPendingApprovals(this.db, organizationId);

  saveAuditEvent = (event: AuditEvent): AuditEvent => writeAuditEvent(this.db, event);

  getBootstrapSnapshot = () => readBootstrapSnapshot(this.db);
}
