import { randomUUID } from 'node:crypto';
import {
  MessageMentionSchema,
  MessageSchema,
  SocketEventNames,
  channelRoom,
  memberRoom,
  orgRoom,
  threadRoom,
  type Channel,
  type Message,
  type MessageMention,
} from '@ujima/shared';
import type { RealtimeService } from './context.js';
import { selfChannelId } from './member-channels.js';
import type { ConversationRepository, PaginatedMessages } from './repository-reader.js';

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
    this.requireOrganization(organizationId);
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
    this.requireOrganization(input.organizationId);
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

  listMessages(organizationId: string, threadId: string, cursor?: string, limit?: number) {
    this.requireOrganization(organizationId);

    if (!this.repo.getThread(organizationId, threadId)) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    return this.repo.listMessages(organizationId, threadId, cursor, limit);
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
    this.requireOrganization(input.organizationId);
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
      return mergePaginatedMessages(live, archived, input.limit ?? 50);
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
    return mergePaginatedMessages(live, archived, input.limit ?? 50);
  }

  publishMessage(message: Message, typedMentions?: MessageMention[]) {
    const channel = message.channelId
      ? this.requireActiveChannel(message.organizationId, message.channelId)
      : null;
    const resolvedMentions = typedMentions ?? this.resolveMessageMentions(message.organizationId, message);
    const finalMessage = MessageSchema.parse({
      ...message,
      mentions: uniqueMentionIds(resolvedMentions),
    });
    this.repo.saveMessage(finalMessage);
    this.repo.replaceMessageMentions(finalMessage.id, resolvedMentions);

    const rooms = this.getPublishRooms(finalMessage, channel);

    this.realtime.emit(
      channel?.kind === 'dm'
        ? SocketEventNames.dmMessage
        : finalMessage.channelId
          ? SocketEventNames.channelMessage
          : SocketEventNames.threadMessage,
      channel?.kind === 'dm'
        ? { organizationId: finalMessage.organizationId, message: finalMessage }
        : finalMessage.channelId
          ? { organizationId: finalMessage.organizationId, channelId: finalMessage.channelId, message: finalMessage }
          : { organizationId: finalMessage.organizationId, threadId: finalMessage.threadId, message: finalMessage },
      rooms,
    );

    void this.alertMentionedMembers(finalMessage, resolvedMentions, channel);
    return finalMessage;
  }

  sendMessage(input: {
    organizationId: string;
    threadId: string;
    channelId?: string;
    senderId: string;
    content: string;
    mentions?: string[];
    parentMessageId?: string;
  }) {
    this.requireOrganization(input.organizationId);

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
      mentions: input.mentions ?? [],
      createdAt: new Date().toISOString(),
    });

    return this.publishMessage(message);
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
  }) {
    this.requireOrganization(input.organizationId);

    const sender = this.repo.getMember(input.organizationId, input.senderId);
    if (!sender) {
      throw new Error(`Sender not found: ${input.senderId}`);
    }

    if (input.recipientId === 'self') {
      return this.sendSelfNote({
        organizationId: input.organizationId,
        memberId: input.senderId,
        body: input.content,
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

    this.repo.saveChannel({
      id: channelId,
      organizationId: input.organizationId,
      name: dmChannelName,
      kind: 'dm',
      topic: '',
      memberIds: [sender.id, recipient.id],
    });
    this.repo.setChannelMembers(channelId, [sender.id, recipient.id]);

    this.repo.ensureThread({
      id: channelId,
      organizationId: input.organizationId,
      channelId,
      title: dmChannelName,
      memberIds: [sender.id, recipient.id],
      createdAt: now,
    });

    const message = MessageSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      threadId: channelId,
      channelId,
      senderId: input.senderId,
      senderKind: sender.kind,
      kind: sender.kind,
      content: input.content,
      mentions: input.mentions ?? [],
      createdAt: now,
    });

    return this.publishMessage(message);
  }

  sendSelfNote(input: {
    organizationId: string;
    memberId: string;
    body: string;
  }) {
    this.requireOrganization(input.organizationId);
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

    return this.publishMessage(message, []);
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
    const updated = this.repo.updateMessage({
      ...existing,
      content: input.content,
      editedAt: new Date().toISOString(),
    });
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
    for (const mention of mentions) {
      if (seen.has(mention.memberId)) continue;
      seen.add(mention.memberId);

      if (mention.memberId === message.senderId) {
        continue;
      }

      const member = this.repo.getMember(message.organizationId, mention.memberId);
      if (!member || member.kind !== 'agent' || member.retiredAt) {
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

      this.realtime.emit(
        SocketEventNames.memberAlerted,
        {
          organizationId: message.organizationId,
          memberId: member.id,
          channelId: channel?.id,
          messageId: message.id,
          byMemberId: message.senderId,
          reason: mention.kind,
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
        reason: mention.kind,
      });
    }
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

  private resolveMessageMentions(organizationId: string, message: Message): MessageMention[] {
    const members = this.repo.listMembers(organizationId);
    const byHandle = new Map<string, string>();
    for (const member of members) {
      byHandle.set(normalizeMentionHandle(member.id), member.id);
      byHandle.set(normalizeMentionHandle(member.name), member.id);
    }

    // We merge explicit mention ids from tool inputs with parsed @handles from
    // the message body so typed intent stays consistent no matter how the
    // message was authored.
    const mentionIds = new Set<string>(message.mentions);
    const parsedHandles = extractMentionHandles(message.content);
    for (const handle of parsedHandles) {
      const memberId = byHandle.get(normalizeMentionHandle(handle));
      if (memberId) {
        mentionIds.add(memberId);
      }
    }

    return [...mentionIds].map((memberId) =>
      MessageMentionSchema.parse({
        id: randomUUID(),
        messageId: message.id,
        memberId,
        kind: 'mention',
        createdAt: message.createdAt,
      }),
    );
  }

  private requireOrganization(organizationId: string) {
    if (!this.repo.getOrganization(organizationId)) {
      throw new Error(`Organization not found: ${organizationId}`);
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
}

function mergePaginatedMessages(
  live: PaginatedMessages,
  archived: PaginatedMessages,
  limit: number,
): PaginatedMessages {
  const combined = [...live.data, ...archived.data].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  const unique: Message[] = [];
  const seen = new Set<string>();
  for (const message of combined) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    unique.push(message);
  }
  const hasMore = unique.length > limit || live.hasMore || archived.hasMore;
  const data = hasMore ? unique.slice(-limit) : unique;
  const nextCursor = hasMore && data[0] ? data[0].createdAt : undefined;
  return { data, hasMore, nextCursor };
}

function extractMentionHandles(content: string): string[] {
  const handles: string[] = [];
  const regex = /(^|[^@\w])@([A-Za-z0-9][A-Za-z0-9._-]*)/g;
  for (const match of content.matchAll(regex)) {
    const handle = match[2];
    if (handle) {
      handles.push(handle);
    }
  }
  return handles;
}

function normalizeMentionHandle(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueMentionIds(mentions: MessageMention[]): string[] {
  return [...new Set(mentions.map((mention) => mention.memberId))];
}
