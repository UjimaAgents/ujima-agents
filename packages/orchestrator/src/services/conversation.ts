import { randomUUID } from 'node:crypto';
import {
  AGENT_KIND,
  ChannelSchema,
  MessageMentionSchema,
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
  type ReasoningEffort,
  buildMentionHandleRegistry,
  getDirectMessageThreadId,
  scanMentionsInContent,
  type WakeReason,
  type WakeSuppressedReason,
  isAgentOnlyThread,
} from '@ujima/shared';
import type { RealtimeService } from './context.js';
import { selfChannelId } from './member-channels.js';
import { buildMessage, buildSystemMessage } from './message-factory.js';
import { formatTimestampedContent } from './conversation-summary.js';
import type {
  ConversationRepository,
  PaginatedMessages,
} from './repository-reader.js';
import { requireOrganization } from '../utils/require-organization.js';
import { isVacuousAck, shouldSuppressForMirror } from './mirror-guard.js';
import { isAcknowledgementOnly } from './run-reply-guard.js';
import {
  compactSelfNotesIfNeeded,
  compactConversationIfNeeded,
  archiveConversation,
  shouldHideCompactedMessage,
  type CompactionContext,
} from './conversation-compact.js';
import {
  MentionQuota,
  ChannelReadQuota,
  PairMentionTracker,
} from './conversation-quota.js';

const ATTACHMENT_FILE_LIMIT_BYTES = 25 * 1024 * 1024;
const ATTACHMENT_MESSAGE_LIMIT_BYTES = 100 * 1024 * 1024;

interface ConversationMessageMetadata {
  runId?: string;
  goalMode?: boolean;
  reasoningEffort?: ReasoningEffort;
  delegate?: { parentRunId?: string };
}

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

export interface ConversationServiceOptions {
  archiveStore?: ArchivedChannelMessageStore;
  onMemberAlerted?: (input: MemberAlertInput) => Promise<void> | void;
  mentionFanoutCap?: number;
  mentionWindowMs?: number;
}

export class ConversationService {
  private readonly archiveStore?: ArchivedChannelMessageStore;
  private readonly onMemberAlerted?: (input: MemberAlertInput) => Promise<void> | void;
  private readonly mentionFanoutCap: number;
  private readonly mentionWindowMs: number;
  private readonly mentionQuota: MentionQuota;
  private readonly channelReadQuota: ChannelReadQuota;
  private readonly pairMentionTracker: PairMentionTracker;
  private readonly lastMessageCreatedAtByThread = new Map<string, number>();

  constructor(
    private readonly repo: ConversationRepository,
    private readonly realtime: RealtimeService,
    options: ConversationServiceOptions = {},
  ) {
    this.archiveStore = options.archiveStore;
    this.onMemberAlerted = options.onMemberAlerted;
    this.mentionFanoutCap = options.mentionFanoutCap ?? 10;
    this.mentionWindowMs = options.mentionWindowMs ?? 60_000;
    this.mentionQuota = new MentionQuota(this.mentionFanoutCap, this.mentionWindowMs);
    this.channelReadQuota = new ChannelReadQuota(100, 60_000);
    this.pairMentionTracker = new PairMentionTracker(3, 90_000);
  }

