import type { Message } from '@ujima/shared';
import type { PublishMessageOptions } from './conversation.js';
import { buildSystemMessage } from './message-factory.js';
import { filterVisibleMessages } from '../utils/message-visibility.js';
import {
  CONVERSATION_ARCHIVE_MARKER,
  CONVERSATION_COMPACTED_MARKER,
  CONVERSATION_COMPACTED_SOURCE_MARKERS,
  CONVERSATION_ROLLING_SUMMARY_MARKERS,
  CONVERSATION_SUMMARY_MARKER,
  SELF_NOTE_COMPACTED_MARKER,
  SELF_NOTE_SUMMARY_MARKER,
  buildSelfNoteSummary,
  isCompactionSummarySystemMessage,
  isSelfSummaryNote,
} from './conversation-summary.js';
import { isCompactedSourceMessage } from '../utils/message-visibility.js';
import { collectCursorPages } from '../utils/cursor-pages.js';

export const SELF_NOTE_COMPACTION_BATCH_SIZE = 100;
export const SELF_NOTE_RECENT_RAW_COUNT = 15;
export const SELF_NOTE_COMPACTION_TRIGGER = 500;
export const CONVERSATION_COMPACTION_BATCH_SIZE = 100;
 

export interface CompactionContext {
  repo: {
    getThread(organizationId: string, threadId: string): { channelId?: string } | null;
    getChannel(organizationId: string, channelId: string): { kind?: string } | null;
    listChannelMessages(
      organizationId: string,
      channelId: string,
      opts: { cursor?: string; limit?: number },
    ): { data: Message[]; hasMore: boolean; nextCursor?: string; searchRanks?: Record<string, number> };
    listMessages(
      organizationId: string,
      threadId: string,
      cursor?: string,
      limit?: number,
    ): { data: Message[]; hasMore: boolean; nextCursor?: string };
    saveMessage(message: Message): Message;
    updateMessage(message: Message): Message;
    countUncompactedMessageChars?(organizationId: string, threadId: string): number;
  };
  publishMessage(
    message: Message,
    mentions: never[],
    attachmentIds?: undefined,
    options?: PublishMessageOptions,
  ): Message;
  summarizeConversation(messages: Message[], mode: 'summary' | 'archive'): Promise<string>;
  contextWindowTokens(organizationId: string, threadId: string): number;
}

export function compactSelfNotesIfNeeded(
  ctx: CompactionContext,
  organizationId: string,
  memberId: string,
  channelId: string,
): void {
  const messages = listAllChannelMessages(ctx.repo, organizationId, channelId);
  if (messages.length <= SELF_NOTE_COMPACTION_TRIGGER) {
    return;
  }
  compactThreadMessages(ctx, {
    organizationId,
    threadId: channelId,
    senderId: memberId,
    messages,
    summaryMarker: SELF_NOTE_SUMMARY_MARKER,
    compactedMarker: SELF_NOTE_COMPACTED_MARKER,
    batchSize: SELF_NOTE_COMPACTION_BATCH_SIZE,
  });
}

export async function compactConversationIfNeeded(
  ctx: CompactionContext,
  organizationId: string,
  threadId: string,
  senderId: string,
): Promise<void> {
  const thread = ctx.repo.getThread(organizationId, threadId);
  const channel = thread?.channelId ? ctx.repo.getChannel(organizationId, thread.channelId) : null;
  if (channel?.kind === 'self') return;

  if (!conversationNeedsCompaction(
    ctx.repo,
    organizationId,
    threadId,
    ctx.contextWindowTokens(organizationId, threadId),
  )) return;

  const messages = listAllThreadMessages(ctx.repo, organizationId, threadId);
  const uncompacted = listUncompactedConversationMessages(
    messages,
    CONVERSATION_SUMMARIZE_COMPACTION,
  );
  if (uncompacted.length === 0) {
    return;
  }

  await compactConversationPass(ctx, {
    organizationId,
    threadId,
    senderId,
    plan: CONVERSATION_SUMMARIZE_COMPACTION,
  });
}

