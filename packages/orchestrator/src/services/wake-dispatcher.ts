import {
  AGENT_KIND,
  SocketEventNames,
  channelRoom,
  memberRoom,
  orgRoom,
  threadRoom,
  isAgentOnlyThread,
  type AgentOnlyMember,
  type Channel,
  type Message,
  type MessageMention,
  type WakeReason,
  type WakeSuppressedReason,
} from '@ujima/shared';
import { isVacuousAck } from './mirror-guard.js';
import type { RealtimeService } from './context.js';
import { normalizeToDottedToolName } from './run-reply-guard.js';
import type { MentionQuota, ChannelReadQuota, PairMentionTracker } from './conversation-quota.js';
import { buildSystemMessage } from './message-factory.js';

/**
 * Wake-related member data needed from the repo.
 */
export interface WakeDispatcherRepo {
  getMember(
    organizationId: string,
    memberId: string,
  ): { id: string; name: string; kind?: string; retiredAt?: string | null } | null;
  getChannelMemberMode(
    organizationId: string,
    channelId: string,
    memberId: string,
  ): 'muted' | 'temp_disable' | 'passive' | 'active' | null | undefined;
  listMembers(
    organizationId: string,
  ): { id: string; kind?: string; retiredAt?: string | null }[];
  listAllChannels(
    organizationId: string,
  ): { id: string; name: string }[];
  getChannel(
    organizationId: string,
    channelId: string,
  ): { memberIds: string[]; kind?: string } | null;
}

export const WAKEABLE_AGENT_DM_TERMINATORS = new Set([
  'message',
  'channel.reply',
  'channel.post',
  'channel.handoff',
]);

export interface WakeDispatcherDeps {
  repo: WakeDispatcherRepo;
  realtime: RealtimeService;
  mentionQuota: MentionQuota;
  channelReadQuota: ChannelReadQuota;
  pairMentionTracker: PairMentionTracker;
  onMemberAlerted?: (input: {
    organizationId: string;
    memberId: string;
    channelId?: string;
    threadId: string;
    messageId: string;
    byMemberId: string;
    reason: string;
    wakeReason: WakeReason;
  }) => Promise<void> | void;
  /** Callback to publish a system message (e.g. throttled mention notice). */
  publishSystemMessage: (message: Message) => Message;
}

/**
 * Owns wake/alert decision logic:
 * - Which members to wake (mention, DM, channel-read)
 * - Quota enforcement (MentionQuota, ChannelReadQuota, PairMentionTracker)
 * - Member mode checks (muted, passive, retired)
 * - Wake-suppressed realtime events
 *
 * Does NOT own:
 * - Message persistence or realtime emit for messages (that's MessageWriter)
 * - Conversation compaction logic
 */
export class WakeDispatcher {
  constructor(private readonly deps: WakeDispatcherDeps) {}

  /**
   * Alert members who were @-mentioned in a message.
   */
  async alertMentionedMembers(
    message: Message,
    mentions: MessageMention[],
    channel: Channel | null,
  ): Promise<void> {
    const { repo, mentionQuota, pairMentionTracker } = this.deps;
    const seen = new Set<string>();
    const fanout: Promise<void>[] = [];

    for (const mention of mentions) {
      if (seen.has(mention.memberId)) continue;
      seen.add(mention.memberId);
      if (mention.memberId === message.senderId) continue;

      const member = repo.getMember(message.organizationId, mention.memberId);
      if (!member || member.kind !== AGENT_KIND || member.retiredAt) continue;

      // Muted/temp_disable agents don't wake even on @mention
      if (channel) {
        const memberMode = repo.getChannelMemberMode(
          message.organizationId,
          channel.id,
          member.id,
        );
        if (memberMode === 'muted' || memberMode === 'temp_disable') continue;
      }

      // Scoped channel member check
      if (channel) {
        if (channel.kind === 'self') continue;
        if (channel.memberIds.length > 0 && !channel.memberIds.includes(member.id)) continue;
      }

      // Mention quota
      if (!mentionQuota.consume(`${message.organizationId}:${member.id}`)) {
        this.publishMentionThrottled(message.organizationId, member.id, message.senderId);
        continue;
      }

      // Pair back-pressure
      const countInWindow =
        message.senderKind === AGENT_KIND
          ? pairMentionTracker.record(
              `${message.organizationId}|${message.threadId}|${message.senderId}|${member.id}`,
            )
          : 0;
      if (countInWindow > 3) {
        this.emitEchoSuppressed({
          organizationId: message.organizationId,
          fromMemberId: message.senderId,
          toMemberId: member.id,
          channelId: channel?.id,
          threadId: message.threadId,
          countInWindow,
        });
        continue;
      }

      fanout.push(this.alertMember(message, member.id, channel, 'mention'));
    }

    await Promise.all(fanout);
  }

