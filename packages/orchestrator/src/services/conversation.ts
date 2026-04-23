import { randomUUID } from 'node:crypto';
import {
  MessageSchema,
  SocketEventNames,
  channelRoom,
  memberRoom,
  orgRoom,
  threadRoom,
  type Message,
} from '@ujima/shared';
import type { RealtimeService } from './context.js';
import type { ConversationRepository } from './repository-reader.js';

export class ConversationService {
  constructor(
    private readonly repo: ConversationRepository,
    private readonly realtime: RealtimeService,
  ) {}

  listChannels(organizationId: string, cursor?: string, limit?: number) {
    this.requireOrganization(organizationId);
    return this.repo.listChannels(organizationId, cursor, limit);
  }

  listMessages(organizationId: string, threadId: string, cursor?: string, limit?: number) {
    this.requireOrganization(organizationId);

    if (!this.repo.getThread(organizationId, threadId)) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    return this.repo.listMessages(organizationId, threadId, cursor, limit);
  }

  publishMessage(message: Message) {
    const channel = message.channelId
      ? this.requireActiveChannel(message.organizationId, message.channelId)
      : null;
    this.repo.saveMessage(message);
    const rooms =
      channel?.kind === 'dm'
        ? [channelRoom(channel.id), threadRoom(message.threadId), ...channel.memberIds.map(memberRoom)]
        : [
            orgRoom(message.organizationId),
            ...(message.channelId ? [channelRoom(message.channelId)] : []),
            threadRoom(message.threadId),
          ];

    this.realtime.emit(
      channel?.kind === 'dm'
        ? SocketEventNames.dmMessage
        : message.channelId
          ? SocketEventNames.channelMessage
          : SocketEventNames.threadMessage,
      channel?.kind === 'dm'
        ? { organizationId: message.organizationId, message }
        : message.channelId
          ? { organizationId: message.organizationId, channelId: message.channelId, message }
          : { organizationId: message.organizationId, threadId: message.threadId, message },
      rooms,
    );

    return message;
  }

  sendMessage(input: {
    organizationId: string;
    threadId: string;
    channelId?: string;
    senderId: string;
    content: string;
    mentions?: string[];
  }) {
    this.requireOrganization(input.organizationId);

    const sender = this.repo.getMember(input.organizationId, input.senderId);
    if (!sender) {
      throw new Error(`Sender not found: ${input.senderId}`);
    }

    const channel = input.channelId
      ? this.requireActiveChannel(input.organizationId, input.channelId)
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
      senderId: input.senderId,
      senderKind: sender.kind,
      kind: sender.kind,
      content: input.content,
      mentions: input.mentions ?? [],
      createdAt: new Date().toISOString(),
    });

    return this.publishMessage(message);
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

  private requireOrganization(organizationId: string) {
    if (!this.repo.getOrganization(organizationId)) {
      throw new Error(`Organization not found: ${organizationId}`);
    }
  }

  private requireActiveChannel(organizationId: string, channelId: string) {
    const channel = this.repo.getChannel(organizationId, channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }
    if (channel.archivedAt) {
      throw new Error(`Channel is archived: ${channelId}`);
    }
    return channel;
  }
}
