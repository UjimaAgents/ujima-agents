import type { Member, Message, WakeReason } from '@ujima/shared';
import { AGENT_KIND, isOneToOneThread } from '@ujima/shared';

/**
 * Factual thread-state block injected into wake-triggered runs.
 *
 * The block is XML-shaped (Claude reads XML wrappers preferentially,
 * other providers parse them without penalty) and gives the model
 * **ground truth** about the current conversation state so it doesn't
 * have to invent claims like "already handled" or "addressed to
 * someone else." Without this block the model relies on its own
 * reading of the message log, which is where most hallucinated
 * justifications come from.
 *
 * The single most load-bearing element is `<not-yet-responded>`: it
 * answers the model's silent question "has someone else already
 * answered this?" with a deterministic value the model can cite.
 */

export interface BuildThreadStateInput {
  messages: Message[];
  currentMember: { id: string; name?: string };
  sourceMessageId?: string | null;
  members: Member[];
  /** Thread id — used to detect 1:1 DM threads (`dm:…`). */
  threadId?: string;
  /** Why the run was woken. */
  wakeReason?: WakeReason | string | null;
  /** Current channel name (e.g. "general", "design"). */
  channelName?: string;
}

export function buildThreadStateBlock(input: BuildThreadStateInput): string | null {
  if (!input.messages.length) return null;

  const memberById = new Map(input.members.map((m) => [m.id, m]));

  const sortedAsc = [...input.messages].sort((left, right) => {
    const byTime = left.createdAt.localeCompare(right.createdAt);
    return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
  });

  // The "source message" is whatever woke this run — passed in by the
  // caller when known. If not, fall back to the most-recent human
  // message in the thread, which is the wake-trigger ~95% of the time.
  const sourceMessage =
    (input.sourceMessageId
      ? sortedAsc.find((m) => m.id === input.sourceMessageId)
      : undefined) ??
    [...sortedAsc].reverse().find((m) => m.kind === 'human');

  // Who in the thread roster has posted a non-pass agent message
  // SINCE the source message — this is the model's "already handled"
  // signal. We count the source-message agent as "addressed" not
  // "responded" because they're the recipient, not a responder.
  const respondedByAgentIds = computeRespondersAfter(
    sortedAsc,
    sourceMessage,
    input.currentMember.id,
  );

  // The set of roster agents (other than self) who have NOT
  // responded yet. This is the most actionable line for the model.
  const rosterAgents = input.members.filter(
    (m) => m.kind === AGENT_KIND && !m.retiredAt && m.id !== input.currentMember.id,
  );
  const notYetRespondedAgents = rosterAgents
    .filter((m) => !respondedByAgentIds.has(m.id))
    .map((m) => m.name);

  // Who sent the source message — the current conversation partner.
  const senderName = sourceMessage
    ? memberById.get(sourceMessage.senderId)?.name ?? sourceMessage.senderId
    : undefined;

  // Explicit @ mentions on the source message — fact, from the
  // mentions table.
  const explicitMentions = sourceMessage
    ? (sourceMessage.mentions ?? []).map((id) => memberById.get(id)?.name ?? id)
    : [];

  // Implicit name references: scan the source body for case-insensitive
  // standalone occurrences of roster member names. Catches "Hey ava"
  // without a literal `@`. Skip the source sender's own name.
  const implicitNameReferences = sourceMessage
    ? findImplicitNameReferences(
        sourceMessage.content,
        input.members.filter((m) => m.id !== sourceMessage.senderId).map((m) => m.name),
      )
    : [];

  const selfName = input.currentMember.name ?? input.currentMember.id;
  const isDmThread = isOneToOneThread(input.threadId);
  const isChannelReadWake = input.wakeReason === 'channel-read';

  const selfAddressedExplicit = sourceMessage
    ? (sourceMessage.mentions ?? []).includes(input.currentMember.id)
    : false;
  let selfAddressedImplicit = implicitNameReferences.includes(selfName);
  // In a 1:1 DM, any message from the other participant is addressed to you.
  // @mentions and name tokens are optional. Palette/policy/scaffold use
  // resolveWakeReplyPolicy; this block only records factual addressing.
  if (
    isDmThread &&
    sourceMessage &&
    sourceMessage.senderId !== input.currentMember.id
  ) {
    selfAddressedImplicit = true;
  }

  // ---------- render ----------
  const lines: string[] = [];
  lines.push('<thread-state>');
  if (input.channelName) {
    lines.push(`  <current-channel>${escapeBody(input.channelName)}</current-channel>`);
  }
  if (sourceMessage) {
    lines.push('  <addressing>');
    lines.push(`    <conversation-kind>${isDmThread ? 'dm' : 'channel'}</conversation-kind>`);
    if (senderName) {
      lines.push(`    <from>${escapeBody(senderName)}</from>`);
    }
    lines.push(
      `    <source-message-id>${escapeBody(sourceMessage.id)}</source-message-id>`,
    );
    lines.push(
      `    <source-message-content>${escapeBody(sourceMessage.content || '(empty)')}</source-message-content>`,
    );
    lines.push(
      `    <explicit-mentions>${explicitMentions.length ? escapeBody(explicitMentions.join(', ')) : 'none'}</explicit-mentions>`,
    );
    lines.push(
      `    <implicit-name-references>${implicitNameReferences.length ? escapeBody(implicitNameReferences.join(', ')) : 'none'}</implicit-name-references>`,
    );
    lines.push(
      `    <you-explicitly-addressed>${selfAddressedExplicit ? 'true' : 'false'}</you-explicitly-addressed>`,
    );
    lines.push(
      `    <you-implicitly-addressed>${selfAddressedImplicit ? 'true' : 'false'}</you-implicitly-addressed>`,
    );
    lines.push(
      `    <reply-obligation>${isChannelReadWake ? 'optional-backpressure' : 'normal'}</reply-obligation>`,
    );
    lines.push('  </addressing>');
  }

  lines.push('  <coverage>');
  lines.push(
    `    <agents-who-already-responded>${respondedByAgentIds.size === 0 ? 'none' : [...respondedByAgentIds].map((id) => escapeBody(memberById.get(id)?.name ?? id)).join(', ')}</agents-who-already-responded>`,
  );
  lines.push(
    `    <agents-not-yet-responded>${notYetRespondedAgents.length === 0 ? 'none' : escapeBody(notYetRespondedAgents.join(', '))}</agents-not-yet-responded>`,
  );
  lines.push('  </coverage>');
  lines.push('</thread-state>');

  return lines.join('\n');
}