export function conversationNeedsCompaction(
  repo: CompactionContext['repo'],
  organizationId: string,
  threadId: string,
  contextWindowTokens = DEFAULT_CONTEXT_WINDOW_TOKENS,
): boolean {
  const rawMessages = listAllThreadMessages(repo, organizationId, threadId)
    .filter((message) =>
      !isCompactedSourceMessage(message) &&
      !isCompactionSummarySystemMessage(message),
    );
  // Use actual token counts when available (stamped by persistMessageTokens),
  // falling back to an estimate from char length for older messages.
  const usedTokens = rawMessages.reduce((total, message) => {
    if (typeof message.inputTokens === 'number' && typeof message.outputTokens === 'number') {
      return total + message.inputTokens + message.outputTokens;
    }
    return total + Math.ceil(message.content.length / 4);
  }, 0);
  const threshold = Math.floor(contextWindowTokens * 0.7);
  return usedTokens > threshold;
}

const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
const MAX_CONVERSATION_ARCHIVE_PASSES = 512;

type ConversationCompactionMode = 'summary' | 'archive';

interface ConversationCompactionPlan {
  summaryMarker: string;
  compactedMarker: string;
  batchSize: number;
  mode: ConversationCompactionMode;
}

const CONVERSATION_SUMMARIZE_COMPACTION: ConversationCompactionPlan = {
  summaryMarker: CONVERSATION_SUMMARY_MARKER,
  compactedMarker: CONVERSATION_COMPACTED_MARKER,
  batchSize: CONVERSATION_COMPACTION_BATCH_SIZE,
  mode: 'summary',
};

const CONVERSATION_ARCHIVE_COMPACTION: ConversationCompactionPlan = {
  summaryMarker: CONVERSATION_ARCHIVE_MARKER,
  compactedMarker: CONVERSATION_ARCHIVE_MARKER,
  batchSize: CONVERSATION_COMPACTION_BATCH_SIZE,
  mode: 'archive',
};

function conversationCompactionPlan(mode: 'summarize' | 'clear'): ConversationCompactionPlan {
  return mode === 'summarize' ? CONVERSATION_SUMMARIZE_COMPACTION : CONVERSATION_ARCHIVE_COMPACTION;
}

async function compactConversationPass(
  ctx: CompactionContext,
  input: {
    organizationId: string;
    threadId: string;
    senderId: string;
    plan: ConversationCompactionPlan;
    pass?: number;
  },
): Promise<{ summaryMessage: Message | null; compactedMessageIds: string[] }> {
  const messages = listAllThreadMessages(ctx.repo, input.organizationId, input.threadId);
  return compactThreadMessages(ctx, {
    organizationId: input.organizationId,
    threadId: input.threadId,
    senderId: input.senderId,
    messages,
    pass: input.pass,
    ...input.plan,
  });
}

async function compactConversationUntilDone(
  ctx: CompactionContext,
  input: {
    organizationId: string;
    threadId: string;
    senderId: string;
    plan: ConversationCompactionPlan;
    maxPasses?: number;
  },
): Promise<{ summaryMessage: Message | null; compactedMessageIds: string[] }> {
  let summaryMessage: Message | null = null;
  const compactedMessageIds: string[] = [];
  const maxPasses = input.maxPasses ?? MAX_CONVERSATION_ARCHIVE_PASSES;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const result = await compactConversationPass(ctx, { ...input, pass });
    if (!result.summaryMessage || result.compactedMessageIds.length === 0) {
      break;
    }
    summaryMessage = result.summaryMessage;
    compactedMessageIds.push(...result.compactedMessageIds);
  }
  return { summaryMessage, compactedMessageIds };
}

export async function archiveConversation(
  ctx: CompactionContext,
  organizationId: string,
  threadId: string,
  memberId: string,
  mode: 'summarize' | 'clear',
): Promise<{ summaryMessage: Message | null; compactedMessageIds: string[] }> {
  const input = {
    organizationId,
    threadId,
    senderId: memberId,
    plan: conversationCompactionPlan(mode),
  };
  return mode === 'summarize'
    ? compactConversationPass(ctx, input)
    : compactConversationUntilDone(ctx, input);
}

export function shouldHideCompactedMessage(message: Message, channel: { kind?: string } | null): boolean {
  if (isCompactedSourceMessage(message)) return true;
  if (isSelfSummaryNote(message)) return true;
  if (channel?.kind === 'self' && message.content.startsWith(SELF_NOTE_COMPACTED_MARKER)) return true;
  return false;
}

export function uncompactedExclusionMarkers(plan: {
  summaryMarker: string;
  compactedMarker: string;
  mode: ConversationCompactionMode;
}): string[] {
  const markers = new Set<string>([
    plan.summaryMarker,
    plan.compactedMarker,
    ...CONVERSATION_COMPACTED_SOURCE_MARKERS,
  ]);
  if (plan.mode === 'summary') {
    for (const marker of CONVERSATION_ROLLING_SUMMARY_MARKERS) {
      markers.add(marker);
    }
  }
  return [...markers];
}

