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
  'Do not call channel.pass in a DM because you think you were not @mentioned; that rule applies to shared channels only.',
  'Use a posting tool (channel.reply, channel.dm, or message) to respond.',
].join('\n');

const CHANNEL_WAKE_SCAFFOLD_LINES = [
  'Before you pick a tool, read the <thread-state> block in the most recent user message.',
  'Treat its <agents-not-yet-responded> and <you-explicitly-addressed> / <you-implicitly-addressed> fields as ground truth — they are computed from the actual channel state, not from your reading.',
  'channel.ack = you were addressed but have no new information, question, or status to add. channel.pass = you were not addressed at all. channel.reply = you have substantive content (an answer, an artifact, a question, a status that changes the picture).',
  'If <you-explicitly-addressed>true</you-explicitly-addressed>, you must terminate via a tool. Use channel.reply ONLY when you have substantive content per the definition above; otherwise use channel.ack with an empty body. Acknowledging via channel.reply with paraphrased filler is treated as a missed reply.',
  'If <you-explicitly-addressed>false</you-explicitly-addressed> AND <you-implicitly-addressed>false</you-implicitly-addressed>, call channel.pass and stop. Do not post any message. The audit log already records that you considered the thread.',
  'When you call channel.pass, the note field must reference a specific fact from <thread-state>. Empty notes and generic phrasing are rejected.',
  'An auto-re-mention closing a hand-off does NOT count as being addressed. If the previous message is a plain acknowledgement of YOUR work and contains no new question, treat the chain as complete — call channel.handoff with complete:true (if you initiated the chain) or channel.ack (if you are receiving the acknowledgement).',
];

const CHANNEL_WAKE_SCAFFOLD = CHANNEL_WAKE_SCAFFOLD_LINES.join('\n');

const ANTI_MIRROR_SCAFFOLD_LINE =
  'IMPORTANT — anti-mirror rule: Do NOT paraphrase the previous message. If your intended reply restates what the previous turn already said, differs only by swapping names, or amounts to "noted / understood / I will await", call channel.ack with no body. Filler acknowledgements waste team attention and trigger redundant wakes.';

const SELF_FOLLOWUP_SCAFFOLD_LINES = [
  'You are waking on a commitment you made earlier in this channel. Before you stop, do one of: (a) call channel.post or channel.reply with concrete progress — a path you wrote, a result, or the actual artifact; (b) call channel.pass with a real reason ("still gathering inputs", "blocked on X") if you have no publishable progress yet; (c) call supervisor.todo.update if you need to mark the commitment blocked or completed. self.note alone is NOT a valid termination — every team member will notice you went silent on your own promise.',
  'For ANY deliverable longer than ~10 lines (task lists, BRDs, PRDs, specs, multi-section docs): use the `write` tool to save the artifact to a file in the workspace (e.g. ai/memory-bank/tasks/<name>.md) FIRST, then post a short channel.post that says "Delivered — see <path>". Pasting long markdown inline gets truncated at the token cap and the reader sees a half-written document.',
];

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

export function shouldSuppressPassAndSelfNote(
  policy: Pick<WakeReplyPolicy, 'suppressPassTool'>,
): boolean {
  return policy.suppressPassTool;
}

export function buildPassOrSelfNoteDenialReason(
  toolId: 'channel.pass' | 'self.note',
  policy: Pick<WakeReplyPolicy, 'mandatoryReply' | 'conversationKind'>,
): string {
  if (policy.mandatoryReply) {
    if (toolId === 'channel.pass') {
      return 'mandatory-reply: you were @mentioned, channel.pass is not allowed. Reply via channel.reply, channel.dm, or message.';
    }
    return 'mandatory-reply: you were @mentioned, self.note is not allowed. Reply via channel.reply, channel.dm, or message.';
  }
  if (toolId === 'channel.pass') {
    return 'direct-message: channel.pass is not allowed in a 1:1 DM. Reply via channel.reply, channel.dm, or message.';
  }
  return 'direct-message: self.note is not allowed in a 1:1 DM when a reply is expected. Reply via channel.reply, channel.dm, or message.';
}

export function filterToolsForWakeReplyPolicy(
  toolIds: readonly string[],
  policy: Pick<WakeReplyPolicy, 'suppressPassTool'>,
): string[] {
  if (!policy.suppressPassTool) {
    return [...toolIds];
  }
  return toolIds.filter((toolId) => toolId !== 'channel.pass' && toolId !== 'self.note');
}

/**
 * Assembles the wake-run decision scaffold: base DM/channel policy,
 * optional anti-mirror line for fragile models, and self-followup
 * publish-contract when the scheduler re-wakes a commitment owner.
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
  if (input.wakeReason === 'self-followup') {
    lines.unshift(...SELF_FOLLOWUP_SCAFFOLD_LINES);
  }
  return lines.join('\n');
}