  /**
   * Alert channel readers when a human posts to a public channel.
   */
  async alertChannelReaders(
    message: Message,
    channel: Channel | null,
    mentions: MessageMention[],
  ): Promise<void> {
    const { repo, channelReadQuota } = this.deps;
    if (!channel || (channel.kind !== 'general' && channel.kind !== 'group')) return;
    if (message.senderKind !== 'human' || message.kind === 'system' || message.senderId === 'system') return;

    const alreadyMentioned = new Set(mentions.map((m) => m.memberId));
    const candidates =
      channel.memberIds.length === 0
        ? repo.listMembers(message.organizationId)
        : channel.memberIds
            .map((memberId) => repo.getMember(message.organizationId, memberId))
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
      if (alreadyMentioned.has(member.id)) continue;
      if (!channelReadQuota.consume(`${message.organizationId}:${member.id}:${channel.id}`)) {
        this.emitWakeSuppressed(message, channel, member.id, 'quota');
        continue;
      }
      const memberMode = repo.getChannelMemberMode(
        message.organizationId,
        channel.id,
        member.id,
      );
      if (memberMode === 'muted' || memberMode === 'temp_disable') {
        this.emitWakeSuppressed(message, channel, member.id, 'mode-blocked');
        continue;
      }
      if (memberMode === 'passive') {
        this.emitWakeSuppressed(message, channel, member.id, 'mode-passive');
        continue;
      }
      fanout.push(this.alertMember(message, member.id, channel, 'channel-read'));
    }
    await Promise.all(fanout);
  }

  /**
   * Alert DM participants (when they weren't already @-mentioned).
   */
  async alertDirectMessageParticipants(
    message: Message,
    channel: Channel | null,
  ): Promise<void> {
    const { repo, pairMentionTracker } = this.deps;
    if (!channel || channel.kind !== 'dm') return;

    const recipients = channel.memberIds.filter(
      (memberId) => memberId !== message.senderId,
    );
    const sender = repo.getMember(message.organizationId, message.senderId);

    await Promise.all(
      recipients.map(async (recipientId) => {
        const memberMode = repo.getChannelMemberMode(
          message.organizationId,
          channel.id,
          recipientId,
        );
        if (memberMode === 'muted' || memberMode === 'temp_disable') return;

        const recipient = repo.getMember(message.organizationId, recipientId);
        try {
          const isAgentPair =
            sender?.kind === AGENT_KIND && recipient?.kind === AGENT_KIND;
          const countInWindow = isAgentPair
            ? pairMentionTracker.record(
                `${message.organizationId}|${message.threadId}|${message.senderId}|${recipientId}`,
              )
            : 0;
          const wakeReason: WakeReason =
            countInWindow > 1 ? 'channel-read' : 'dm';

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

          await this.alertMember(
            message,
            recipientId,
            channel,
            wakeReason,
          );
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

  shouldSuppressDmWake(message: Message, channel: Channel | null): boolean {
    if (!channel || channel.kind !== 'dm') return false;
    if (message.kind !== AGENT_KIND) return false;
    const members = channel.memberIds
      .map((id) => this.deps.repo.getMember(message.organizationId, id))
      .filter((member) => member != null)
      .map((member) => ({ id: member.id, kind: member.kind }));
    if (!isAgentOnlyThread(message.threadId, members as readonly AgentOnlyMember[])) return false;
    const handoff = (
      message.metadata as { handoff?: { complete?: boolean } } | undefined
    )?.handoff;
    if (handoff?.complete === true || isVacuousAck(message.content)) return true;
    if (message.toolCalls.length === 0) return message.content.trim().length === 0;
    return !message.toolCalls.some((call) =>
      WAKEABLE_AGENT_DM_TERMINATORS.has(normalizeToDottedToolName(call.toolName)),
    );
  }

  /** Fire-and-forget: logs on failure instead of unhandled rejection. */
  fanout(label: string, promise: Promise<unknown>): void {
    promise.catch((error) => {
      console.error(
        `wake: ${label} failed`,
        error instanceof Error ? error.stack ?? error.message : String(error),
      );
    });
  }

  private emitWakeSuppressed(
    message: Message,
    channel: Channel | null,
    memberId: string,
    reason: WakeSuppressedReason,
  ): void {
    this.deps.realtime.emit(
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

  emitEchoSuppressed(input: {
    organizationId: string;
    fromMemberId: string;
    toMemberId: string;
    channelId?: string;
    threadId?: string;
    countInWindow: number;
  }): void {
    this.deps.realtime.emit(
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

  async alertMember(
    message: Message,
    memberId: string,
    channel: Channel | null,
    reason: WakeReason | string,
  ): Promise<void> {
    const member = this.deps.repo.getMember(
      message.organizationId,
      memberId,
    );
    if (!member || member.kind !== 'agent' || member.retiredAt) return;

    const wakeReason: WakeReason =
      reason === 'mention' ||
      reason === 'dm' ||
      reason === 'channel-read' ||
      reason === 'handoff' ||
      reason === 'parent-thread'
        ? reason
        : 'mention';

    this.deps.realtime.emit(
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

    await this.deps.onMemberAlerted?.({
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

  publishMentionThrottled(
    organizationId: string,
    memberId: string,
    byMemberId: string,
  ): void {
    const channel = this.deps.repo
      .listAllChannels(organizationId)
      .find((candidate) => candidate.name === 'general' || candidate.id === 'general');
    if (!channel) return;

    const systemMessage = buildSystemMessage({
      organizationId,
      threadId: channel.id,
      channelId: channel.id,
      content: `member.alert_throttled: mention delivery for "${memberId}" by "${byMemberId}" exceeded alerts window`,
    });
    this.deps.publishSystemMessage(systemMessage);
  }
}