  private nextMessageCreatedAt(organizationId: string, threadId: string, requestedAt: string): string {
    const key = `${organizationId}:${threadId}`;
    const requestedMs = Date.parse(requestedAt);
    const previousMs = this.lastMessageCreatedAtByThread.get(key) ?? 0;
    const nextMs = Number.isFinite(requestedMs)
      ? Math.max(requestedMs, previousMs + 1)
      : previousMs + 1;
    this.lastMessageCreatedAtByThread.set(key, nextMs);
    return new Date(nextMs).toISOString();
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
    const existing = this.repo.getMessage(message.organizationId, message.id);
    const finalMessage = buildMessage({
      ...message,
      createdAt:
        existing?.createdAt ??
        this.nextMessageCreatedAt(message.organizationId, message.threadId, message.createdAt),
      mentions: uniqueMentionIds(resolvedMentions),
      mentionNames: this.resolveMentionNames(message.organizationId, message.content, channel),
    });
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
        ? buildMessage({
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

      this.fanout('alertMentionedMembers', this.alertMentionedMembers(emittedMessage, resolvedMentions, channel));
      if (!options?.suppressDmAlerts && !this.shouldSuppressDmWake(emittedMessage, channel)) {
        this.fanout('alertDirectMessageParticipants', this.alertDirectMessageParticipants(emittedMessage, channel));
      }
      // Phase 2 — broad-read fanout for public channels. Every agent
      // in the channel (or every org agent for empty-roster channels)
      // wakes on human-authored, non-system messages. Mentioned
      // agents are already alerted above with reason='mention';
      // we skip them here to avoid double-fire.
      this.fanout('alertChannelReaders', this.alertChannelReaders(emittedMessage, channel, resolvedMentions));
    }
    return emittedMessage;
  }

  private compactionContext(): CompactionContext {
    return {
      repo: this.repo,
      publishMessage: (message, mentions, attachmentIds, options) =>
        this.publishMessage(message, mentions as never[], attachmentIds, options),
    };
  }

  // Fire-and-forget alert fanout: the message is already published and
  // the HTTP response is on its way, so a downstream throw (schema drift,
  // realtime emit failure) must not become an unhandledRejection.
  private fanout(label: string, promise: Promise<unknown>): void {
    promise.catch((error) => {
      console.error(
        `conversation: ${label} failed`,
        error instanceof Error ? error.stack ?? error.message : String(error),
      );
    });
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
      if (!this.channelReadQuota.consume(`${message.organizationId}:${member.id}:${channel.id}`)) {
        this.emitWakeSuppressed(message, channel, member.id, 'quota');
        continue;
      }
      // Channel member mode check (active / passive / muted / temp_disable)
      const memberMode = this.repo.getChannelMemberMode(
        message.organizationId,
        channel.id,
        member.id,
      );
      if (memberMode === 'muted' || memberMode === 'temp_disable') {
        this.emitWakeSuppressed(message, channel, member.id, 'mode-blocked');
        continue;
      }
      if (memberMode === 'passive') {
        // Passive agents read context but don't auto-reply on broadcasts.
        this.emitWakeSuppressed(message, channel, member.id, 'mode-passive');
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
    metadata?: ConversationMessageMetadata;
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
      // assignment threading and reply re-alerts keep working —
      // both rely on the parent sender being mentioned). Drop
      // transitive parent.mentions entirely. Three-party hand-offs
      // (A→B→C→A) must include explicit @-mentions in the new
      // message body; the rewritten prompt documents this
      // requirement.
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

    const message = buildMessage({
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
    });

    const published = this.publishMessage(message, undefined, input.attachmentIds);
    compactConversationIfNeeded(this.compactionContext(), input.organizationId, input.threadId, input.senderId);
    return published;
  }

  postToChannel(input: {
    organizationId: string;
    senderId: string;
    channelId: string;
    body: string;
    replyTo?: string;
    mentions?: string[];
    metadata?: ConversationMessageMetadata;
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
    metadata?: ConversationMessageMetadata;
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
    metadata?: ConversationMessageMetadata;
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

    const memberIds = [...new Set([sender.id, recipient.id])].sort();
    const dmChannelName =
      sender.id === recipient.id ? `${sender.name} (self delegation)` : [sender.name, recipient.name].sort().join(' / ');
    const now = new Date().toISOString();

    const channel = this.repo.saveChannel(ChannelSchema.parse({
      id: channelId,
      organizationId: input.organizationId,
      name: dmChannelName,
      kind: 'dm',
      topic: '',
      memberIds,
    }));
    this.repo.setChannelMembers(input.organizationId, channelId, memberIds);

    this.repo.ensureThread({
      id: channel.id,
      organizationId: input.organizationId,
      channelId: channel.id,
      title: dmChannelName,
      memberIds,
      createdAt: now,
    });

    const message = buildMessage({
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
    compactConversationIfNeeded(this.compactionContext(), input.organizationId, threadId, input.senderId);
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
    const memberIds = [...new Set([memberA.id, memberB.id])].sort();
    const dmChannelName =
      memberA.id === memberB.id ? `${memberA.name} (self delegation)` : [memberA.name, memberB.name].sort().join(' / ');
    const now = new Date().toISOString();

    const channel = this.repo.saveChannel(
      ChannelSchema.parse({
        id: channelId,
        organizationId: input.organizationId,
        name: dmChannelName,
        kind: 'dm',
        topic: '',
        memberIds,
      }),
    );
    this.repo.setChannelMembers(input.organizationId, channelId, memberIds);

    this.repo.ensureThread({
      id: channel.id,
      organizationId: input.organizationId,
      channelId: channel.id,
      title: dmChannelName,
      memberIds,
      createdAt: now,
    });

    const message = buildSystemMessage({
      organizationId: input.organizationId,
      threadId: channel.id,
      channelId: channel.id,
      content: input.content,
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
      this.repo.setChannelMembers(input.organizationId, channelId, [member.id]);
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

    const message = buildMessage({
      organizationId: input.organizationId,
      threadId: channelId,
      channelId,
      senderId: member.id,
      senderKind: member.kind,
      kind: member.kind,
      content: input.body,
      ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
    });

    const published = this.publishMessage(message, [], input.attachmentIds);
    compactSelfNotesIfNeeded(this.compactionContext(), input.organizationId, member.id, channelId);
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

    return archiveConversation(this.compactionContext(), input.organizationId, input.threadId, input.memberId, input.mode);
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

      // Muted/temp_disable agents don't wake even on @mention
      if (channel) {
        const memberMode = this.repo.getChannelMemberMode(
          message.organizationId,
          channel.id,
          member.id,
        );
        if (memberMode === 'muted' || memberMode === 'temp_disable') {
          continue;
        }
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
      if (!this.mentionQuota.consume(`${message.organizationId}:${member.id}`)) {
        this.publishMentionThrottledSystemMessage(message.organizationId, member.id, message.senderId);
        continue;
      }

      // Bet 3 — per-pair back-pressure. If `from→to` has already
      // fired the per-pair cap within the window, demote to
      // channel-read so the recipient can `channel.pass` instead
      // of being forced into another mandatory reply. Emit an
      // observability event so the UI can show "X and Y are
      // looping — wakes demoted".
      const countInWindow = this.pairMentionTracker.record(
        `${message.organizationId}|${message.threadId}|${message.senderId}|${member.id}`,
      );
      const wakeReason: WakeReason =
        countInWindow > 3 ? 'channel-read' : 'mention';
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
    const sender = this.repo.getMember(message.organizationId, message.senderId);
    await Promise.all(
      recipients.map(async (recipientId) => {
        // Muted/temp_disable agents don't receive DMs either
        const memberMode = this.repo.getChannelMemberMode(
          message.organizationId,
          channel.id,
          recipientId,
        );
        if (memberMode === 'muted' || memberMode === 'temp_disable') return;
        const recipient = this.repo.getMember(message.organizationId, recipientId);
        const pairCap =
          sender?.kind === 'agent' && recipient?.kind === 'agent' ? 1 : 3;
        try {
          const countInWindow = this.pairMentionTracker.record(
            `${message.organizationId}|${message.threadId}|${message.senderId}|${recipientId}`,
          );
          const wakeReason: WakeReason =
            countInWindow > pairCap ? 'channel-read' : 'dm';

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

    const systemMessage = buildSystemMessage({
      organizationId,
      threadId: channel.id,
      channelId: channel.id,
      content: `member.alert_throttled: mention delivery for "${memberId}" by "${byMemberId}" exceeded ${this.mentionFanoutCap} alerts in ${Math.floor(this.mentionWindowMs / 1000)}s`,
    });
    this.publishMessage(systemMessage, []);
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
      .filter((message) => !shouldHideCompactedMessage(message, channel))
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
    return buildMessage({
      ...message,
      content,
      mentionNames:
        message.mentionNames ?? this.resolveMentionNames(organizationId, message.content, resolvedChannel),
    });
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
