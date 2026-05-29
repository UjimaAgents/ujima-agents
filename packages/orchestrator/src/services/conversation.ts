import { randomUUID } from 'node:crypto';
import {
  AGENT_KIND,
  ChannelSchema,
  MessageMentionSchema,
  MessageSchema,
  SocketEventNames,
  channelRoom,
  encodeCursor,
  memberRoom,
  orgRoom,
  threadRoom,
  type Channel,
  type ChannelPassReason,
  type Message,
  type MessageMention,
  buildMentionHandleRegistry,
  getDirectMessageThreadId,
  scanMentionsInContent,
  type WakeReason,
  type WakeSuppressedReason,
  isAgentOnlyThread,
} from '@ujima/shared';
import type { RealtimeService } from './context.js';
import { selfChannelId } from './member-channels.js';
import {
  CONVERSATION_ARCHIVE_MARKER,
  CONVERSATION_COMPACTED_MARKER,
  CONVERSATION_SUMMARY_MARKER,
  SELF_NOTE_COMPACTED_MARKER,
  SELF_NOTE_SUMMARY_MARKER,
  buildSelfNoteSummary,
  buildConversationArchiveSummary,
  buildConversationSummary,
  formatTimestampedContent,
  isArchivedConversation,
  isCompactedConversation,
  isCompactedSelfNote,
  isSelfSummaryNote,
} from './conversation-summary.js';
import type {
  ConversationRepository,
  PaginatedMessages,
} from './repository-reader.js';
import { requireOrganization } from '../utils/require-organization.js';
import { isVacuousAck, shouldSuppressForMirror } from './mirror-guard.js';
import { isAcknowledgementOnly } from './run-reply-guard.js';

const ATTACHMENT_FILE_LIMIT_BYTES = 25 * 1024 * 1024;
const ATTACHMENT_MESSAGE_LIMIT_BYTES = 100 * 1024 * 1024;
const COMPACTION_TRIGGER = 500;
const SELF_NOTE_COMPACTION_BATCH_SIZE = 35;
const SELF_NOTE_RECENT_RAW_COUNT = 15;
const CONVERSATION_COMPACTION_BATCH_SIZE = 35;
const CONVERSATION_RECENT_RAW_COUNT = 15;

export interface ArchivedChannelMessageStore {
  listChannelMessages(input: {
    organizationId: string;
    channelId: string;
    cursor?: string;
    since?: string;
    limit?: number;
  }): Promise<PaginatedMessages>;
  searchChannelMessages(input: {
    organizationId: string;
    channelId: string;
    query: string;
    cursor?: string;
    since?: string;
    limit?: number;
    ranked?: boolean;
  }): Promise<PaginatedMessages>;
}

export interface MemberAlertInput {
  organizationId: string;
  memberId: string;
  channelId?: string;
  threadId: string;
  messageId: string;
  byMemberId: string;
  reason: string;
  /**
   * Typed wake reason that drives mandatory-reply enforcement
   * and observability. The free-form `reason` above is kept for
   * backwards compatibility with existing realtime payloads.
   */
  wakeReason: WakeReason;
}

/**
 * Optional post-publish hook fired after a message is successfully
 * persisted and broadcast. Used by the commitment service to extract
 * "I'll draft X" promises from agent messages and create durable
 * todos. Failures inside the hook do NOT roll the publish back —
 * keeping the chat surface live is more important than the side-
 * effect succeeding.
 */
export type PublishMessageHook = (message: Message) => Promise<void> | void;

export interface ConversationServiceOptions {
  archiveStore?: ArchivedChannelMessageStore;
  onMemberAlerted?: (input: MemberAlertInput) => Promise<void> | void;
  mentionFanoutCap?: number;
  mentionWindowMs?: number;
  /**
   * Hook fired after a message is published. Late-bound from
   * services/index.ts so the commitment service can react to agent
   * "I'll draft X" promises without conversation.ts knowing about
   * it directly. Multiple hooks supported; failures swallowed.
   */
  onMessagePublished?: PublishMessageHook;
}

export class ConversationService {
  private readonly archiveStore?: ArchivedChannelMessageStore;
  private readonly onMemberAlerted?: (input: MemberAlertInput) => Promise<void> | void;
  private readonly mentionFanoutCap: number;
  private readonly mentionWindowMs: number;
  private readonly mentionWindows = new Map<string, number[]>();
  // L11 — channel-read quota is a SEPARATE bucket from the mention
  // quota so ordinary broad-wake chatter doesn't exhaust the
  // mention/DM/handoff circuit-breaker. Cap is intentionally
  // generous (100 / 60s per member/channel) since broad-wake is
  // the expected steady-state load.
  private readonly channelReadCap: number;
  private readonly channelReadWindowMs: number;
  private readonly channelReadWindows = new Map<string, number[]>();
  // Bet 3 — per-pair mention back-pressure. Keyed by
  // `${orgId}|${threadId}|${fromMember}|${toMember}` with a sliding
  // window of recent wake timestamps. When a pair exchanges more
  // than `pairMentionCap` mentions within `pairMentionWindowMs`,
  // the next wake is demoted to `channel-read` so the recipient
  // can `channel.pass` cleanly instead of being forced into another
  // mandatory-reply turn. Resets on any third-party activity in
  // the thread (the recipient gets a fresh quota when content
  // actually changes).
  private readonly pairMentionWindows = new Map<string, number[]>();
  private readonly pairMentionCap = 3;
  private readonly pairMentionWindowMs = 90_000;
  private messagePublishedHook?: PublishMessageHook;

  constructor(
    private readonly repo: ConversationRepository,
    private readonly realtime: RealtimeService,
    options: ConversationServiceOptions = {},
  ) {
    this.archiveStore = options.archiveStore;
    this.onMemberAlerted = options.onMemberAlerted;
    this.mentionFanoutCap = options.mentionFanoutCap ?? 10;
    this.mentionWindowMs = options.mentionWindowMs ?? 60_000;
    this.channelReadCap = 100;
    this.channelReadWindowMs = 60_000;
    this.messagePublishedHook = options.onMessagePublished;
  }

  /**
   * Plug in (or replace) the post-publish hook. Used by
   * services/index.ts to late-bind `CommitmentService` after both
   * services exist (commitment-service needs the conversations
   * instance, conversations needs the hook — same chicken-and-egg
   * we resolved for AiService.setMcpToolResolver).
   */
  setMessagePublishedHook(hook: PublishMessageHook | undefined): void {
    this.messagePublishedHook = hook;
  }

  listChannels(organizationId: string, cursor?: string, limit?: number) {
    requireOrganization(this.repo, organizationId);
    // Filter `self` AND `dm` at the SQL layer.
    //
    // - `self` channels are private agent scratchpads — never surface here.
    // - `dm` channels are private 2-member conversations — they must be
    //   reached via the member-scoped `listVisibleChannels` path
    //   (channel.list tool), never via the public `/api/channels` endpoint.
    //
    // SQL-side filtering is also load-bearing for pagination: post-filtering
    // would let `hasMore` / `nextCursor` drift relative to the rows the
    // caller actually receives, so once a hidden channel exists, the cursor
    // can land on a hidden row and skip visible channels on the next page.
    return this.repo.listChannels(organizationId, cursor, limit, ['self', 'dm']);
  }

  listVisibleChannels(input: {
    organizationId: string;
    memberId: string;
    scope: 'mine' | 'all';
  }): Channel[] {
    requireOrganization(this.repo, input.organizationId);
    const member = this.repo.getMember(input.organizationId, input.memberId);
    if (!member) {
      throw new Error(`Member not found: ${input.memberId}`);
    }

    const channels = this.repo.listAllChannels(input.organizationId);
    if (input.scope === 'mine') {
      return channels.filter((channel) => channel.memberIds.includes(member.id));
    }

    return channels.filter((channel) => this.canMemberAccessChannel(channel, member.id));
  }

