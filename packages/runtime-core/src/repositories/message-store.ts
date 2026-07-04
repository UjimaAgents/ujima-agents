import type {
  Attachment,
  ConversationThread,
  Message,
  MessageMention,
} from '@ujima/shared';

export interface PaginatedMessages {
  data: Message[];
  hasMore: boolean;
  nextCursor?: string;
  searchRanks?: Record<string, number>;
}

/**
 * Narrow port for message + thread + attachment operations.
 */
export interface MessageStore {
  saveMessage(message: Message): Message;
  updateMessage(message: Message): Message;
  getMessage(organizationId: string, messageId: string): Message | null;
  findMessageByClientId(
    organizationId: string,
    senderId: string,
    threadId: string,
    clientMessageId: string,
  ): Message | null;
  getLatestHumanMessageInThread(
    organizationId: string,
    threadId: string,
  ): Message | null;
  listMessages(
    organizationId: string,
    threadId: string,
    cursor?: string,
    limit?: number,
  ): PaginatedMessages;
  listChannelMessages(
    organizationId: string,
    channelId: string,
    opts: { cursor?: string; limit?: number; since?: string },
  ): PaginatedMessages;
  searchChannelMessages(
    organizationId: string,
    channelId: string,
    query: string,
    options?: { cursor?: string; since?: string; limit?: number; ranked?: boolean },
  ): PaginatedMessages;
  countMessagesSince(
    organizationId: string,
    threadId: string,
    input?: { since?: string; excludeSenderId?: string },
  ): number;
  countUncompactedMessageChars(
    organizationId: string,
    threadId: string,
  ): number;
  replaceMessageMentions(
    messageId: string,
    mentions: MessageMention[],
  ): void;

  // Threads
  saveThread(thread: ConversationThread): ConversationThread;
  ensureThread(thread: ConversationThread): ConversationThread;
  getThread(
    organizationId: string,
    threadId: string,
  ): ConversationThread | null;
  setThreadMembers(
    organizationId: string,
    threadId: string,
    memberIds: string[],
  ): void;

  // Attachments
  saveAttachment(attachment: Attachment): Attachment;
  deleteAttachment(organizationId: string, attachmentId: string): number;
  getAttachment(
    organizationId: string,
    attachmentId: string,
  ): Attachment | null;
  listMessageAttachments(messageId: string): Attachment[];
  linkAttachmentsToMessage(
    messageId: string,
    attachmentIds: string[],
  ): void;
}
