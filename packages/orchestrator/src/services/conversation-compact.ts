import type { Message } from '@ujima/shared';
import { buildSystemMessage } from './message-factory.js';
import { filterVisibleMessages } from '../utils/message-visibility.js';
import {
  CONVERSATION_ARCHIVE_MARKER,
  CONVERSATION_COMPACTED_MARKER,
  CONVERSATION_SUMMARY_MARKER,
  SELF_NOTE_COMPACTED_MARKER,
  SELF_NOTE_SUMMARY_MARKER,
  buildSelfNoteSummary,
  buildConversationArchiveSummary,
  buildConversationSummary,
  isSelfSummaryNote,
} from './conversation-summary.js';
import { isCompactedSourceMessage } from '../utils/message-visibility.js';

export const COMPACTION_TRIGGER = 500;
export const SELF_NOTE_COMPACTION_BATCH_SIZE = 35;
export const SELF_NOTE_RECENT_RAW_COUNT = 15;
export const CONVERSATION_COMPACTION_BATCH_SIZE = 35;
export const CONVERSATION_RECENT_RAW_COUNT = 15;

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
  };
  publishMessage(
    message: Message,
    mentions: never[],
    attachmentIds?: undefined,
    options?: { suppressDmAlerts?: boolean; skipMentionResolution?: boolean },
  ): Message;
}

export function compactSelfNotesIfNeeded(
  ctx: CompactionContext,
  organizationId: string,
  memberId: string,
  channelId: string,
): void {
  const messages = listAllChannelMessages(ctx.repo, organizationId, channelId);
  if (messages.length <= COMPACTION_TRIGGER) {
    return;
  }
  compactThreadMessages(ctx, {
    organizationId,
    threadId: channelId,
    senderId: memberId,
    messages,
    summaryMarker: SELF_NOTE_SUMMARY_MARKER,
    compactedMarker: SELF_NOTE_COMPACTED_MARKER,
    keepRawCount: SELF_NOTE_RECENT_RAW_COUNT,
    batchSize: SELF_NOTE_COMPACTION_BATCH_SIZE,
    buildSummary: buildSelfNoteSummary,
  });
}

export function compactConversationIfNeeded(
  ctx: CompactionContext,
  organizationId: string,
  threadId: string,
  senderId: string,
): void {
  const thread = ctx.repo.getThread(organizationId, threadId);
  const channel = thread?.channelId ? ctx.repo.getChannel(organizationId, thread.channelId) : null;
  if (channel?.kind === 'self') return;

  const messages = listAllThreadMessages(ctx.repo, organizationId, threadId);
  const uncompacted = messages.filter(
    (message) =>
      !isMessageWithAnyMarker(message, [
        CONVERSATION_SUMMARY_MARKER,
        CONVERSATION_COMPACTED_MARKER,
        CONVERSATION_ARCHIVE_MARKER,
      ]),
  );
  if (uncompacted.length <= COMPACTION_TRIGGER) {
    return;
  }

  compactThreadMessages(ctx, {
    organizationId,
    threadId,
    senderId,
    messages,
    summaryMarker: CONVERSATION_SUMMARY_MARKER,
    compactedMarker: CONVERSATION_COMPACTED_MARKER,
    keepRawCount: CONVERSATION_RECENT_RAW_COUNT,
    batchSize: CONVERSATION_COMPACTION_BATCH_SIZE,
    buildSummary: buildConversationSummary,
  });
}

export function archiveConversation(
  ctx: CompactionContext,
  organizationId: string,
  threadId: string,
  memberId: string,
  mode: 'summarize' | 'clear',
): { summaryMessage: Message | null; compactedMessageIds: string[] } {
  const messages = listAllThreadMessages(ctx.repo, organizationId, threadId);
  const plan =
    mode === 'clear'
      ? {
          summaryMarker: CONVERSATION_ARCHIVE_MARKER,
          compactedMarker: CONVERSATION_ARCHIVE_MARKER,
          keepRawCount: 0,
          batchSize: Number.MAX_SAFE_INTEGER,
          buildSummary: buildConversationArchiveSummary as (messages: Message[]) => string,
        }
      : {
          summaryMarker: CONVERSATION_SUMMARY_MARKER,
          compactedMarker: CONVERSATION_COMPACTED_MARKER,
          keepRawCount: CONVERSATION_RECENT_RAW_COUNT,
          batchSize: CONVERSATION_COMPACTION_BATCH_SIZE,
          buildSummary: buildConversationSummary,
        };

  return compactThreadMessages(ctx, {
    organizationId,
    threadId,
    senderId: memberId,
    messages,
    ...plan,
  });
}

export function shouldHideCompactedMessage(message: Message, channel: { kind?: string } | null): boolean {
  if (isCompactedSourceMessage(message)) return true;
  if (isSelfSummaryNote(message)) return true;
  if (channel?.kind === 'self' && message.content.startsWith(SELF_NOTE_COMPACTED_MARKER)) return true;
  return false;
}

function compactThreadMessages(
  ctx: CompactionContext,
  input: {
    organizationId: string;
    threadId: string;
    senderId: string;
    messages: Message[];
    summaryMarker: string;
    compactedMarker: string;
    keepRawCount: number;
    batchSize: number;
    buildSummary: (messages: Message[]) => string;
  },
): { summaryMessage: Message | null; compactedMessageIds: string[] } {
  const activeSummaries = input.messages.filter((message) =>
    isMessageWithAnyMarker(message, [input.summaryMarker]),
  );
  const uncompacted = input.messages.filter(
    (message) =>
      !isMessageWithAnyMarker(message, [
        input.summaryMarker,
        input.compactedMarker,
        CONVERSATION_COMPACTED_MARKER,
        CONVERSATION_ARCHIVE_MARKER,
      ]),
  );
  const keepRawStart = Math.max(uncompacted.length - input.keepRawCount, 0);
  const compactable = uncompacted.slice(0, keepRawStart).slice(0, input.batchSize);
  const summarySources = [...activeSummaries, ...compactable];
  if (summarySources.length === 0) {
    return { summaryMessage: null, compactedMessageIds: [] };
  }

  const now = new Date().toISOString();
  const summaryMessage = buildSystemMessage({
    organizationId: input.organizationId,
    threadId: input.threadId,
    channelId: ctx.repo.getThread(input.organizationId, input.threadId)?.channelId ?? undefined,
    content: input.buildSummary(summarySources),
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
  const all: Message[] = [];
  let cursor: string | undefined;
  do {
    const page = repo.listChannelMessages(organizationId, channelId, { cursor, limit: 200 });
    all.push(...filterVisibleMessages(page.data));
    cursor = page.nextCursor;
    if (!page.hasMore) break;
  } while (cursor);
  return all.sort((left, right) => {
    const byTime = left.createdAt.localeCompare(right.createdAt);
    return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
  });
}

function listAllThreadMessages(
  repo: CompactionContext['repo'],
  organizationId: string,
  threadId: string,
): Message[] {
  const all: Message[] = [];
  let cursor: string | undefined;
  do {
    const page = repo.listMessages(organizationId, threadId, cursor, 200);
    all.push(...filterVisibleMessages(page.data));
    cursor = page.nextCursor;
    if (!page.hasMore) break;
  } while (cursor);
  return all.sort((left, right) => {
    const byTime = left.createdAt.localeCompare(right.createdAt);
    return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
  });
}

export function isMessageWithAnyMarker(message: Message, markers: string[]): boolean {
  return markers.some((marker) => message.content.startsWith(marker));
}
