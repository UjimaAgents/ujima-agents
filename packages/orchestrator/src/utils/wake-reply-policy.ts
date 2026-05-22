import type { WakeReason } from '@ujima/shared';
import { isDirectMessageThread } from './thread-state.js';

export type ConversationKind = 'dm' | 'channel';

export interface WakeReplyPolicy {
  conversationKind: ConversationKind;
  suppressPassTool: boolean;
  denyPassInPolicy: boolean;
  mandatoryReply: boolean;
  scaffoldBlock: string;
}

const DM_WAKE_SCAFFOLD = [
  'Before you pick a tool, read the <thread-state> block in the most recent user message.',
  'This is a direct message (1:1) thread. Messages from your conversation partner are addressed to you — reply when they ask you to do something or expect a response.',
  'Do not call channel.pass in a DM because you think you were not @mentioned; that rule applies to shared channels only.',
  'Use a posting tool (channel.reply, channel.dm, or message) to respond.',
].join('\n');

const CHANNEL_WAKE_SCAFFOLD = [
  'Before you pick a tool, read the <thread-state> block in the most recent user message.',
  'Treat its <agents-not-yet-responded> and <you-explicitly-addressed> / <you-implicitly-addressed> fields as ground truth — they are computed from the actual channel state, not from your reading.',
  'If <you-explicitly-addressed>true</you-explicitly-addressed>, you must reply via a posting tool.',
  'If <you-explicitly-addressed>false</you-explicitly-addressed> AND <you-implicitly-addressed>false</you-implicitly-addressed>, call channel.pass and stop. Do not post any message — not a short acknowledgement, not a status update, not a hand-off announcement. The audit log already records that you considered the thread.',
  'When you call channel.pass, the reason must match thread-state facts. Do not write filler in the note field.',
].join('\n');

export function resolveWakeReplyPolicy(input: {
  threadId: string;
  wakeReason?: WakeReason | null;
}): WakeReplyPolicy {
  const conversationKind: ConversationKind = isDirectMessageThread(input.threadId) ? 'dm' : 'channel';
  const mandatoryReply = input.wakeReason === 'mention';
  const suppressPassTool = mandatoryReply || conversationKind === 'dm';

  return {
    conversationKind,
    suppressPassTool,
    denyPassInPolicy: suppressPassTool,
    mandatoryReply,
    scaffoldBlock: conversationKind === 'dm' ? DM_WAKE_SCAFFOLD : CHANNEL_WAKE_SCAFFOLD,
  };
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
