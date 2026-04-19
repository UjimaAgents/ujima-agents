import { randomUUID } from "node:crypto";
import { MessageSchema, SocketEventNames, type Message } from "@ujima/shared";
import type { Repository } from "../repositories.ts";
import { channelRoom, orgRoom, threadRoom, type RealtimeService } from "../realtime.ts";

export class ConversationService {
  constructor(
    private readonly repo: Repository,
    private readonly realtime: RealtimeService,
  ) {}

  listChannels(organizationId: string) {
    this.requireOrganization(organizationId);
    return this.repo.listChannels(organizationId);
  }

  listMessages(organizationId: string, threadId: string) {
    this.requireOrganization(organizationId);

    if (!this.repo.getThread(organizationId, threadId)) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    return this.repo.listMessages(organizationId, threadId);
  }

  publishMessage(message: Message) {
    this.repo.saveMessage(message);
    this.realtime.emit(
      message.channelId ? SocketEventNames.channelMessage : SocketEventNames.threadMessage,
      message.channelId
        ? { organizationId: message.organizationId, channelId: message.channelId, message }
        : { organizationId: message.organizationId, threadId: message.threadId, message },
      [
        orgRoom(message.organizationId),
        ...(message.channelId ? [channelRoom(message.channelId)] : []),
        threadRoom(message.threadId),
      ],
    );

    return message;
  }

  sendMessage(input: {
    organizationId: string;
    threadId: string;
    channelId?: string;
    senderId: string;
    content: string;
  }) {
    this.requireOrganization(input.organizationId);

    const sender = this.repo.getMember(input.organizationId, input.senderId);
    if (!sender) {
      throw new Error(`Sender not found: ${input.senderId}`);
    }

    const channel = input.channelId ? this.repo.getChannel(input.organizationId, input.channelId) : null;
    if (input.channelId && !channel) {
      throw new Error(`Channel not found: ${input.channelId}`);
    }

    const thread = this.repo.ensureThread({
      id: input.threadId,
      organizationId: input.organizationId,
      channelId: input.channelId,
      title: channel?.name ?? "",
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
      createdAt: new Date().toISOString(),
    });

    return this.publishMessage(message);
  }

  private requireOrganization(organizationId: string) {
    if (!this.repo.getOrganization(organizationId)) {
      throw new Error(`Organization not found: ${organizationId}`);
    }
  }
}
