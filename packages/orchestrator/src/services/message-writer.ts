import {
  SocketEventNames,
  type Channel,
  type Message,
  type MessageMention,
} from '@ujima/shared';
import type { RealtimeService } from './context.js';
import type { ConversationRepository } from './repository-reader.js';
import { buildMessage } from './message-factory.js';

/**
 * Narrow contract for the message persistence + realtime emit concern.
 *
 * Handles:
 * - Channel validation (via callback)
 * - Message deduplication (get-or-create with monotonic timestamps)
 * - Mention storage and attachment linking
 * - Realtime emit to room subscribers
 *
 * Does NOT handle:
 * - Wake/alert fan-out (that's WakeDispatcher)
 * - Conversation compaction (that's ConversationCompactor)
 * - Callback hooks (onMessagePublished)
 */
export interface MessageWriterDeps {
  repo: ConversationRepository;
  realtime: RealtimeService;
  requireActiveChannel(organizationId: string, channelId: string): Channel;
  resolveMessageMentions(
    organizationId: string,
    message: Message,
    channel: Channel | null,
  ): MessageMention[];
  resolveMentionNames(
    organizationId: string,
    content: string,
    channel: Channel | null,
  ): string[];
  getPublishRooms(message: Message, channel: Channel | null): string[];
  requireAttachments(organizationId: string, attachmentIds: string[]): void;
  nextMessageCreatedAt(
    organizationId: string,
    threadId: string,
    requestedAt: string,
  ): string;
}

export class MessageWriter {
  constructor(private readonly deps: MessageWriterDeps) {}

  /**
   * Core write + emit path.
   *
   * Persists the message (with race-safe dedup), stores mentions, links
   * attachments, and emits the result to realtime rooms.
   *
   * Returns the emitted message — callers use this to drive wake,
   * compaction, or callback logic from the facade.
   */
  publishMessage(
    message: Message,
    typedMentions?: MessageMention[],
    attachmentIds?: string[],
    options?: { skipMentionResolution?: boolean; silent?: boolean },
  ): Message {
    const { repo, realtime } = this.deps;

    const channel = message.channelId
      ? this.deps.requireActiveChannel(message.organizationId, message.channelId)
      : null;

    const resolvedMentions = options?.skipMentionResolution
      ? typedMentions ?? []
      : typedMentions ??
        this.deps.resolveMessageMentions(message.organizationId, message, channel);

    const existing = repo.getMessage(message.organizationId, message.id);
    const finalMessage = buildMessage({
      ...message,
      createdAt:
        existing?.createdAt ??
        this.deps.nextMessageCreatedAt(
          message.organizationId,
          message.threadId,
          message.createdAt,
        ),
      mentions: uniqueMentionIds(resolvedMentions),
      mentionNames: this.deps.resolveMentionNames(
        message.organizationId,
        message.content,
        channel,
      ),
    });

    const messageAttachments = (
      finalMessage as { attachments?: { id: string }[] }
    ).attachments ?? [];
    const linkedAttachmentIds =
      attachmentIds ?? messageAttachments.map((a) => a.id);

    if (linkedAttachmentIds.length > 0) {
      this.deps.requireAttachments(
        finalMessage.organizationId,
        linkedAttachmentIds,
      );
    }

    if (existing) {
      repo.updateMessage({
        ...finalMessage,
        createdAt: existing.createdAt,
        editedAt: new Date().toISOString(),
      });
    } else {
      // Race-safe dedupe: UNIQUE partial index on clientMessageId
      // means concurrent POSTs with the same clientMessageId resolve
      // to one persisted row. The loser's saveMessage returns the
      // winner's (different id). When that happens we MUST bail:
      // mention storage, attachment linking, and realtime emit would
      // all reference an id that was never persisted.
      const saved = repo.saveMessage(finalMessage);
      if (saved.id !== finalMessage.id) {
        return saved;
      }
    }

    repo.replaceMessageMentions(finalMessage.id, resolvedMentions);

    if (linkedAttachmentIds.length > 0) {
      repo.linkAttachmentsToMessage(finalMessage.id, linkedAttachmentIds);
    }

    const emittedMessage =
      linkedAttachmentIds.length > 0
        ? buildMessage({
            ...finalMessage,
            attachments: repo.listMessageAttachments(finalMessage.id),
          })
        : finalMessage;

    if (!options?.silent) {
      const rooms = this.deps.getPublishRooms(emittedMessage, channel);
      realtime.emit(
        channel?.kind === 'dm'
          ? SocketEventNames.dmMessage
          : emittedMessage.channelId
            ? SocketEventNames.channelMessage
            : SocketEventNames.threadMessage,
        channel?.kind === 'dm'
          ? {
              organizationId: emittedMessage.organizationId,
              message: emittedMessage,
            }
          : emittedMessage.channelId
            ? {
                organizationId: emittedMessage.organizationId,
                channelId: emittedMessage.channelId,
                message: emittedMessage,
              }
            : {
                organizationId: emittedMessage.organizationId,
                threadId: emittedMessage.threadId,
                message: emittedMessage,
              },
        rooms,
      );
    }

    return emittedMessage;
  }
}

function uniqueMentionIds(mentions: MessageMention[]): string[] {
  return [...new Set(mentions.map((mention) => mention.memberId))];
}
