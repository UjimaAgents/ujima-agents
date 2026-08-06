import { hasAnyMessageMarker, type Message, type RunStep } from '@ujima/shared';
import type { PublishMessageOptions } from './conversation-types.js';
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
  isSelfSummaryNote,
} from './conversation-summary.js';
import { isCompactedSourceMessage } from '../utils/message-visibility.js';
import { collectCursorPages } from '../utils/cursor-pages.js';
import { completedRunSteps, extractToolCallIdsFromMessages } from '../utils/run-transcript.js';

export const SELF_NOTE_COMPACTION_BATCH_SIZE = 100;
export const SELF_NOTE_RECENT_RAW_COUNT = 15;
export const SELF_NOTE_COMPACTION_TRIGGER = 500;
export const CONVERSATION_COMPACTION_BATCH_SIZE = 100;
/** Number of most recent user-triggered turns to preserve intact during compaction. */
export const CONVERSATION_TAIL_TURNS = 2;

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
    listRunSteps?(organizationId: string, runId: string): RunStep[];
    countUncompactedMessageChars?(organizationId: string, threadId: string): number;
  };
  publishMessage(
    message: Message,
    mentions: never[],
    attachmentIds?: undefined,
    options?: PublishMessageOptions,
  ): Message;
  summarizeConversation(messages: Message[], mode: 'summary' | 'archive', runSteps: RunStep[], signal?: AbortSignal): Promise<string>;
  contextWindowTokens(organizationId: string, threadId: string): number;
}

export async function compactSelfNotesIfNeeded(
  ctx: CompactionContext,
  organizationId: string,
  memberId: string,
  channelId: string,
): Promise<void> {
  await Promise.resolve();
  const messages = listAllChannelMessages(ctx.repo, organizationId, channelId);
  if (messages.length <= SELF_NOTE_COMPACTION_TRIGGER) {
    return;
  }
  await compactThreadMessages(ctx, {
    organizationId,
    threadId: channelId,
    senderId: memberId,
    messages,
    summaryMarker: SELF_NOTE_SUMMARY_MARKER,
    compactedMarker: SELF_NOTE_COMPACTED_MARKER,
    batchSize: SELF_NOTE_COMPACTION_BATCH_SIZE,
    tailTurns: SELF_NOTE_RECENT_RAW_COUNT,
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

  await compactConversationUntilDone(ctx, {
    organizationId,
    threadId,
    senderId,
    plan: CONVERSATION_SUMMARIZE_COMPACTION,
    maxPasses: 8,
  });
}

export function conversationNeedsCompaction(
  repo: CompactionContext['repo'],
  organizationId: string,
  threadId: string,
  contextWindowTokens = DEFAULT_CONTEXT_WINDOW_TOKENS,
): boolean {
  const estimatedChars = repo.countUncompactedMessageChars?.(organizationId, threadId);
  // Use actual token counts when available (stamped by persistMessageTokens),
  // falling back to an estimate from char length for older messages.
  const threshold = Math.floor(contextWindowTokens * 0.7);
  if (estimatedChars !== undefined && Math.ceil(estimatedChars / 4) <= threshold) return false;
  const rawMessages = listAllThreadMessages(repo, organizationId, threadId)
    .filter((message) => !isCompactedSourceMessage(message));
  const usedTokens = estimatePromptReplayTokens(repo, organizationId, rawMessages);
  return usedTokens > threshold;
}

export function estimatePromptReplayTokens(
  repo: Pick<CompactionContext['repo'], 'listRunSteps'>,
  organizationId: string,
  messages: readonly Message[],
): number {
  const knownToolCallIds = extractToolCallIdsFromMessages(messages);
  let total = 0;
  for (const message of messages) {
    if (message.inputTokens !== undefined || message.outputTokens !== undefined) {
      total += message.inputTokens ?? 0;
      total += message.outputTokens ?? 0;
      continue;
    }
    total += estimateTokensForValue(message.content);
    if (message.toolCalls.length > 0) total += estimateTokensForValue(message.toolCalls);
    if (message.reasoningContent) total += estimateTokensForValue(message.reasoningContent);
  }

  const runIds = new Set(
    messages
      .map((message) => message.metadata?.runId)
      .filter((runId): runId is string => typeof runId === 'string' && runId.length > 0),
  );
  for (const runId of runIds) {
    for (const step of completedRunSteps(repo.listRunSteps?.(organizationId, runId) ?? [])) {
      if (knownToolCallIds.has(step.toolCallId)) continue;
      total += estimateTokensForValue(step.input);
      if (step.output !== undefined) total += estimateTokensForValue(step.output);
    }
  }
  return total;
}

function estimateTokensForValue(value: unknown): number {
  return Math.ceil(stringifyForTokenEstimate(value).length / 4);
}

function stringifyForTokenEstimate(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? '');
  }
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
    ? compactConversationUntilDone(ctx, { ...input, maxPasses: 8 })
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
      hasAnyMessageMarker(message.content, [summaryMarker]) &&
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
      !hasAnyMessageMarker(message.content, excluded),
  );
}

