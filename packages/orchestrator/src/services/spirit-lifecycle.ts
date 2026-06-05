import { randomUUID } from 'node:crypto';
import {
  RunStateSchema,
  SocketEventNames,
  SpiritSchema,
  TaskSessionSchema,
  type MessageCard,
  type Spirit,
  AGENT_KIND,
} from '@ujima/shared';
import { requireOrganization } from '../utils/require-organization.js';
import { isLiveSpiritStatus } from './live-status.js';
import {
  TERMINAL_TASK_SESSION_STATUSES,
  deriveTaskSessionOutcome,
} from './spirit-run-detail.js';
import type { SpawnSpiritInput } from './spirit-types.js';
import { SpiritServiceBase } from './spirit-service-base.js';
import { buildSystemCardMessage } from './message-factory.js';
import { publishStoredMessage } from './message-publisher.js';

export class SpiritServiceLifecycle extends SpiritServiceBase {
  spawn(input: SpawnSpiritInput): Spirit {
    return this.spawnTracked(input).spirit;
  }

  /** `created` distinguishes new rows from sticky triples for rollback-safe registry cleanup. */
  spawnTracked(input: SpawnSpiritInput): { spirit: Spirit; created: boolean } {
    requireOrganization(this.repo, input.organizationId);
    const role = input.role ?? 'worker';
    const session = this.repo.getTaskSession(input.organizationId, input.taskSessionId);
    if (!session) {
      throw new Error(`Task session not found: ${input.taskSessionId}`);
    }
    const member = this.repo.getMember(input.organizationId, input.memberId);
    if (!member) {
      throw new Error(`Member not found: ${input.memberId}`);
    }
    if (member.kind !== AGENT_KIND) {
      throw new Error(`Member "${input.memberId}" is not an agent`);
    }
    if (member.retiredAt) {
      throw new Error(`Member "${input.memberId}" is retired`);
    }

    const existing = this.repo.getSpiritByTriple(
      input.organizationId,
      input.taskSessionId,
      input.memberId,
      role,
    );
    if (existing) {
      return { spirit: existing, created: false };
    }

    const now = new Date().toISOString();
    const run = RunStateSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      agentId: input.memberId,
      threadId: session.channelId,
      status: 'queued',
      step: 'queued',
      summary: `Spirit (${role}) for #${session.slug}`,
      startedAt: now,
    });
    this.repo.saveRun(run);

    const spirit = SpiritSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      taskSessionId: input.taskSessionId,
      memberId: input.memberId,
      role,
      runId: run.id,
      status: 'queued',
      iteration: 0,
      tokensUsed: 0,
      createdAt: now,
      updatedAt: now,
    });
    this.repo.saveSpirit(spirit);
    this.registry.register(spirit);
    this.emit(SocketEventNames.spiritStarted, spirit);
    return { spirit, created: true };
  }

  /** @deprecated Use `spawn`. Retained for the Phase 2.A test surface. */
  spawnWorker(input: SpawnSpiritInput): Spirit {
    return this.spawn(input);
  }

  get(organizationId: string, spiritId: string): Spirit | null {
    return this.repo.getSpirit(organizationId, spiritId);
  }

  list(organizationId: string, taskSessionId: string): Spirit[] {
    return this.repo.listSpiritsForSession(organizationId, taskSessionId);
  }

  updateStatus(
    organizationId: string,
    spiritId: string,
    status: Spirit['status'],
    options: { error?: string } = {},
  ): Spirit | null {
    const existing = this.repo.getSpirit(organizationId, spiritId);
    if (!existing) return null;
    const now = new Date().toISOString();
    const updated: Spirit = SpiritSchema.parse({
      ...existing,
      status,
      lastError: options.error ?? existing.lastError,
      updatedAt: now,
      endedAt: isLiveSpiritStatus(status) ? existing.endedAt : (existing.endedAt ?? now),
    });
    this.repo.saveSpirit(updated);
    if (isLiveSpiritStatus(status)) {
      this.registry.register(updated);
    } else {
      this.registry.unregister(updated.organizationId, updated.memberId, updated.id);
    }
    this.emit(SocketEventNames.spiritUpdated, updated);
    return updated;
  }

  retire(organizationId: string, spiritId: string, reason?: string): Spirit | null {
    const existing = this.repo.getSpirit(organizationId, spiritId);
    if (!existing) return null;
    const now = new Date().toISOString();
    const retired: Spirit = SpiritSchema.parse({
      ...existing,
      status: 'cancelled',
      lastError: reason ?? existing.lastError,
      updatedAt: now,
      endedAt: existing.endedAt ?? now,
    });
    this.repo.saveSpirit(retired);
    this.registry.unregister(retired.organizationId, retired.memberId, retired.id);
    if (retired.runId) {
      const run = this.repo.getRun(organizationId, retired.runId);
      if (run) {
        this.repo.saveRun({
          ...run,
          status: 'cancelled',
          step: 'cancelled',
          summary: reason ?? 'Spirit retired',
          endedAt: run.endedAt ?? now,
        });
      }
    }
    this.emit(SocketEventNames.spiritRetired, retired);
    this.maybeFinalizeTaskSession(retired.organizationId, retired.taskSessionId, reason);
    return retired;
  }

  protected maybeFinalizeTaskSession(
    organizationId: string,
    taskSessionId: string,
    preferredSummary?: string,
  ): void {
    const session = this.repo.getTaskSession(organizationId, taskSessionId);
    if (!session || TERMINAL_TASK_SESSION_STATUSES.has(session.status)) {
      return;
    }

    const workers = this.repo
      .listSpiritsForSession(organizationId, taskSessionId)
      .filter((spirit) => spirit.role === 'worker');
    if (workers.length === 0) {
      return;
    }
    if (workers.some((spirit) => isLiveSpiritStatus(spirit.status))) {
      return;
    }

    const outcome = deriveTaskSessionOutcome(workers);
    const completedAt = new Date().toISOString();
    const summary = this.buildTaskSessionSummary(organizationId, session, workers, preferredSummary);
    const updated = this.repo.updateTaskSessionStatus(organizationId, taskSessionId, outcome, {
      summary,
      completedAt,
    });
    if (!updated) {
      return;
    }

    this.publishTaskSummaryMessages(
      TaskSessionSchema.parse(updated),
      outcome,
      summary,
    );
  }

  protected buildTaskSessionSummary(
    organizationId: string,
    session: { slug: string; summary: string },
    workers: Spirit[],
    preferredSummary?: string,
  ): string {
    const trimmedPreferred = preferredSummary?.trim();
    if (trimmedPreferred) {
      return trimmedPreferred;
    }

    for (const spirit of workers.slice().reverse()) {
      const latestMessage = spirit.lastMessageId
        ? this.repo.getMessage(organizationId, spirit.lastMessageId)
        : null;
      const content = latestMessage?.content.trim();
      if (content) {
        return content;
      }
    }

    const failed = workers.find((spirit) => spirit.status === 'failed');
    if (failed?.lastError) {
      return failed.lastError;
    }

    const membersById = new Map(
      this.repo.listMembers(organizationId).map((member) => [member.id, member]),
    );
    const completedNames = workers
      .filter((spirit) => spirit.status === 'completed')
      .map((spirit) => membersById.get(spirit.memberId)?.name ?? spirit.memberId);
    if (completedNames.length > 0) {
      return `Completed by ${completedNames.join(', ')}`;
    }

    return session.summary.trim() || `Task #${session.slug} finished`;
  }

  protected publishTaskSummaryMessages(
    session: {
      id: string;
      organizationId: string;
      channelId: string;
      slug: string;
      origin: { threadId?: string; channelId?: string };
    },
    outcome: 'completed' | 'failed' | 'cancelled',
    summary: string,
  ): void {
    const card: MessageCard = {
      kind: 'task.summary',
      cardId: randomUUID(),
      taskSessionId: session.id,
      taskChannelId: session.channelId,
      taskSlug: session.slug,
      outcome,
      summary,
    };

    const statusVerb =
      outcome === 'completed' ? 'completed' : outcome === 'failed' ? 'failed' : 'cancelled';

    this.publishSystemCardMessage({
      organizationId: session.organizationId,
      threadId: session.channelId,
      channelId: session.channelId,
      content: `Task #${session.slug} ${statusVerb}: ${summary}`,
      card,
    });

    const general = this.repo
      .listAllChannels(session.organizationId)
      .find((channel) => channel.kind === 'general' || channel.id === 'general' || channel.name === 'general');
    const linkbackTargets = new Map<string, { threadId: string; channelId?: string }>();
    if (general && general.id !== session.channelId) {
      linkbackTargets.set(general.id, { threadId: general.id, channelId: general.id });
    }
    if (session.origin.channelId && session.origin.channelId !== session.channelId) {
      linkbackTargets.set(session.origin.channelId, {
        threadId: session.origin.channelId,
        channelId: session.origin.channelId,
      });
    }
    if (session.origin.threadId && session.origin.threadId !== session.channelId) {
      linkbackTargets.set(session.origin.threadId, {
        threadId: session.origin.threadId,
        channelId: session.origin.channelId,
      });
    }

    for (const target of linkbackTargets.values()) {
      this.publishSystemCardMessage({
        organizationId: session.organizationId,
        threadId: target.threadId,
        channelId: target.channelId,
        content: `Task #${session.slug} ${statusVerb} — see #${session.slug}`,
        card,
      });
    }
  }

  protected publishSystemCardMessage(input: {
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
      repo: this.repo,
      realtime: this.realtime,
      conversations: this.conversations,
    });
  }
}
