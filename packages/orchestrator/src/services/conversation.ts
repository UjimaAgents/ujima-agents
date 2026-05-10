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
  type Message,
  type MessageMention,
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
  private readonly mentionWindows = new Map<string, number[]>();

  constructor(
    private readonly repo: ConversationRepository,
    private readonly realtime: RealtimeService,
    options: ConversationServiceOptions = {},
  ) {
    this.archiveStore = options.archiveStore;
    this.onMemberAlerted = options.onMemberAlerted;
    this.mentionFanoutCap = options.mentionFanoutCap ?? 10;
    this.mentionWindowMs = options.mentionWindowMs ?? 60_000;
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
      this.requireThreadAccess(organizationId, threadId, memberId);
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

  requireThreadAccess(organizationId: string, threadId: string, memberId: string): void {
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
          })
        : { data: [], hasMore: false, nextCursor: undefined };
      return this.decorateMessages(
        mergePaginatedMessages(live, archived, input.limit ?? 50),
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
    const messageAttachments = (finalMessage as { attachments?: { id: string }[] }).attachments ?? [];
    const linkedAttachmentIds = attachmentIds ?? messageAttachments.map((attachment) => attachment.id);
    if (linkedAttachmentIds.length > 0) {
      this.requireAttachments(finalMessage.organizationId, linkedAttachmentIds);
    }
    this.repo.saveMessage(finalMessage);
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
    }
    return emittedMessage;
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
  }) {
    requireOrganization(this.repo, input.organizationId);

    const sender = this.repo.getMember(input.organizationId, input.senderId);
    if (!sender) {
      throw new Error(`Sender not found: ${input.senderId}`);
    }

    const channel = input.channelId
      ? this.requireWritableChannel(input.organizationId, input.channelId, sender.id)
      : null;

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

      const parentSender = this.repo.getMember(input.organizationId, parent.senderId);
      if (parentSender?.kind === AGENT_KIND) {
        mentions.add(parent.senderId);
      }

      for (const mention of this.repo.listMessageMentions(parent.id)) {
        mentions.add(mention.memberId);
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
  }) {
    const channel = this.requireActiveChannel(input.organizationId, input.channelId);
    let threadId = channel.id;
    if (input.replyTo) {
      const parent = this.requireMessage(input.organizationId, input.replyTo);
      // Reject cross-channel replies: a reply must live in the same channel
      // as its parent message. Otherwise the resulting message would render
      // in `input.channelId` while threading under a different channel's
      // conversation — corrupting channel history and leaking replies across
      // channel boundaries.
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
    });
  }

  replyToMessage(input: {
    organizationId: string;
    senderId: string;
    messageId: string;
    body: string;
    mentions?: string[];
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
      });
    }

    const recipient = this.repo.getMember(input.organizationId, input.recipientId);
    if (!recipient) {
      throw new Error(`Recipient not found: ${input.recipientId}`);
    }

    const [firstId, secondId] = [sender.id, recipient.id].sort();
    const channelId = `dm:${firstId}:${secondId}`;
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

    let threadId = channelId;
    let replyChannelId = channelId;

    if (input.parentMessageId) {
      const parent = this.requireMessage(input.organizationId, input.parentMessageId);
      threadId = parent.threadId;
      replyChannelId = parent.channelId ?? channelId;
    }

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

  sendSelfNote(input: {
    organizationId: string;
    memberId: string;
    body: string;
    attachmentIds?: string[];
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

    const message = MessageSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      threadId: channelId,
      channelId,
      senderId: member.id,
      senderKind: member.kind,
      kind: member.kind,
      content: input.body,
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

      fanout.push(this.alertMember(message, member.id, channel, mention.kind));
    }
    await Promise.all(fanout);
  }

  private async alertMember(
    message: Message,
    memberId: string,
    channel: Channel | null,
    reason: string,
  ): Promise<void> {
    const member = this.repo.getMember(message.organizationId, memberId);
    if (!member || member.kind !== 'agent' || member.retiredAt) {
      return;
    }

    this.realtime.emit(
      SocketEventNames.memberAlerted,
      {
        organizationId: message.organizationId,
        memberId: member.id,
        channelId: channel?.id,
        threadId: message.threadId,
        messageId: message.id,
        byMemberId: message.senderId,
        reason,
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
      reason,
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
          await this.alertMember(message, recipientId, channel, 'dm');
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
    return /^Acknowledged[.!?]?\s*$/i.test(message.content.trim());
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
    const byHandle = this.listMentionHandleMap(organizationId);
    const sortedHandles = [...byHandle.keys()].sort((a, b) => b.length - a.length);

    // We merge explicit mention ids from tool inputs with parsed @handles from
    // the message body so typed intent stays consistent no matter how the
    // message was authored.
    const mentionIds = new Set<string>(explicitMentionIds);

    // Regex to find potential mention starts: @ preceded by start of string or a non-word char (except @)
    const mentionStartRegex = /(?:^|[^@\w])@/g;

    for (const match of content.matchAll(mentionStartRegex)) {
      const startIndex = (match.index ?? 0) + match[0].length;
      const remaining = content.slice(startIndex).toLowerCase();


      // Check for "@all" first as it's a special system handle
      if (senderKind !== AGENT_KIND && remaining.startsWith('all')) {
        const nextChar = remaining[3];
        if (!nextChar || !/\w/.test(nextChar)) {
          for (const memberId of this.resolveAllMentionIds(organizationId, channel)) {
            mentionIds.add(memberId);
          }
          continue;
        }
      }

      for (const handle of sortedHandles) {
        if (remaining.startsWith(handle)) {
          // Check if the match is followed by a non-word char or end of string
          const nextChar = remaining[handle.length];
          if (!nextChar || !/\w/.test(nextChar)) {
            const memberId = byHandle.get(handle);
            if (memberId) {
              mentionIds.add(memberId);
              // Break after first (longest) match for this @ instance
              break;
            }
          }
        }
      }
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

  private listMentionHandleMap(organizationId: string): Map<string, string> {
    const members = this.repo.listMembers(organizationId);
    const byHandle = new Map<string, string>();
    for (const member of members) {
      byHandle.set(normalizeMentionHandle(member.id), member.id);
      byHandle.set(normalizeMentionHandle(member.name), member.id);
    }
    return byHandle;
  }

  private listMentionDisplayMap(organizationId: string): Map<string, string> {
    const members = this.repo.listMembers(organizationId);
    const byHandle = new Map<string, string>();
    for (const member of members) {
      byHandle.set(normalizeMentionHandle(member.id), member.name);
      byHandle.set(normalizeMentionHandle(member.name), member.name);
    }
    return byHandle;
  }

  private resolveMentionNames(
    organizationId: string,
    content: string,
    channel: Channel | null,
  ): string[] {
    const byHandle = this.listMentionDisplayMap(organizationId);
    const sortedHandles = [...byHandle.keys()].sort((a, b) => b.length - a.length);
    const mentionNames = new Set<string>();
    const mentionStartRegex = /(?:^|[^@\w])@/g;

    for (const match of content.matchAll(mentionStartRegex)) {
      const startIndex = (match.index ?? 0) + match[0].length;
      const remaining = content.slice(startIndex).toLowerCase();

      if (remaining.startsWith('all')) {
        const nextChar = remaining[3];
        if (!nextChar || !/\w/.test(nextChar)) {
          mentionNames.add('all');
          continue;
        }
      }

      for (const handle of sortedHandles) {
        if (!remaining.startsWith(handle)) continue;
        const nextChar = remaining[handle.length];
        if (!nextChar || !/\w/.test(nextChar)) {
          const displayName = byHandle.get(handle);
          if (displayName) {
            mentionNames.add(displayName);
            break;
          }
        }
      }
    }

    if (mentionNames.has('all') && channel?.kind === 'dm') {
      mentionNames.delete('all');
    }

    return [...mentionNames];
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

function normalizeMentionHandle(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueMentionIds(mentions: MessageMention[]): string[] {
  return [...new Set(mentions.map((mention) => mention.memberId))];
}

function isMessageWithAnyMarker(message: Message, markers: string[]): boolean {
  return markers.some((marker) => message.content.startsWith(marker));
}