export function listActiveCompactionSummaries(
  messages: Message[],
  summaryMarker: string,
): Message[] {
  return messages.filter(
    (message) =>
      isMessageWithAnyMarker(message, [summaryMarker]) &&
      !message.metadata?.compactedInto,
  );
}

export function listUncompactedConversationMessages(
  messages: Message[],
  plan: {
    summaryMarker: string;
    compactedMarker: string;
    mode: ConversationCompactionMode;
  },
): Message[] {
  const excluded = uncompactedExclusionMarkers(plan);
  return messages.filter(
    (message) =>
      !isCompactedSourceMessage(message) &&
      !isMessageWithAnyMarker(message, excluded),
  );
}

export function selectCompactionBatch(input: {
  messages: Message[];
  summaryMarker: string;
  compactedMarker: string;
  batchSize: number;
  mode: ConversationCompactionMode;
}): { activeSummaries: Message[]; compactable: Message[] } {
  const activeSummaries = listActiveCompactionSummaries(input.messages, input.summaryMarker);
  const uncompacted = listUncompactedConversationMessages(input.messages, input);
  const compactable = uncompacted.slice(0, input.batchSize);
  return { activeSummaries, compactable };
}

async function compactThreadMessages(
  ctx: CompactionContext,
  input: {
    organizationId: string;
    threadId: string;
    senderId: string;
    messages: Message[];
    summaryMarker: string;
    compactedMarker: string;
    batchSize: number;
    mode?: 'summary' | 'archive';
    pass?: number;
  },
): Promise<{ summaryMessage: Message | null; compactedMessageIds: string[] }> {
  const { activeSummaries, compactable } = selectCompactionBatch({
    messages: input.messages,
    summaryMarker: input.summaryMarker,
    compactedMarker: input.compactedMarker,
    batchSize: input.batchSize,
    mode: input.mode ?? 'summary',
  });
  if (compactable.length === 0) {
    return { summaryMessage: null, compactedMessageIds: [] };
  }
  const summarySources = [...activeSummaries, ...compactable];
  console.warn('[conversation-compact] compacting batch', {
    mode: input.mode ?? 'summary',
    pass: input.pass ?? 0,
    threadId: input.threadId,
    activeSummaryCount: activeSummaries.length,
    compactableCount: compactable.length,
    sourceCount: summarySources.length,
  });

  const now = new Date().toISOString();
  const summaryMessage = buildSystemMessage({
    organizationId: input.organizationId,
    threadId: input.threadId,
    channelId: ctx.repo.getThread(input.organizationId, input.threadId)?.channelId ?? undefined,
    content: input.mode
      ? await ctx.summarizeConversation(summarySources, input.mode)
      : buildSelfNoteSummary(summarySources),
    createdAt: now,
  });
  ctx.publishMessage(summaryMessage, [], undefined, {
    suppressDmAlerts: true,
    skipMentionResolution: true,
  });

  for (const source of summarySources) {
    ctx.repo.updateMessage({
      ...source,
      metadata: {
        ...source.metadata,
        compactedInto: summaryMessage.id,
      },
      editedAt: now,
    });
  }

  return {
    summaryMessage,
    compactedMessageIds: summarySources.map((message) => message.id),
  };
}

function listAllChannelMessages(
  repo: CompactionContext['repo'],
  organizationId: string,
  channelId: string,
): Message[] {
  return filterVisibleMessages(
    collectCursorPages((cursor) =>
      repo.listChannelMessages(organizationId, channelId, { cursor, limit: 200 }),
    ),
  ).sort((left, right) => {
    const byTime = left.createdAt.localeCompare(right.createdAt);
    return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
  });
}

function listAllThreadMessages(
  repo: CompactionContext['repo'],
  organizationId: string,
  threadId: string,
): Message[] {
  return filterVisibleMessages(
    collectCursorPages((cursor) =>
      repo.listMessages(organizationId, threadId, cursor, 200),
    ),
  ).sort((left, right) => {
    const byTime = left.createdAt.localeCompare(right.createdAt);
    return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
  });
}

export function isMessageWithAnyMarker(message: Message, markers: string[]): boolean {
  return markers.some((marker) => message.content.startsWith(marker));
}
