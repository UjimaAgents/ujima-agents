import type { ConversationKind, WakeReason } from '@ujima/shared';
import { isDirectMessageThread } from '@ujima/shared';

export interface WakeReplyPolicy {
  conversationKind: ConversationKind;
  suppressPassTool: boolean;
  mandatoryReply: boolean;
  scaffoldBlock: string;
}

const DM_WAKE_SCAFFOLD = [
  'Before you pick a tool, read the <thread-state> block in the most recent user message.',
  'This is a direct message (1:1) thread. Messages from your conversation partner are addressed to you — reply when they ask you to do something or expect a response.',
  'If the peer is another agent and the conversation has reached a natural stopping point, call channel.ack instead of sending a filler reply.',
  'Do not call channel.pass in a DM because you think you were not @mentioned; that rule applies to shared channels only.',
  'Use a posting tool (channel.reply, channel.dm, or message) to respond.',
].join('\n');

const CHANNEL_WAKE_SCAFFOLD_LINES = [
  'Before you pick a tool, read the <thread-state> block in the most recent user message.',
  'Treat its <agents-not-yet-responded> and <you-explicitly-addressed> / <you-implicitly-addressed> fields as ground truth — they are computed from the actual channel state, not from your reading.',
  'If <reply-obligation>optional-backpressure</reply-obligation>, the message was addressed to you but repeated agent-to-agent wake activity made a reply optional. Reply only with substantive new information; otherwise call channel.pass and stop.',
  'channel.ack = you were addressed under normal reply obligation but have no new information, question, or status to add. channel.pass = no reply is needed. channel.reply = you have substantive content (an answer, an artifact, a question, a status that changes the picture).',
  'If <you-explicitly-addressed>true</you-explicitly-addressed> AND <reply-obligation>normal</reply-obligation>, you must terminate via a tool. Use channel.reply ONLY when you have substantive content per the definition above; otherwise use channel.ack with an empty body. Acknowledging via channel.reply with paraphrased filler is treated as a missed reply.',
  // Out-of-scope handling: agents were silently channel.pass-ing with
  // `reason: out_of_scope` when explicitly addressed but the topic
  // didn't match their role. That looks like "Layla never replied"
  // to the human even though Layla DID consider the message. Force
  // an explicit, brief, visible response in that case.
  'If <you-explicitly-addressed>true</you-explicitly-addressed> AND <reply-obligation>normal</reply-obligation> AND the topic is outside your role/scope, use channel.reply with a one-line redirect (e.g. "That\'s outside my scope as <role>; @<better-fit-member> might be better here."). Do NOT use channel.pass with `reason: out_of_scope` when you were explicitly addressed under normal reply obligation.',
  'If <you-explicitly-addressed>false</you-explicitly-addressed> AND <you-implicitly-addressed>false</you-implicitly-addressed>, call channel.pass and stop. Do not post any message. The audit log already records that you considered the thread.',
  'When you call channel.pass, the note field must reference a specific fact from <thread-state>. Empty notes and generic phrasing are rejected.',
  'An auto-re-mention closing a hand-off does NOT count as being addressed. If the previous message is a plain acknowledgement of YOUR work and contains no new question, treat the chain as complete — call channel.handoff with complete:true (if you initiated the chain) or channel.ack (if you are receiving the acknowledgement).',
];

const CHANNEL_WAKE_SCAFFOLD = CHANNEL_WAKE_SCAFFOLD_LINES.join('\n');

export const ANTI_MIRROR_SCAFFOLD_LINE =
  'IMPORTANT — anti-mirror rule: Do NOT paraphrase the previous message. If your intended reply restates what the previous turn already said, differs only by swapping names, or amounts to "noted / understood / I will await", call channel.ack with no body. Filler acknowledgements waste team attention and trigger redundant wakes.';

export function resolveWakeReplyPolicy(input: {
  threadId: string;
  wakeReason?: WakeReason | null;
}): WakeReplyPolicy {
  const conversationKind: ConversationKind = isDirectMessageThread(input.threadId) ? 'dm' : 'channel';
  const mandatoryReply = input.wakeReason === 'mention';
  const suppressPassTool =
    mandatoryReply || (conversationKind === 'dm' && input.wakeReason !== 'channel-read');

  let scaffoldBlock = conversationKind === 'dm' ? DM_WAKE_SCAFFOLD : CHANNEL_WAKE_SCAFFOLD;
  if (conversationKind === 'dm' && input.wakeReason === 'channel-read') {
    scaffoldBlock = [
      'Before you pick a tool, read the <thread-state> block in the most recent user message.',
      'This is a direct message (1:1) thread demoted by channel-read back-pressure after a pairwise mention cap was hit.',
      'You are allowed to call channel.pass to stand down and break the loop.',
      'If you have no constructive/new response, please call channel.pass with a descriptive note immediately.',
    ].join('\n');
  }

  return {
    conversationKind,
    suppressPassTool,
    mandatoryReply,
    scaffoldBlock,
  };
}

export function buildPassDenialReason(
  policy: Pick<WakeReplyPolicy, 'mandatoryReply' | 'conversationKind'>,
): string {
  if (policy.mandatoryReply) {
    return 'mandatory-reply: you were @mentioned, channel.pass is not allowed. Reply via channel.reply, channel.dm, or message.';
  }
  return 'direct-message: channel.pass is not allowed in a 1:1 DM. Reply via channel.reply, channel.dm, or message.';
}

export function filterToolsForWakeReplyPolicy(
  toolIds: readonly string[],
  policy: Pick<WakeReplyPolicy, 'suppressPassTool'>,
): string[] {
  if (!policy.suppressPassTool) {
    return [...toolIds];
  }
  return toolIds.filter((toolId) => toolId !== 'channel.pass');
}

/**
 * Assembles the wake-run decision scaffold.
 */
export function buildWakeRunScaffold(input: {
  policy: WakeReplyPolicy;
  wakeReason?: WakeReason | null;
  mirrorFragile?: boolean;
}): string {
  const lines: string[] = [input.policy.scaffoldBlock];
  if (input.mirrorFragile) {
    lines.unshift(ANTI_MIRROR_SCAFFOLD_LINE);
  }
  return lines.join('\n');
}