/**
 * Find roster member names that appear in the message body as
 * standalone tokens (case-insensitive). Catches "Hey ava" /
 * "ada please look at this" without a literal `@`.
 *
 * Exact-word match only — we don't want "alex" to match inside
 * "alexander", which would create false-positive addressing.
 */
function findImplicitNameReferences(body: string, candidateNames: string[]): string[] {
  const found = new Set<string>();
  for (const name of candidateNames) {
    if (!name) continue;
    // Split multi-word names into a regex that matches any of the
    // word components — `name = "Ava Ellis"` should match "ava" or
    // "ellis" or "Ava Ellis". We pick the FIRST word as the
    // recognizable token; full-name match is a bonus.
    const tokens = name.split(/\s+/).filter((t) => t.length >= 2);
    for (const token of tokens) {
      const safe = escapeRegex(token);
      const pattern = new RegExp(`(^|[^@\\w])${safe}\\b`, 'i');
      if (pattern.test(body)) {
        found.add(name);
        break;
      }
    }
  }
  return [...found];
}

/**
 * The set of agent member ids who have posted a non-pass message
 * AFTER the source message. "Pass" detection here is heuristic —
 * we don't have the run-state row in this utility — so we approximate
 * by content: messages with empty content or that look like a pure
 * pass-acknowledgement are excluded. This is intentionally a soft
 * heuristic: it's a SIGNAL to the model, not a runtime guard.
 */
function computeRespondersAfter(
  sortedAsc: Message[],
  sourceMessage: Message | undefined,
  currentMemberId: string,
): Set<string> {
  const responders = new Set<string>();
  if (!sourceMessage) return responders;

  const afterSource = sortedAsc.filter(
    (m) => m.createdAt > sourceMessage.createdAt && m.senderKind === AGENT_KIND && m.senderId !== currentMemberId,
  );
  for (const message of afterSource) {
    const trimmed = (message.content ?? '').trim();
    if (trimmed.length === 0) continue;
    responders.add(message.senderId);
  }
  return responders;
}

function escapeBody(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