/**
 * Find the message index of the start of the "tail" — the most recent
 * N user-triggered turns that should be preserved intact during compaction.
 * Returns the index (from the full `messages` array) where the tail begins,
 * or 0 if all messages should be compacted.
 */
export function tailStartIndex(
  messages: Message[],
  exclusionMarkers: string[],
  tailTurns: number,
  selfMemberId?: string,
): number {
  if (tailTurns <= 0 || messages.length === 0) return 0;
  let found = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || hasAnyMessageMarker(msg.content, exclusionMarkers)) continue;
    // Preserve whole incoming turns by counting only messages not sent by the
    // current agent. Once we find the Nth incoming turn, we keep everything
    // from that point onward, including the assistant/tool work that followed.
    if (msg.kind !== 'system' && (!selfMemberId || msg.senderId !== selfMemberId)) {
      found++;
      if (found >= tailTurns) return i;
    }
  }
  return 0;
}

export function selectCompactionBatch(input: {
  messages: Message[];
  summaryMarker: string;
  compactedMarker: string;
  batchSize: number;
  mode: ConversationCompactionMode;
  tailTurns?: number;
  selfMemberId?: string;
}): { activeSummaries: Message[]; compactable: Message[] } {
  const activeSummaries = listActiveCompactionSummaries(input.messages, input.summaryMarker);
  const uncompacted = listUncompactedConversationMessages(input.messages, input);
  // Only preserve tail turns in summary mode (archive mode does a full clear).
  const effectiveTailTurns = input.mode === 'summary' ? (input.tailTurns ?? CONVERSATION_TAIL_TURNS) : 0;
  const excludeMarkers = uncompactedExclusionMarkers(input);
  const tailIdx = tailStartIndex(input.messages, excludeMarkers, effectiveTailTurns, input.selfMemberId);

  let compactable: Message[];
  if (tailIdx > 0) {
    // Only compact messages before the tail
    const beforeTailIds = new Set(
      input.messages.slice(0, tailIdx).map((m) => m.id),
    );
    compactable = uncompacted.filter((m) => beforeTailIds.has(m.id)).slice(0, input.batchSize);
  } else {
    compactable = uncompacted.slice(0, input.batchSize);
  }
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
    tailTurns?: number;
  },
): Promise<{ summaryMessage: Message | null; compactedMessageIds: string[] }> {
  const { activeSummaries, compactable } = selectCompactionBatch({
    messages: input.messages,
    summaryMarker: input.summaryMarker,
    compactedMarker: input.compactedMarker,
    batchSize: input.batchSize,
    mode: input.mode ?? 'summary',
    tailTurns: input.tailTurns,
    selfMemberId: input.senderId,
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
  const runSteps = summaryRunSteps(ctx.repo, input.organizationId, summarySources);
  const summaryMessage = buildSystemMessage({
    organizationId: input.organizationId,
    threadId: input.threadId,
    channelId: ctx.repo.getThread(input.organizationId, input.threadId)?.channelId ?? undefined,
    content: input.mode
      ? await ctx.summarizeConversation(summarySources, input.mode, runSteps)
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

function summaryRunSteps(
  repo: Pick<CompactionContext['repo'], 'listRunSteps'>,
  organizationId: string,
  messages: readonly Message[],
): RunStep[] {
  const runIds = new Set(messages.flatMap((message) => message.metadata?.runId ? [message.metadata.runId] : []));
  return completedRunSteps([...runIds].flatMap((runId) => repo.listRunSteps?.(organizationId, runId) ?? []));
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

export async function emergencyCompactThread(
  ctx: CompactionContext,
  organizationId: string,
  threadId: string,
  senderId: string,
): Promise<boolean> {
  const messages = listAllThreadMessages(ctx.repo, organizationId, threadId);
  const uncompacted = listUncompactedConversationMessages(messages, {
    summaryMarker: CONVERSATION_ARCHIVE_MARKER,
    compactedMarker: CONVERSATION_ARCHIVE_MARKER,
    mode: 'archive',
  });
  if (uncompacted.length === 0) return false;

  console.warn('[conversation-compact] emergency archiving thread', {
    threadId,
    uncompactedCount: uncompacted.length,
    totalMessages: messages.length,
  });

  await compactThreadMessages(ctx, {
    organizationId,
    threadId,
    senderId,
    messages,
    summaryMarker: CONVERSATION_ARCHIVE_MARKER,
    compactedMarker: CONVERSATION_ARCHIVE_MARKER,
    batchSize: uncompacted.length,
    mode: 'archive',
  });

  return true;
}