  listMessages(
    organizationId: string,
    threadId: string,
    cursor?: string,
    limit?: number,
    memberId?: string,
  ) {
    requireOrganization(this.repo, organizationId);

    if (memberId) {
      this.requireThreadAccess(organizationId, threadId, memberId, 'read');
    }

    const thread = this.repo.getThread(organizationId, threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    const channel = thread.channelId ? this.repo.getChannel(organizationId, thread.channelId) : null;
    return this.decorateMessages(
      this.repo.listMessages(organizationId, threadId, cursor, limit),
      organizationId,
      channel,
    );
  }

  requireThreadAccess(
    organizationId: string,
    threadId: string,
    memberId: string,
    access: 'read' | 'write' = 'write',
  ): void {
    const thread = this.repo.getThread(organizationId, threadId);
    if (!thread) {
      const channel = this.repo.getChannel(organizationId, threadId);
      if (!channel) {
        throw new Error(`Thread not found: ${threadId}`);
      }
      if (channel.archivedAt) {
        throw new Error(`Channel is archived: ${threadId}`);
      }
      if (!this.canMemberAccessChannel(channel, memberId)) {
        if (access === 'read' && this.canObserverReadThread(organizationId, threadId, memberId)) {
          return;
        }
        throw new Error('Forbidden: you do not have access to this thread');
      }
      this.repo.ensureThread({
        id: threadId,
        organizationId,
        channelId: channel.id,
        title: channel.name,
        memberIds: channel.memberIds.length
          ? channel.memberIds
          : this.repo.listMembers(organizationId).map((member) => member.id),
        createdAt: channel.createdAt ?? new Date().toISOString(),
      });
      return;
    }

    if (thread.memberIds.includes(memberId)) {
      return;
    }

    if (thread.channelId) {
      const channel = this.repo.getChannel(organizationId, thread.channelId);
      if (channel && this.canMemberAccessChannel(channel, memberId)) {
        return;
      }
    }

    if (access === 'read' && this.canObserverReadThread(organizationId, threadId, memberId)) {
      return;
    }

    throw new Error('Forbidden: you do not have access to this thread');
  }

  async readChannel(input: {
    organizationId: string;
    memberId: string;
    channelId: string;
    since?: string;
    query?: string;
    cursor?: string;
    limit?: number;
    ranked?: boolean;
  }): Promise<PaginatedMessages> {
    requireOrganization(this.repo, input.organizationId);
    const member = this.repo.getMember(input.organizationId, input.memberId);
    if (!member) {
      throw new Error(`Member not found: ${input.memberId}`);
    }
    const channel = this.requireReadableChannel(input.organizationId, input.channelId, member.id);

    if (input.query?.trim()) {
      const live = this.repo.searchChannelMessages(
        input.organizationId,
        channel.id,
        input.query.trim(),
        {
          cursor: input.cursor,
          since: input.since,
          limit: input.limit,
          ranked: input.ranked,
        },
      );
      const archived = this.archiveStore
        ? await this.archiveStore.searchChannelMessages({
            organizationId: input.organizationId,
            channelId: channel.id,
            query: input.query.trim(),
            cursor: input.cursor,
            since: input.since,
            limit: input.limit,
            ranked: input.ranked,
          })
        : { data: [], hasMore: false, nextCursor: undefined };
      const merged = input.ranked
        ? mergeRankedPaginatedMessages(live, archived, input.limit ?? 50)
        : mergePaginatedMessages(live, archived, input.limit ?? 50);
      return this.decorateMessages(
        merged,
        input.organizationId,
        channel,
      );
    }

    const live = this.repo.listChannelMessages(input.organizationId, channel.id, {
      cursor: input.cursor,
      since: input.since,
      limit: input.limit,
    });
    const archived = this.archiveStore
      ? await this.archiveStore.listChannelMessages({
          organizationId: input.organizationId,
          channelId: channel.id,
          cursor: input.cursor,
          since: input.since,
          limit: input.limit,
        })
      : { data: [], hasMore: false, nextCursor: undefined };
    return this.decorateMessages(
      mergePaginatedMessages(live, archived, input.limit ?? 50),
      input.organizationId,
      channel,
    );
  }

  publishMessage(
    message: Message,
    typedMentions?: MessageMention[],
    attachmentIds?: string[],
    options?: { suppressDmAlerts?: boolean; silent?: boolean; skipMentionResolution?: boolean },
  ) {
    const channel = message.channelId
      ? this.requireActiveChannel(message.organizationId, message.channelId)
      : null;
    const resolvedMentions = options?.skipMentionResolution
      ? typedMentions ?? []
      : typedMentions ?? this.resolveMessageMentions(message.organizationId, message, channel);
    const finalMessage = MessageSchema.parse({
      ...message,
      mentions: uniqueMentionIds(resolvedMentions),
      mentionNames: this.resolveMentionNames(message.organizationId, message.content, channel),
    });
    const existing = this.repo.getMessage(finalMessage.organizationId, finalMessage.id);
    const messageAttachments = (finalMessage as { attachments?: { id: string }[] }).attachments ?? [];
    const linkedAttachmentIds = attachmentIds ?? messageAttachments.map((attachment) => attachment.id);
    if (linkedAttachmentIds.length > 0) {
      this.requireAttachments(finalMessage.organizationId, linkedAttachmentIds);
    }
    if (existing) {
      this.repo.updateMessage({
        ...finalMessage,
        createdAt: existing.createdAt,
        editedAt: new Date().toISOString(),
      });
    } else {
      // L10 — race-safe dedupe: when two concurrent POSTs share a
      // clientMessageId and both pass the `findMessageByClientId`
      // pre-flight, only one wins the UNIQUE partial index. The
      // loser's saveMessage returns the *winner's* row (different
      // `id`, since each request generates a fresh server-side
      // uuid). When that happens we MUST NOT keep going: mention
      // replacement, attachment linking, realtime emit, and wake
      // fanout would all reference an id that was never persisted,
      // and worse, would double-notify agents whose first wake
      // fired when the winner committed.
      const saved = this.repo.saveMessage(finalMessage);
      if (saved.id !== finalMessage.id) {
        return saved;
      }
    }
    this.repo.replaceMessageMentions(finalMessage.id, resolvedMentions);
    if (linkedAttachmentIds.length > 0) {
      this.repo.linkAttachmentsToMessage(finalMessage.id, linkedAttachmentIds);
    }
    const emittedMessage =
      linkedAttachmentIds.length > 0
        ? MessageSchema.parse({
            ...finalMessage,
            attachments: this.repo.listMessageAttachments(finalMessage.id),
          })
        : finalMessage;

    const rooms = this.getPublishRooms(emittedMessage, channel);

    if (!options?.silent) {
      this.realtime.emit(
        channel?.kind === 'dm'
          ? SocketEventNames.dmMessage
          : emittedMessage.channelId
            ? SocketEventNames.channelMessage
            : SocketEventNames.threadMessage,
        channel?.kind === 'dm'
          ? { organizationId: emittedMessage.organizationId, message: emittedMessage }
          : emittedMessage.channelId
            ? { organizationId: emittedMessage.organizationId, channelId: emittedMessage.channelId, message: emittedMessage }
            : { organizationId: emittedMessage.organizationId, threadId: emittedMessage.threadId, message: emittedMessage },
        rooms,
      );

      void this.alertMentionedMembers(emittedMessage, resolvedMentions, channel);
      if (!options?.suppressDmAlerts && !this.shouldSuppressDmWake(emittedMessage, channel)) {
        void this.alertDirectMessageParticipants(emittedMessage, channel);
      }
      // Phase 2 — broad-read fanout for public channels. Every agent
      // in the channel (or every org agent for empty-roster channels)
      // wakes on human-authored, non-system messages. Mentioned
      // agents are already alerted above with reason='mention';
      // we skip them here to avoid double-fire.
      void this.alertChannelReaders(emittedMessage, channel, resolvedMentions);
    }
    // Fire-and-forget; a hook failure must never roll back the publish.
    if (this.messagePublishedHook) {
      void Promise.resolve()
        .then(() => this.messagePublishedHook?.(emittedMessage))
        .catch(() => undefined);
    }
    return emittedMessage;
  }

  /**
   * Channel-read broadcast fanout (Phase 2). Wakes every agent in
   * the channel with `wakeReason='channel-read'` so they can each
   * decide whether to `channel.pass` or post a reply.
   *
   * Bypass rules (L5 + decisions):
   *   - Only when sender is a human, non-system message
   *   - Only public channels (`general` / `group`; not self/dm/task-run)
   *   - Empty-roster channels expand to all org agents
   *   - Sender, mentioned agents (covered by mention fanout),
   *     retired agents, and non-agents are skipped
   */
  private async alertChannelReaders(
    message: Message,
    channel: Channel | null,
    mentions: MessageMention[],
  ): Promise<void> {
    if (!channel) return;
    if (channel.kind !== 'general' && channel.kind !== 'group') return;
    // L5 — system messages must never broad-wake. The throttle
    // notification itself is published with senderKind='human' but
    // senderId='system' / kind='system'. Without these guards a
    // throttle event would broad-wake the channel and re-throttle
    // itself in an unbounded loop.
    if (message.senderKind !== 'human') return;
    if (message.kind === 'system') return;
    if (message.senderId === 'system') return;

    const alreadyMentioned = new Set(mentions.map((m) => m.memberId));

    // Empty roster = "everyone reads" (resolved decision). Walk
    // every org agent. Non-empty roster = walk only enrolled
    // members.
    const candidates =
      channel.memberIds.length === 0
        ? this.repo.listMembers(message.organizationId)
        : channel.memberIds
            .map((memberId) => this.repo.getMember(message.organizationId, memberId))
            .filter((member): member is NonNullable<typeof member> => member !== null);

    const fanout: Promise<void>[] = [];
    for (const member of candidates) {
      if (member.kind !== AGENT_KIND) {
        this.emitWakeSuppressed(message, channel, member.id, 'non-agent-member');
        continue;
      }
      if (member.retiredAt) {
        this.emitWakeSuppressed(message, channel, member.id, 'retired');
        continue;
      }
      if (member.id === message.senderId) {
        this.emitWakeSuppressed(message, channel, member.id, 'sender-self');
        continue;
      }
      if (alreadyMentioned.has(member.id)) {
        // Already covered by alertMentionedMembers with reason='mention'.
        continue;
      }
      // Per-`(member, channelId)` channel-read quota bucket
      // (L11). Separate from the mention bucket so ordinary
      // channel chatter doesn't starve the mention-fanout quota.
      if (!this.consumeChannelReadQuota(message.organizationId, member.id, channel.id)) {
        this.emitWakeSuppressed(message, channel, member.id, 'quota');
        continue;
      }
      fanout.push(this.alertMember(message, member.id, channel, 'channel-read'));
    }
    await Promise.all(fanout);
  }

  private emitWakeSuppressed(
    message: Message,
    channel: Channel | null,
    memberId: string,
    reason: WakeSuppressedReason,
  ): void {
    this.realtime.emit(
      SocketEventNames.wakeSuppressed,
      {
        organizationId: message.organizationId,
        channelId: channel?.id,
        threadId: message.threadId,
        memberId,
        messageId: message.id,
        reason,
        occurredAt: new Date().toISOString(),
      },
      [orgRoom(message.organizationId), memberRoom(memberId)],
    );
  }

  /**
   * Realtime emit for `channel.pass` tool execution. Called by the
   * tool's `execute` method via the ConversationService instance
   * passed into the tool context.
   */
  emitAgentPassed(input: {
    organizationId: string;
    memberId: string;
    runId: string;
    channelId?: string;
    threadId?: string;
    reason: ChannelPassReason;
    note?: string;
  }): void {
    this.realtime.emit(
      SocketEventNames.agentPassed,
      {
        organizationId: input.organizationId,
        channelId: input.channelId,
        threadId: input.threadId,
        memberId: input.memberId,
        runId: input.runId,
        reason: input.reason,
        ...(input.note !== undefined ? { note: input.note } : {}),
        occurredAt: new Date().toISOString(),
      },
      [
        orgRoom(input.organizationId),
        memberRoom(input.memberId),
        ...(input.channelId ? [channelRoom(input.channelId)] : []),
        ...(input.threadId ? [threadRoom(input.threadId)] : []),
      ],
    );
  }

  /**
   * Silent ack from a mandatory-reply turn. No channel message
   * published; the UI affordance shows "Agent X acknowledged"
   * without producing wake-able text that would re-loop the chain.
   */
  emitAgentAck(input: {
    organizationId: string;
    memberId: string;
    runId: string;
    channelId?: string;
    threadId?: string;
    note?: string;
  }): void {
    this.realtime.emit(
      SocketEventNames.agentAck,
      {
        organizationId: input.organizationId,
        channelId: input.channelId,
        threadId: input.threadId,
        memberId: input.memberId,
        runId: input.runId,
        ...(input.note !== undefined ? { note: input.note } : {}),
        occurredAt: new Date().toISOString(),
      },
      [
        orgRoom(input.organizationId),
        memberRoom(input.memberId),
        ...(input.channelId ? [channelRoom(input.channelId)] : []),
        ...(input.threadId ? [threadRoom(input.threadId)] : []),
      ],
    );
  }

  emitMirrorSuppressed(input: {
    organizationId: string;
    memberId: string;
    runId: string;
    channelId?: string;
    threadId?: string;
    suppressedText: string;
    similarityScore: number;
  }): void {
    this.realtime.emit(
      SocketEventNames.mirrorSuppressed,
      {
        organizationId: input.organizationId,
        channelId: input.channelId,
        threadId: input.threadId,
        memberId: input.memberId,
        runId: input.runId,
        suppressedText: input.suppressedText,
        similarityScore: input.similarityScore,
        occurredAt: new Date().toISOString(),
      },
      [
        orgRoom(input.organizationId),
        memberRoom(input.memberId),
        ...(input.channelId ? [channelRoom(input.channelId)] : []),
        ...(input.threadId ? [threadRoom(input.threadId)] : []),
      ],
    );
  }

  /**
   * Check whether an agent's posting-tool body would form a mirror
   * chain in the target thread, and if so emit the suppression
   * event + persist the run's terminating tool as `channel.ack`.
   * Returns true when the caller should SKIP publishing.
   *
   * Centralised here so channel.reply / channel.post / channel.dm /
   * message all use the same gate. The check is read-only against
   * the most recent thread messages — no LLM call.
   */
  tryMirrorSuppress(input: {
    organizationId: string;
    runId: string;
    senderId: string;
    threadId: string;
    channelId?: string;
    body: string;
  }): boolean {
    const recent = this.repo
      .listMessages(input.organizationId, input.threadId, undefined, 12)
      .data
      .filter((message) => message.kind === 'agent')
      .map((message) => ({ senderId: message.senderId, content: message.content }));
    const result = shouldSuppressForMirror({
      candidateBody: input.body,
      recentAgentMessages: recent,
      selfMemberId: input.senderId,
    });
    if (!result.suppress) return false;
    const run = this.repo.getRun?.(input.organizationId, input.runId);
    if (run) {
      this.repo.saveRun?.({
        ...run,
        terminatingTool: 'channel.ack',
      });
    }
    this.emitMirrorSuppressed({
      organizationId: input.organizationId,
      memberId: input.senderId,
      runId: input.runId,
      channelId: input.channelId,
      threadId: input.threadId,
      suppressedText: input.body,
      similarityScore: result.similarityScore,
    });
    return true;
  }

  emitEchoSuppressed(input: {
    organizationId: string;
    fromMemberId: string;
    toMemberId: string;
    channelId?: string;
    threadId?: string;
    countInWindow: number;
  }): void {
    this.realtime.emit(
      SocketEventNames.echoSuppressed,
      {
        organizationId: input.organizationId,
        channelId: input.channelId,
        threadId: input.threadId,
        fromMemberId: input.fromMemberId,
        toMemberId: input.toMemberId,
        countInWindow: input.countInWindow,
        occurredAt: new Date().toISOString(),
      },
      [
        orgRoom(input.organizationId),
        ...(input.channelId ? [channelRoom(input.channelId)] : []),
        ...(input.threadId ? [threadRoom(input.threadId)] : []),
      ],
    );
  }

  /**
   * Shadow-mode verification result for a `channel.pass` decision.
   * Emitted as a `decision:verification_result` socket event for
   * audit/metrics, no runtime enforcement.
   */
  emitDecisionVerification(input: {
    organizationId: string;
    memberId: string;
    runId: string;
    channelId?: string;
    threadId?: string;
    decision: 'channel.pass';
    claimedReason: string;
    verified: boolean;
    failureKinds: readonly string[];
  }): void {
    this.realtime.emit(
      SocketEventNames.decisionVerification,
      {
        organizationId: input.organizationId,
        channelId: input.channelId,
        threadId: input.threadId,
        memberId: input.memberId,
        runId: input.runId,
        decision: input.decision,
        claimedReason: input.claimedReason,
        verified: input.verified,
        failureKinds: [...input.failureKinds],
        occurredAt: new Date().toISOString(),
      },
      [
        orgRoom(input.organizationId),
        memberRoom(input.memberId),
        ...(input.channelId ? [channelRoom(input.channelId)] : []),
        ...(input.threadId ? [threadRoom(input.threadId)] : []),
      ],
    );
  }

  /** Realtime emit for `channel.handoff` tool execution. */
  emitAgentHandoff(input: {
    organizationId: string;
    runId: string;
    messageId: string;
    channelId?: string;
    threadId?: string;
    fromMemberId: string;
    toMemberId: string;
    reason: string;
    complete: boolean;
  }): void {
    this.realtime.emit(
      SocketEventNames.agentHandoff,
      {
        organizationId: input.organizationId,
        channelId: input.channelId,
        threadId: input.threadId,
        fromMemberId: input.fromMemberId,
        toMemberId: input.toMemberId,
        runId: input.runId,
        messageId: input.messageId,
        complete: input.complete,
        reason: input.reason,
        occurredAt: new Date().toISOString(),
      },
      [
        orgRoom(input.organizationId),
        memberRoom(input.fromMemberId),
        memberRoom(input.toMemberId),
        ...(input.channelId ? [channelRoom(input.channelId)] : []),
        ...(input.threadId ? [threadRoom(input.threadId)] : []),
      ],
    );
  }

  sendMessage(input: {
    organizationId: string;
    threadId: string;
    channelId?: string;
    senderId: string;
    content: string;
    mentions?: string[];
    parentMessageId?: string;
    attachmentIds?: string[];
    metadata?: { runId?: string; goalMode?: boolean };
    /** L10 — client-supplied idempotency key. */
    clientMessageId?: string;
  }) {
    requireOrganization(this.repo, input.organizationId);

    const sender = this.repo.getMember(input.organizationId, input.senderId);
    if (!sender) {
      throw new Error(`Sender not found: ${input.senderId}`);
    }

    // Resolve writability FIRST so the dedupe fast-path below can't
    // hand back a cached message to a sender who has since lost
    // channel access. Mirrors the transport-layer guard.
    const channel = input.channelId
      ? this.requireWritableChannel(input.organizationId, input.channelId, sender.id)
      : null;

    // L10 — if a clientMessageId is provided and a message with the
    // same thread-scoped idempotency key already exists, short-circuit
    // and return it.
    if (input.clientMessageId) {
      const existing = this.repo.findMessageByClientId?.(
        input.organizationId,
        input.senderId,
        input.threadId,
        input.clientMessageId,
      );
      if (existing) {
        return existing;
      }
    }

    this.repo.ensureThread({
      id: input.threadId,
      organizationId: input.organizationId,
      channelId: input.channelId,
      title: channel?.name ?? '',
      memberIds: channel?.memberIds ?? [sender.id],
      createdAt: new Date().toISOString(),
    });

    const mentions = new Set<string>(input.mentions ?? []);

    if (input.parentMessageId) {
      const parent = this.requireMessage(input.organizationId, input.parentMessageId);

      // L8 — smart parent-mention inheritance. The original
      // behaviour inherited the FULL parent.mentions set, which
      // turned every threaded reply into a fanout amplifier: a
      // 5-step thread re-pinged everyone tagged anywhere upstream.
      //
      // New rule: always carry forward `parent.senderId` (so
      // task-promoter assignment threading and supervisor-reply
      // re-alerts keep working — both rely on the parent sender
      // being mentioned). Drop transitive parent.mentions
      // entirely. Three-party hand-offs (A→B→C→A) must include
      // explicit @-mentions in the new message body; the
      // rewritten prompt documents this requirement.
      //
      // Bet 3 — vacuous-ack suppression: when the new body is a
      // pure acknowledgement ("Understood", "I'll await", etc.)
      // and the explicit mentions list is empty, do NOT inherit
      // the parent sender as a mention. The reply still publishes,
      // but the counterparty wakes as `channel-read` instead of
      // `mention`, restoring `channel.pass` to the palette and
      // letting them gracefully exit the chain. Without this, two
      // agents auto-re-mention each other on every "noted" turn
      // and the loop never terminates.
      const explicitlyMentions = (input.mentions ?? []).length > 0;
      const bodyIsVacuousAck = isVacuousAck(input.content);
      if (!(bodyIsVacuousAck && !explicitlyMentions)) {
        mentions.add(parent.senderId);
      }
    }

    const message = MessageSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      threadId: input.threadId,
      channelId: input.channelId,
      parentMessageId: input.parentMessageId,
      senderId: input.senderId,
      senderKind: sender.kind,
      kind: sender.kind,
      content: input.content,
      mentions: [...mentions],
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
      createdAt: new Date().toISOString(),
    });

