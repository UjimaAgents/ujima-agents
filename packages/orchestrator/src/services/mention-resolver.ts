import { randomUUID } from 'node:crypto';
import {
  AGENT_KIND,
  MessageMentionSchema,
  buildMentionHandleRegistry,
  scanMentionsInContent,
  type Channel,
  type Message,
  type MessageMention,
} from '@ujima/shared';

/**
 * Strip a trailing parenthetical role/disambiguation suffix from a
 * member display name: "Layla Reds ( OSINT )" → "Layla Reds". Used to
 * register a bare-name mention alias so "@Layla Reds" resolves.
 */
export function stripMentionSuffix(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/**
 * Mention-handle entries for a member list: the id, the full display
 * name, AND — when unique — the name with its trailing parenthetical
 * suffix stripped. The suffix alias is what lets "@Layla Reds" resolve
 * to a member named "Layla Reds ( OSINT )": without it the scanner's
 * exact `startsWith(handle)` match fails (the typed text never contains
 * "( OSINT )"), so the agent is never treated as addressed and stands
 * down as a passive broadcast bystander. The alias is only registered
 * when exactly one member could answer to that base, so an ambiguous
 * base stays unaliased rather than silently resolving to the wrong
 * agent. A base is ambiguous if it collides with ANY other member's
 * base — whether that other member reaches it via its own stripped
 * suffix ("Layla Reds ( Sales )") OR via its plain full name ("Layla
 * Reds"). The plain-name case is the important one: last-write-wins in
 * buildMentionHandleRegistry would otherwise let a suffixed member
 * hijack the bare name of a differently-named plain member.
 */
export function buildMemberMentionEntries(
  members: readonly { id: string; name: string }[],
  valueOf: (member: { id: string; name: string }) => string,
): { handle: string; value: string }[] {
  // For each candidate base (lowercased), the set of member ids that
  // could be addressed by it — via either the full name or the
  // suffix-stripped base. Size > 1 ⇒ ambiguous ⇒ no alias.
  const ownersByBase = new Map<string, Set<string>>();
  const addOwner = (base: string, id: string): void => {
    const key = base.toLowerCase();
    if (!key) return;
    let owners = ownersByBase.get(key);
    if (!owners) {
      owners = new Set();
      ownersByBase.set(key, owners);
    }
    owners.add(id);
  };
  for (const member of members) {
    addOwner(member.name, member.id);
    addOwner(stripMentionSuffix(member.name), member.id);
  }

  const entries: { handle: string; value: string }[] = [];
  for (const member of members) {
    const value = valueOf(member);
    entries.push({ handle: member.id, value });
    entries.push({ handle: member.name, value });
    const stripped = stripMentionSuffix(member.name);
    if (stripped && stripped.toLowerCase() !== member.name.toLowerCase()) {
      const owners = ownersByBase.get(stripped.toLowerCase());
      // Only alias when this member is the SOLE owner of the base.
      if (owners && owners.size === 1 && owners.has(member.id)) {
        entries.push({ handle: stripped, value });
      }
    }
  }
  return entries;
}

/**
 * Narrow contract for mention parsing, alias resolution, and mention-record
 * construction.
 *
 * Exposes only the repo methods it needs — a narrower port than the full
 * ConversationRepository.
 */
export interface MentionResolverRepo {
  listMembers(
    organizationId: string,
  ): { id: string; name: string; kind?: string }[];
  getChannel(
    organizationId: string,
    channelId: string,
  ): Channel | null;
}

export class MentionResolver {
  constructor(private readonly repo: MentionResolverRepo) {}

  /**
   * Parse a message's body text for @mention handles and return the resolved
   * mention records (with deduped member ids).
   */
  resolveMessageMentions(
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

  /**
   * Resolve mention member IDs and produce MessageMention records.
   */
  resolveMentionRecords(input: {
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

  /**
   * Resolve mention member IDs from content text, explicit mentions, and
   * @all / @everyone handles.
   */
  resolveMentionIds(
    organizationId: string,
    content: string,
    channel: Channel | null,
    senderKind: string,
    explicitMentionIds: string[],
  ): string[] {
    const mentionIds = new Set<string>(explicitMentionIds);
    const registry = buildMentionHandleRegistry(
      this.memberMentionEntries(organizationId, (member) => member.id),
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

  /**
   * Preserve mention IDs that were explicitly set on a message but cannot be
   * inferred from the current body text (used when editing a message).
   */
  inferExplicitMentionIds(organizationId: string, message: Message): string[] {
    const channel = message.channelId
      ? this.repo.getChannel(organizationId, message.channelId)
      : null;
    const parsedFromBody = new Set(
      this.resolveMentionIds(
        organizationId,
        message.content,
        channel,
        message.senderKind,
        [],
      ),
    );
    return message.mentions.filter(
      (memberId) => !parsedFromBody.has(memberId),
    );
  }

  /**
   * Resolve display names for @mention handles found in content.
   */
  resolveMentionNames(
    organizationId: string,
    content: string,
    channel: Channel | null,
  ): string[] {
    const registry = buildMentionHandleRegistry(
      this.memberMentionEntries(organizationId, (member) => member.name),
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

  /**
   * Get all member IDs that could be mentioned — either the channel's members
   * or the entire org roster.
   */
  resolveAllMentionIds(
    organizationId: string,
    channel: Channel | null,
  ): string[] {
    if (channel?.memberIds.length) {
      return channel.memberIds;
    }
    return this.repo
      .listMembers(organizationId)
      .map((member) => member.id);
  }

  private memberMentionEntries(
    organizationId: string,
    valueOf: (member: { id: string; name: string }) => string,
  ): { handle: string; value: string }[] {
    return buildMemberMentionEntries(
      this.repo.listMembers(organizationId),
      valueOf,
    );
  }
}
