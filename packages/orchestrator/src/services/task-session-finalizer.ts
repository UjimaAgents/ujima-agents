import { randomUUID } from 'node:crypto';
import { type MessageCard, type Spirit, type TaskSession } from '@ujima/shared';
import type { ConversationService } from './conversation.js';
import type { ApiRepository } from './repository-reader.js';
import type { RealtimeService } from './context.js';
import { deriveTaskSessionOutcome, TERMINAL_TASK_SESSION_STATUSES } from './spirit-run-detail.js';
import { isLiveSpiritStatus } from './live-status.js';
import { buildSystemCardMessage } from './message-factory.js';
import { publishStoredMessage } from './message-publisher.js';

function buildTaskSessionSummary(
  repo: ApiRepository,
  organizationId: string,
  session: { slug: string; summary: string },
  workers: Spirit[],
  preferredSummary?: string,
): string {
  const trimmedPreferred = preferredSummary?.trim();
  if (trimmedPreferred) return trimmedPreferred;

  for (const spirit of workers.slice().reverse()) {
    const latestMessage = spirit.lastMessageId
      ? repo.getMessage(organizationId, spirit.lastMessageId)
      : null;
    const content = latestMessage?.content.trim();
    if (content) return content;
  }

  const failed = workers.find((spirit) => spirit.status === 'failed');
  if (failed?.lastError) return failed.lastError;

  const membersById = new Map(repo.listMembers(organizationId).map((member) => [member.id, member]));
  const completedNames = workers
    .filter((spirit) => spirit.status === 'completed')
    .map((spirit) => membersById.get(spirit.memberId)?.name ?? spirit.memberId);
  if (completedNames.length > 0) {
    return `Completed by ${completedNames.join(', ')}`;
  }

  return session.summary.trim() || `Task #${session.slug} finished`;
}

function publishTaskSummaryCard(input: {
  repo: ApiRepository;
  realtime: RealtimeService;
  conversations?: ConversationService;
  organizationId: string;
  threadId: string;
  channelId?: string;
  content: string;
  card: MessageCard;
}): void {
  publishStoredMessage({
    message: buildSystemCardMessage({
      organizationId: input.organizationId,
      threadId: input.threadId,
      channelId: input.channelId,
      content: input.content,
      card: input.card,
    }),
    repo: input.repo,
    realtime: input.realtime,
    conversations: input.conversations,
  });
}

function buildTaskSummaryCard(session: TaskSession, outcome: 'completed' | 'failed' | 'cancelled', summary: string): MessageCard {
  return {
    kind: 'task.summary',
    cardId: randomUUID(),
    taskSessionId: session.id,
    taskChannelId: session.channelId,
    taskSlug: session.slug,
    outcome,
    summary,
  };
}

export function maybeFinalizeTaskSession(input: {
  repo: ApiRepository;
  realtime: RealtimeService;
  conversations?: ConversationService;
  organizationId: string;
  taskSessionId: string;
  preferredSummary?: string;
}): void {
  const session = input.repo.getTaskSession(input.organizationId, input.taskSessionId);
  if (!session || TERMINAL_TASK_SESSION_STATUSES.has(session.status)) return;

  const workers = input.repo
    .listSpiritsForSession(input.organizationId, input.taskSessionId)
    .filter((spirit) => spirit.role === 'worker');
  if (workers.length === 0) return;
  if (workers.some((spirit) => isLiveSpiritStatus(spirit.status))) return;

  const outcome = deriveTaskSessionOutcome(workers);
  const summary = buildTaskSessionSummary(input.repo, input.organizationId, session, workers, input.preferredSummary);
  const updated = input.repo.updateTaskSessionStatus(input.organizationId, input.taskSessionId, outcome, {
    summary,
    completedAt: new Date().toISOString(),
  });
  if (!updated) return;

  const nextSession = updated as TaskSession;
  const statusVerb = outcome === 'completed' ? 'completed' : outcome === 'failed' ? 'failed' : 'cancelled';
  const baseCard = buildTaskSummaryCard(nextSession, outcome, summary);
  publishTaskSummaryCard({
    repo: input.repo,
    realtime: input.realtime,
    conversations: input.conversations,
    organizationId: nextSession.organizationId,
    threadId: nextSession.channelId,
    channelId: nextSession.channelId,
    content: `Task #${nextSession.slug} ${statusVerb}: ${summary}`,
    card: baseCard,
  });

  const general = input.repo
    .listAllChannels(nextSession.organizationId)
    .find((channel) => channel.kind === 'general' || channel.id === 'general' || channel.name === 'general');
  const linkbackTargets = new Map<string, { threadId: string; channelId?: string }>();
  if (general && general.id !== nextSession.channelId) {
    linkbackTargets.set(general.id, { threadId: general.id, channelId: general.id });
  }
  if (nextSession.origin.channelId && nextSession.origin.channelId !== nextSession.channelId) {
    linkbackTargets.set(nextSession.origin.channelId, {
      threadId: nextSession.origin.channelId,
      channelId: nextSession.origin.channelId,
    });
  }
  if (nextSession.origin.threadId && nextSession.origin.threadId !== nextSession.channelId) {
    linkbackTargets.set(nextSession.origin.threadId, {
      threadId: nextSession.origin.threadId,
      channelId: nextSession.origin.channelId,
    });
  }

  for (const target of linkbackTargets.values()) {
    publishTaskSummaryCard({
      repo: input.repo,
      realtime: input.realtime,
      conversations: input.conversations,
      organizationId: nextSession.organizationId,
      threadId: target.threadId,
      channelId: target.channelId,
      content: `Task #${nextSession.slug} ${statusVerb} — see #${nextSession.slug}`,
      card: buildTaskSummaryCard(nextSession, outcome, summary),
    });
  }
}