    const published = this.publishMessage(message, undefined, input.attachmentIds);
    this.compactConversationIfNeeded(input.organizationId, input.threadId, input.senderId);
    return published;
  }

  postToChannel(input: {
    organizationId: string;
    senderId: string;
    channelId: string;
    body: string;
    replyTo?: string;
    mentions?: string[];
    metadata?: { runId?: string };
  }) {
    const channel = this.requireActiveChannel(input.organizationId, input.channelId);
    let threadId = channel.id;
    if (input.replyTo) {
      const parent = this.requireMessage(input.organizationId, input.replyTo);
      if (parent.channelId !== channel.id) {
        throw new Error(
          `Cannot reply across channels: parent message ${parent.id} belongs to channel ${parent.channelId}, not ${channel.id}`,
        );
      }
      threadId = parent.threadId;
    }
    return this.sendMessage({
      organizationId: input.organizationId,
      threadId,
      channelId: channel.id,
      senderId: input.senderId,
      content: input.body,
      mentions: input.mentions,
      parentMessageId: input.replyTo,
      metadata: input.metadata,
    });
  }

  replyToMessage(input: {
    organizationId: string;
    senderId: string;
    messageId: string;
    body: string;
    mentions?: string[];
    metadata?: { runId?: string };
  }) {
    const parent = this.requireMessage(input.organizationId, input.messageId);
    return this.sendMessage({
      organizationId: input.organizationId,
      threadId: parent.threadId,
      channelId: parent.channelId,
      senderId: input.senderId,
      content: input.body,
      mentions: input.mentions,
      parentMessageId: parent.id,
      metadata: input.metadata,
    });
  }

  sendDirectMessage(input: {
    organizationId: string;
    senderId: string;
    recipientId: string;
    content: string;
    mentions?: string[];
    parentMessageId?: string;
    ignore?: boolean;
    attachmentIds?: string[];
    metadata?: { runId?: string; goalMode?: boolean };
    /** L10 — client-supplied idempotency key. */
    clientMessageId?: string;
  }) {
    requireOrganization(this.repo, input.organizationId);

    const sender = this.repo.getMember(input.organizationId, input.senderId);
    if (!sender) {
      throw new Error(`Sender not found: ${input.senderId}`);
    }

    if (input.recipientId === 'self') {
      return this.sendSelfNote({
        organizationId: input.organizationId,
        memberId: input.senderId,
        body: input.content,
        attachmentIds: input.attachmentIds,
        clientMessageId: input.clientMessageId,
      });
    }

    const recipient = this.repo.getMember(input.organizationId, input.recipientId);
    if (!recipient) {
      throw new Error(`Recipient not found: ${input.recipientId}`);
    }

    const channelId = getDirectMessageThreadId(sender.id, recipient.id);
    let threadId = channelId;
    let replyChannelId = channelId;
    if (input.parentMessageId) {
      const parent = this.requireMessage(input.organizationId, input.parentMessageId);
      threadId = parent.threadId;
      replyChannelId = parent.channelId ?? channelId;
    }

    if (input.clientMessageId) {
      const existing = this.repo.findMessageByClientId?.(
        input.organizationId,
        input.senderId,
        threadId,
        input.clientMessageId,
      );
      if (existing) {
        return existing;
      }
    }

    const dmChannelName = [sender.name, recipient.name].sort().join(' / ');
    const now = new Date().toISOString();

    const channel = this.repo.saveChannel(ChannelSchema.parse({
      id: channelId,
      organizationId: input.organizationId,
      name: dmChannelName,
      kind: 'dm',
      topic: '',
      memberIds: [sender.id, recipient.id],
    }));
    this.repo.setChannelMembers(channelId, [sender.id, recipient.id]);

    this.repo.ensureThread({
      id: channel.id,
      organizationId: input.organizationId,
      channelId: channel.id,
      title: dmChannelName,
      memberIds: [sender.id, recipient.id],
      createdAt: now,
    });

    const message = MessageSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      threadId,
      channelId: replyChannelId,
      parentMessageId: input.parentMessageId,
      senderId: input.senderId,
      senderKind: sender.kind,
      kind: sender.kind,
      content: input.content,
      mentions: input.mentions ?? [],
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
      createdAt: now,
    });

    const published = this.publishMessage(
      message,
      undefined,
      input.attachmentIds,
      input.ignore ? { suppressDmAlerts: true } : undefined,
    );
    this.compactConversationIfNeeded(input.organizationId, threadId, input.senderId);
    return published;
  }

  /** Persisted DM with `kind: system` (e.g. approval relay to owner). */
  sendDirectSystemMessage(input: {
    organizationId: string;
    memberIdA: string;
    memberIdB: string;
    content: string;
    suppressDmAlerts?: boolean;
    attachmentIds?: string[];
  }) {
    requireOrganization(this.repo, input.organizationId);

    const memberA = this.repo.getMember(input.organizationId, input.memberIdA);
    const memberB = this.repo.getMember(input.organizationId, input.memberIdB);
    if (!memberA) {
      throw new Error(`Member not found: ${input.memberIdA}`);
    }
    if (!memberB) {
      throw new Error(`Member not found: ${input.memberIdB}`);
    }

    const channelId = getDirectMessageThreadId(memberA.id, memberB.id);
    const dmChannelName = [memberA.name, memberB.name].sort().join(' / ');
    const now = new Date().toISOString();

    const channel = this.repo.saveChannel(
      ChannelSchema.parse({
        id: channelId,
        organizationId: input.organizationId,
        name: dmChannelName,
        kind: 'dm',
        topic: '',
        memberIds: [memberA.id, memberB.id],
      }),
    );
    this.repo.setChannelMembers(channelId, [memberA.id, memberB.id]);

    this.repo.ensureThread({
      id: channel.id,
      organizationId: input.organizationId,
      channelId: channel.id,
      title: dmChannelName,
      memberIds: [memberA.id, memberB.id],
      createdAt: now,
    });

    const message = MessageSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      threadId: channel.id,
      channelId: channel.id,
      senderId: 'system',
      senderKind: 'human',
      kind: 'system',
      content: input.content,
      mentions: [],
      createdAt: now,
    });

    return this.publishMessage(message, [], input.attachmentIds, {
      suppressDmAlerts: input.suppressDmAlerts,
      skipMentionResolution: true,
    });
  }

  sendSelfNote(input: {
    organizationId: string;
    memberId: string;
    body: string;
    attachmentIds?: string[];
    clientMessageId?: string;
  }) {
    requireOrganization(this.repo, input.organizationId);
    const member = this.repo.getMember(input.organizationId, input.memberId);
    if (!member) {
      throw new Error(`Member not found: ${input.memberId}`);
    }

    const channelId = selfChannelId(member.id);
    const existing = this.repo.getChannel(input.organizationId, channelId);
    if (!existing) {
      this.repo.saveChannel({
        id: channelId,
        organizationId: input.organizationId,
        name: `${member.name} (self)`,
        kind: 'self',
        topic: 'Private working notes',
        memberIds: [member.id],
      });
      this.repo.setChannelMembers(channelId, [member.id]);
    }
    this.repo.ensureThread({
      id: channelId,
      organizationId: input.organizationId,
      channelId,
      title: `${member.name} (self)`,
      memberIds: [member.id],
      createdAt: new Date().toISOString(),
    });

    if (input.clientMessageId) {
      const existing = this.repo.findMessageByClientId?.(
        input.organizationId,
        member.id,
        channelId,
        input.clientMessageId,
      );
      if (existing) {
        return existing;
      }
    }

    const message = MessageSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      threadId: channelId,
      channelId,
      senderId: member.id,
      senderKind: member.kind,
      kind: member.kind,
      content: input.body,
      ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
      createdAt: new Date().toISOString(),
    });

    const published = this.publishMessage(message, [], input.attachmentIds);
    this.compactSelfNotesIfNeeded(input.organizationId, member.id, channelId);
    return published;
  }

  archiveConversation(input: {
    organizationId: string;
    threadId: string;
    memberId: string;
    mode: 'summarize' | 'clear';
  }) {
    requireOrganization(this.repo, input.organizationId);
    this.requireThreadAccess(input.organizationId, input.threadId, input.memberId);

    const thread = this.repo.getThread(input.organizationId, input.threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${input.threadId}`);
    }

    const messages = this.listAllThreadMessages(input.organizationId, input.threadId);
    const plan =
      input.mode === 'clear'
        ? {
            summaryMarker: CONVERSATION_ARCHIVE_MARKER,
            compactedMarker: CONVERSATION_ARCHIVE_MARKER,
            keepRawCount: 0,
            batchSize: Number.MAX_SAFE_INTEGER,
            buildSummary: buildConversationArchiveSummary,
            publishSummary: true,
          }
        : {
            summaryMarker: CONVERSATION_SUMMARY_MARKER,
            compactedMarker: CONVERSATION_COMPACTED_MARKER,
            keepRawCount: CONVERSATION_RECENT_RAW_COUNT,
            batchSize: CONVERSATION_COMPACTION_BATCH_SIZE,
            buildSummary: buildConversationSummary,
            publishSummary: true,
          };

    return this.compactThreadMessages({
      organizationId: input.organizationId,
      threadId: input.threadId,
      senderId: input.memberId,
      messages,
      ...plan,
    });
  }

  editMessage(input: {
    organizationId: string;
    messageId: string;
    editorId: string;
    content: string;
  }) {
    const existing = this.requireMessage(input.organizationId, input.messageId);
    if (existing.senderId !== input.editorId) {
      throw new Error(`Message "${input.messageId}" cannot be edited by "${input.editorId}"`);
    }
    const explicitMentionIds = this.inferExplicitMentionIds(input.organizationId, existing);
    const channel = existing.channelId ? this.repo.getChannel(input.organizationId, existing.channelId) : null;
    const typedMentions = this.resolveMentionRecords({
      organizationId: input.organizationId,
      messageId: existing.id,
      content: input.content,
      createdAt: existing.createdAt,
      channel,
      senderKind: existing.senderKind,
      explicitMentionIds,
    });
    const updated = this.repo.updateMessage({
      ...existing,
      content: input.content,
      mentions: uniqueMentionIds(typedMentions),
      editedAt: new Date().toISOString(),
    });
    this.repo.replaceMessageMentions(existing.id, typedMentions);
    return updated;
  }

  deleteMessage(input: {
    organizationId: string;
    messageId: string;
    deletedBy: string;
  }) {
    const existing = this.requireMessage(input.organizationId, input.messageId);
    if (existing.senderId !== input.deletedBy) {
      throw new Error(`Message "${input.messageId}" cannot be deleted by "${input.deletedBy}"`);
    }
    const updated = this.repo.updateMessage({
      ...existing,
      content: '[deleted]',
      deletedAt: new Date().toISOString(),
    });
    return updated;
  }

  private async alertMentionedMembers(
    message: Message,
    mentions: MessageMention[],
    channel: Channel | null,
  ): Promise<void> {
    const seen = new Set<string>();
    const fanout: Promise<void>[] = [];
    for (const mention of mentions) {
      if (seen.has(mention.memberId)) continue;
      seen.add(mention.memberId);

      if (mention.memberId === message.senderId) {
        continue;
      }

      const member = this.repo.getMember(message.organizationId, mention.memberId);
      if (!member || member.kind !== AGENT_KIND || member.retiredAt) {
        continue;
      }

      // Mention fan-out must not leak across channel boundaries.
      //
      // - `self` channels are private agent scratchpads; no fan-out at all.
      //   Even an `@mention` in the owner's own self-channel never wakes
      //   another agent.
      // - Any channel with an explicit member roster (DMs always have one,
      //   group/task-run usually do) only delivers mentions to enrolled
      //   members. Without this check, an `@mention` inside a DM could wake
      //   an arbitrary agent and hand them the private DM thread via
      //   `onMemberAlerted`/`generateRunReply`.
      // - Channels with an empty roster (open public channels) keep the
      //   broad fan-out behaviour.
      if (channel) {
        if (channel.kind === 'self') continue;
        if (channel.memberIds.length > 0 && !channel.memberIds.includes(member.id)) {
          continue;
        }
      }

      // Mention fan-out is what wakes dormant agents back into the org loop.
      // We keep the limiter here, before realtime emission and before the
      // follow-up run callback, so both delivery paths agree on whether a wake
      // should happen for this member.
      if (!this.consumeMentionFanoutQuota(message.organizationId, member.id)) {
        this.publishMentionThrottledSystemMessage(message.organizationId, member.id, message.senderId);
        continue;
      }

      // Bet 3 — per-pair back-pressure. If `from→to` has already
      // fired the per-pair cap within the window, demote to
      // channel-read so the recipient can `channel.pass` instead
      // of being forced into another mandatory reply. Emit an
      // observability event so the UI can show "X and Y are
      // looping — wakes demoted".
      const countInWindow = this.recordPairMentionWake(
        message.organizationId,
        message.threadId,
        message.senderId,
        member.id,
      );
      const wakeReason: WakeReason =
        countInWindow > this.pairMentionCap ? 'channel-read' : 'mention';
      if (wakeReason === 'channel-read') {
        this.emitEchoSuppressed({
          organizationId: message.organizationId,
          fromMemberId: message.senderId,
          toMemberId: member.id,
          channelId: channel?.id,
          threadId: message.threadId,
          countInWindow,
        });
      }

      fanout.push(this.alertMember(message, member.id, channel, wakeReason));
    }
    await Promise.all(fanout);
  }

  /**
   * Record a (from→to) mention wake in the per-pair window and
   * return the count of wakes in the window AFTER recording this
   * one. Caller compares against `pairMentionCap` to decide whether
   * to demote.
   */
  private recordPairMentionWake(
    organizationId: string,
    threadId: string,
    fromMemberId: string,
    toMemberId: string,
  ): number {
    const key = `${organizationId}|${threadId}|${fromMemberId}|${toMemberId}`;
    const now = Date.now();
    const windowStart = now - this.pairMentionWindowMs;
    const existing = this.pairMentionWindows.get(key) ?? [];
    const kept = existing.filter((t) => t >= windowStart);
    kept.push(now);
    this.pairMentionWindows.set(key, kept);
    // QA flagged: without eviction of empty keys, every distinct
    // (org, thread, from, to) 4-tuple lives forever. Walk the map
    // periodically (cheap when sizes are small) and delete keys
    // whose newest timestamp has fallen outside the window. Bound
    // the walk by sampling — only sweep when the map crosses a
    // threshold so the cost stays O(1) amortised.
    if (this.pairMentionWindows.size > 1024) {
      for (const [k, timestamps] of this.pairMentionWindows) {
        const last = timestamps[timestamps.length - 1];
        if (last === undefined || last < windowStart) {
          this.pairMentionWindows.delete(k);
        }
      }
    }
    return kept.length;
  }

  private async alertMember(
    message: Message,
    memberId: string,
    channel: Channel | null,
    reason: WakeReason | string,
  ): Promise<void> {
    const member = this.repo.getMember(message.organizationId, memberId);
    if (!member || member.kind !== 'agent' || member.retiredAt) {
      return;
    }

    // Derive the typed wake reason. Callers in this file pass
    // typed values directly; legacy callers may pass a
    // MessageMentionKindSchema value — those default to 'mention'.
    const wakeReason: WakeReason =
      reason === 'mention' ||
      reason === 'dm' ||
      reason === 'channel-read' ||
      reason === 'handoff' ||
      reason === 'parent-thread'
        ? reason
        : 'mention';

    this.realtime.emit(
      SocketEventNames.memberAlerted,
      {
        organizationId: message.organizationId,
        memberId: member.id,
        channelId: channel?.id,
        threadId: message.threadId,
        messageId: message.id,
        byMemberId: message.senderId,
        reason: String(reason),
      },
      [memberRoom(member.id)],
    );

    await this.onMemberAlerted?.({
      organizationId: message.organizationId,
      memberId: member.id,
      channelId: channel?.id,
      threadId: message.threadId,
      messageId: message.id,
      byMemberId: message.senderId,
      reason: String(reason),
      wakeReason,
    });
  }

  private async alertDirectMessageParticipants(
    message: Message,
    channel: Channel | null,
  ): Promise<void> {
    if (!channel || channel.kind !== 'dm') return;
    const recipients = channel.memberIds.filter((memberId) => memberId !== message.senderId);
    await Promise.all(
      recipients.map(async (recipientId) => {
        try {
          const countInWindow = this.recordPairMentionWake(
            message.organizationId,
            message.threadId,
            message.senderId,
            recipientId,
          );
          const wakeReason: WakeReason =
            countInWindow > this.pairMentionCap ? 'channel-read' : 'dm';

          if (wakeReason === 'channel-read') {
            this.emitEchoSuppressed({
              organizationId: message.organizationId,
              fromMemberId: message.senderId,
              toMemberId: recipientId,
              channelId: channel?.id,
              threadId: message.threadId,
              countInWindow,
            });
          }

          await this.alertMember(message, recipientId, channel, wakeReason);
        } catch (error) {
          console.warn('DM participant alert failed', {
            organizationId: message.organizationId,
            messageId: message.id,
            recipientId,
            error,
          });
        }
      }),
    );
  }

  private shouldSuppressDmWake(message: Message, channel: Channel | null): boolean {
    if (!channel || channel.kind !== 'dm') return false;
    if (message.kind !== AGENT_KIND) return false;
    const handoff = (message.metadata as { handoff?: { complete?: boolean } } | undefined)?.handoff;
    return handoff?.complete === true || isAcknowledgementOnly(message.content);
  }

  private publishMentionThrottledSystemMessage(
    organizationId: string,
    memberId: string,
    byMemberId: string,
  ): void {
    const channel = this.repo
      .listAllChannels(organizationId)
      .find((candidate) => candidate.name === 'general' || candidate.id === 'general');
    if (!channel) return;

    const systemMessage = MessageSchema.parse({
      id: randomUUID(),
      organizationId,
      threadId: channel.id,
      channelId: channel.id,
      senderId: 'system',
      senderKind: 'human',
      kind: 'system',
      content: `member.alert_throttled: mention delivery for "${memberId}" by "${byMemberId}" exceeded ${this.mentionFanoutCap} alerts in ${Math.floor(this.mentionWindowMs / 1000)}s`,
      createdAt: new Date().toISOString(),
    });
    this.publishMessage(systemMessage, []);
  }

  private consumeMentionFanoutQuota(organizationId: string, memberId: string): boolean {
    const key = `${organizationId}:${memberId}`;
    const now = Date.now();
    const cutoff = now - this.mentionWindowMs;
    const recent = (this.mentionWindows.get(key) ?? []).filter((sample) => sample > cutoff);
    if (recent.length >= this.mentionFanoutCap) {
      this.mentionWindows.set(key, recent);
      return false;
    }
    recent.push(now);
    this.mentionWindows.set(key, recent);
    return true;
  }

  /**
   * L11 — channel-read quota keyed on `(org, member, channelId)`.
   * Separate from the mention bucket so a heavy broad-wake channel
   * doesn't starve the mention circuit-breaker. Cap is intentionally
   * generous because broad-wake is the steady-state.
   */
  private consumeChannelReadQuota(
    organizationId: string,
    memberId: string,
    channelId: string,
  ): boolean {
    const key = `${organizationId}:${memberId}:${channelId}`;
    const now = Date.now();
    const cutoff = now - this.channelReadWindowMs;
    const recent = (this.channelReadWindows.get(key) ?? []).filter((sample) => sample > cutoff);
    if (recent.length >= this.channelReadCap) {
      this.channelReadWindows.set(key, recent);
      return false;
    }
    recent.push(now);
    this.channelReadWindows.set(key, recent);
    return true;
  }

  private getPublishRooms(message: Message, channel: Channel | null): string[] {
    if (channel?.kind === 'dm' || channel?.kind === 'self') {
      return [
        orgRoom(message.organizationId),
        channelRoom(channel.id),
        threadRoom(message.threadId),
        ...channel.memberIds.map(memberRoom),
      ];
    }

    return [
      orgRoom(message.organizationId),
      ...(message.channelId ? [channelRoom(message.channelId)] : []),
      threadRoom(message.threadId),
    ];
  }

  private resolveMessageMentions(
    organizationId: string,
    message: Message,
    channel: Channel | null,
  ): MessageMention[] {
    return this.resolveMentionRecords({
      organizationId,
      messageId: message.id,
      content: message.content,
      createdAt: message.createdAt,
      channel,
      senderKind: message.senderKind,
      explicitMentionIds: message.mentions,
    });
  }

  private resolveMentionRecords(input: {
    organizationId: string;
    messageId: string;
    content: string;
    createdAt: string;
    channel: Channel | null;
    senderKind: string;
    explicitMentionIds?: string[];
  }): MessageMention[] {
    const mentionIds = this.resolveMentionIds(
      input.organizationId,
      input.content,
      input.channel,
      input.senderKind,
      input.explicitMentionIds ?? [],
    );
    return mentionIds.map((memberId) =>
      MessageMentionSchema.parse({
        id: randomUUID(),
        messageId: input.messageId,
        memberId,
        kind: 'mention',
        createdAt: input.createdAt,
      }),
    );
  }

  private resolveMentionIds(
    organizationId: string,
    content: string,
    channel: Channel | null,
    senderKind: string,
    explicitMentionIds: string[],
  ): string[] {
    const mentionIds = new Set<string>(explicitMentionIds);
    const registry = buildMentionHandleRegistry(
      this.repo.listMembers(organizationId).flatMap((member) => [
        { handle: member.id, value: member.id },
        { handle: member.name, value: member.id },
      ]),
    );

    scanMentionsInContent(content, registry, {
      allowAll: senderKind !== AGENT_KIND,
      onAll: () => {
        for (const memberId of this.resolveAllMentionIds(organizationId, channel)) {
          mentionIds.add(memberId);
        }
      },
    });

    for (const memberId of registry.values) {
      mentionIds.add(memberId);
    }

    return [...mentionIds];
  }


  private inferExplicitMentionIds(organizationId: string, message: Message): string[] {
    // Older message rows only persist the flattened mention id set. On edit we
    // preserve ids that were not already implied by the old body, then merge
    // them with handles parsed from the new body to keep stored metadata in
    // sync without introducing new alert fan-out.
    const channel = message.channelId ? this.repo.getChannel(organizationId, message.channelId) : null;
    const parsedFromBody = new Set(
      this.resolveMentionIds(organizationId, message.content, channel, message.senderKind, []),
    );
    return message.mentions.filter((memberId) => !parsedFromBody.has(memberId));
  }

  private resolveAllMentionIds(organizationId: string, channel: Channel | null): string[] {
    if (channel?.memberIds.length) {
      return channel.memberIds;
    }
    return this.repo.listMembers(organizationId).map((member) => member.id);
  }

  private resolveMentionNames(
    organizationId: string,
    content: string,
    channel: Channel | null,
  ): string[] {
    const registry = buildMentionHandleRegistry(
      this.repo.listMembers(organizationId).flatMap((member) => [
        { handle: member.id, value: member.name },
        { handle: member.name, value: member.name },
      ]),
    );

    scanMentionsInContent(content, registry, {
      allowAll: true,
      skipAllInDm: channel?.kind === 'dm',
      onAll: () => {
        registry.values.add('all');
      },
    });

    return [...registry.values];
  }

  private decorateMessages(
    paginated: PaginatedMessages,
    organizationId: string,
    channel: Channel | null,
  ): PaginatedMessages {
    const visible = paginated.data
      .filter((message) => !this.shouldHideMessage(message, channel))
    return {
      ...paginated,
      data: visible.map((message) => this.decorateMessage(message, organizationId, channel)),
    };
  }

  private decorateMessage(
    message: Message,
    organizationId: string,
    channel: Channel | null,
  ): Message {
    const resolvedChannel = channel ?? (message.channelId ? this.repo.getChannel(organizationId, message.channelId) : null);
    const content =
      resolvedChannel?.kind === 'self'
        ? formatTimestampedContent(message.content, message.createdAt)
        : message.content;
    return MessageSchema.parse({
      ...message,
      content,
      mentionNames: message.mentionNames ?? this.resolveMentionNames(organizationId, message.content, resolvedChannel),
    });
  }

  private compactSelfNotesIfNeeded(
    organizationId: string,
    memberId: string,
    channelId: string,
  ): void {
    const messages = this.listAllChannelMessages(organizationId, channelId);
    const uncompacted = messages.filter((message) => !isCompactedSelfNote(message));
    if (uncompacted.length <= COMPACTION_TRIGGER) {
      return;
    }
    void this.compactThreadMessages({
      organizationId,
      threadId: channelId,
      senderId: memberId,
      messages,
      summaryMarker: SELF_NOTE_SUMMARY_MARKER,
      compactedMarker: SELF_NOTE_COMPACTED_MARKER,
      keepRawCount: SELF_NOTE_RECENT_RAW_COUNT,
      batchSize: SELF_NOTE_COMPACTION_BATCH_SIZE,
      buildSummary: buildSelfNoteSummary,
      publishSummary: true,
    });
  }

  private compactConversationIfNeeded(organizationId: string, threadId: string, senderId: string): void {
    const thread = this.repo.getThread(organizationId, threadId);
    const channel = thread?.channelId ? this.repo.getChannel(organizationId, thread.channelId) : null;
    if (channel?.kind === 'self') return;

    const messages = this.listAllThreadMessages(organizationId, threadId);
    const uncompacted = messages.filter(
      (message) =>
        !isMessageWithAnyMarker(message, [
          CONVERSATION_SUMMARY_MARKER,
          CONVERSATION_COMPACTED_MARKER,
          CONVERSATION_ARCHIVE_MARKER,
        ]),
    );
    if (uncompacted.length <= COMPACTION_TRIGGER) {
      return;
    }

    void this.compactThreadMessages({
      organizationId,
      threadId,
      senderId,
      messages,
      summaryMarker: CONVERSATION_SUMMARY_MARKER,
      compactedMarker: CONVERSATION_COMPACTED_MARKER,
      keepRawCount: CONVERSATION_RECENT_RAW_COUNT,
      batchSize: CONVERSATION_COMPACTION_BATCH_SIZE,
      buildSummary: buildConversationSummary,
      publishSummary: true,
    });
  }

  private listAllChannelMessages(organizationId: string, channelId: string): Message[] {
    const all: Message[] = [];
    let cursor: string | undefined;
    do {
      const page = this.repo.listChannelMessages(organizationId, channelId, {
        cursor,
        limit: 200,
      });
      all.push(...page.data);
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    } while (cursor);
    return all.sort((left, right) => {
      const byTime = left.createdAt.localeCompare(right.createdAt);
      return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
    });
  }

  private listAllThreadMessages(organizationId: string, threadId: string): Message[] {
    const all: Message[] = [];
    let cursor: string | undefined;
    do {
      const page = this.repo.listMessages(organizationId, threadId, cursor, 200);
      all.push(...page.data);
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    } while (cursor);
    return all.sort((left, right) => {
      const byTime = left.createdAt.localeCompare(right.createdAt);
      return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
    });
  }

  private compactThreadMessages(input: {
    organizationId: string;
    threadId: string;
    senderId: string;
    messages: Message[];
    summaryMarker: string;
    compactedMarker: string;
    keepRawCount: number;
    batchSize: number;
    buildSummary: (messages: Message[]) => string;
    publishSummary: boolean;
  }): { summaryMessage: Message | null; compactedMessageIds: string[] } {
    const activeSummaries = input.messages.filter((message) =>
      isMessageWithAnyMarker(message, [input.summaryMarker]),
    );
    const uncompacted = input.messages.filter(
      (message) =>
        !isMessageWithAnyMarker(message, [
          input.summaryMarker,
          input.compactedMarker,
          CONVERSATION_COMPACTED_MARKER,
          CONVERSATION_ARCHIVE_MARKER,
        ]),
    );
    const keepRawStart = Math.max(uncompacted.length - input.keepRawCount, 0);
    const compactable = uncompacted.slice(0, keepRawStart).slice(0, input.batchSize);
    const summarySources = [...activeSummaries, ...compactable];
    if (summarySources.length === 0) {
      return { summaryMessage: null, compactedMessageIds: [] };
    }
    const sourcesToCompact = [...summarySources];

    const now = new Date().toISOString();
    const summaryMessage = MessageSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      threadId: input.threadId,
      channelId: this.repo.getThread(input.organizationId, input.threadId)?.channelId ?? undefined,
      senderId: 'system',
      senderKind: AGENT_KIND,
      kind: 'system',
      content: input.buildSummary(summarySources),
      createdAt: now,
    });
    if (input.publishSummary) {
      this.publishMessage(summaryMessage, [], undefined, {
        suppressDmAlerts: true,
        skipMentionResolution: true,
      });
    } else {
      this.repo.saveMessage(summaryMessage);
    }

    for (const source of sourcesToCompact) {
      this.repo.updateMessage({
        ...source,
        content: `${input.compactedMarker} compactedInto=${summaryMessage.id}`,
        editedAt: now,
      });
    }

    return {
      summaryMessage,
      compactedMessageIds: sourcesToCompact.map((message) => message.id),
    };
  }

  private requireAttachments(organizationId: string, attachmentIds: string[]): void {
    let totalSize = 0;
    for (const attachmentId of attachmentIds) {
      const attachment = this.repo.getAttachment(organizationId, attachmentId);
      if (!attachment) {
        throw new Error(`Attachment not found: ${attachmentId}`);
      }
      if (attachment.sizeBytes > ATTACHMENT_FILE_LIMIT_BYTES) {
        throw new Error(`Attachment exceeds the ${Math.round(ATTACHMENT_FILE_LIMIT_BYTES / (1024 * 1024))} MB limit: ${attachment.filename}`);
      }
      totalSize += attachment.sizeBytes;
    }

    if (totalSize > ATTACHMENT_MESSAGE_LIMIT_BYTES) {
      throw new Error('Attachments exceed the 100 MB per-message limit');
    }
  }

  private requireMessage(organizationId: string, messageId: string): Message {
    const message = this.repo.getMessage(organizationId, messageId);
    if (!message) {
      throw new Error(`Message not found: ${messageId}`);
    }
    return message;
  }

  private requireReadableChannel(
    organizationId: string,
    channelId: string,
    memberId: string,
  ): Channel {
    const channel = this.requireActiveChannel(organizationId, channelId);
    if (!this.canMemberAccessChannel(channel, memberId)) {
      throw new Error(`Channel not found: ${channelId}`);
    }
    return channel;
  }

  private requireWritableChannel(
    organizationId: string,
    channelId: string,
    memberId: string,
  ): Channel {
    return this.requireReadableChannel(organizationId, channelId, memberId);
  }

  private requireActiveChannel(organizationId: string, channelId: string) {
    const channel = this.repo.getChannel(organizationId, channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }
    // Config reconcile archives dropped channels instead of deleting them so
    // history remains readable, but new user traffic must still be rejected.
    if (channel.archivedAt) {
      throw new Error(`Channel is archived: ${channelId}`);
    }
    return channel;
  }

  private canMemberAccessChannel(channel: Channel, memberId: string): boolean {
    const member = channel.organizationId
      ? this.repo.getMember(channel.organizationId, memberId)
      : null;
    if (!member || member.retiredAt) {
      return false;
    }
    // Self channels and DMs are the only private channel kinds in the current
    // substrate. Everything else stays org-visible by default.
    if (channel.kind === 'self' || channel.kind === 'dm') {
      return channel.memberIds.includes(memberId);
    }
    return true;
  }

  private shouldHideMessage(message: Message, channel: Channel | null): boolean {
    if (isCompactedSelfNote(message)) return true;
    if (isSelfSummaryNote(message)) return true;
    if (isCompactedConversation(message)) return true;
    if (isArchivedConversation(message) && message.content.includes('compactedInto=')) return true;
    if (channel?.kind === 'self' && message.content.startsWith(SELF_NOTE_COMPACTED_MARKER)) return true;
    return false;
  }

  private canObserverReadThread(
    organizationId: string,
    threadId: string,
    memberId: string,
  ): boolean {
    const member = this.repo.getMember(organizationId, memberId);
    if (!member || member.kind !== 'human') return false;

    const thread = this.repo.getThread(organizationId, threadId);
    if (!thread) return false;
    const channel = thread.channelId ? this.repo.getChannel(organizationId, thread.channelId) : null;
    const channels = channel
      ? [channel]
      : [{ id: thread.id, memberIds: thread.memberIds }];
    return isAgentOnlyThread(
      thread.id,
      this.repo.listMembers(organizationId).map((member) => ({ id: member.id, kind: member.kind })),
      channels,
    );
  }
}

function mergePaginatedMessages(
  live: PaginatedMessages,
  archived: PaginatedMessages,
  limit: number,
): PaginatedMessages {
  // Sort by (createdAt, id) so same-millisecond rows have a deterministic
  // order — same invariant the SQL paginators use. Otherwise the page
  // boundary can split a same-millisecond cluster and `nextCursor` would
  // skip the row that lands after the slice.
  const combined = [...live.data, ...archived.data].sort((left, right) => {
    const byTime = left.createdAt.localeCompare(right.createdAt);
    return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
  });
  const unique: Message[] = [];
  const seen = new Set<string>();
  for (const message of combined) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    unique.push(message);
  }
  const hasMore = unique.length > limit || live.hasMore || archived.hasMore;
  const data = hasMore ? unique.slice(-limit) : unique;
  // Composite cursor `${createdAt}|${id}` matches the SQL paginators so
  // the next page can resume past a same-millisecond boundary without
  // dropping rows.
  const head = hasMore && data[0] ? data[0] : undefined;
  const nextCursor = head ? encodeCursor(head.createdAt, head.id) : undefined;
  return { data, hasMore, nextCursor };
}

function mergeRankedPaginatedMessages(
  live: PaginatedMessages,
  archived: PaginatedMessages,
  limit: number,
): PaginatedMessages {
  const rankFor = (message: Message) =>
    live.searchRanks?.[message.id] ??
    archived.searchRanks?.[message.id] ??
    Number.POSITIVE_INFINITY;
  const combined = [...live.data, ...archived.data].sort((left, right) => {
    const byRank = rankFor(left) - rankFor(right);
    if (byRank !== 0) return byRank;
    const byTime = right.createdAt.localeCompare(left.createdAt);
    return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
  });
  const unique: Message[] = [];
  const seen = new Set<string>();
  for (const message of combined) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    unique.push(message);
  }
  const data = unique.slice(0, limit);
  const searchRanks: Record<string, number> = {};
  for (const message of data) {
    const rank = rankFor(message);
    if (Number.isFinite(rank)) {
      searchRanks[message.id] = rank;
    }
  }
  return {
    data,
    hasMore: unique.length > limit || live.hasMore || archived.hasMore,
    ...(Object.keys(searchRanks).length > 0 ? { searchRanks } : {}),
  };
}

function uniqueMentionIds(mentions: MessageMention[]): string[] {
  return [...new Set(mentions.map((mention) => mention.memberId))];
}

function isMessageWithAnyMarker(message: Message, markers: string[]): boolean {
  return markers.some((marker) => message.content.startsWith(marker));
}
