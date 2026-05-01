import { randomUUID } from 'node:crypto';
import {
  ChannelSchema,
  MessageSchema,
  TaskSessionSchema,
  type MessageCard,
  type Spirit,
  type TaskExecutionMode,
  type TaskSession,
  type TaskSessionStatus,
} from '@ujima/shared';
import type { ConversationService } from './conversation.js';
import type { ApiRepository, PaginatedTaskSessions } from './repository-reader.js';
import type { SpiritService } from './spirit.js';

// -----------------------------------------------------------------------
// TaskSessionService — Phase 1 of the unified task shell.
//
// Responsibilities:
//   * Create a TaskSession aggregate row.
//   * Spin up the matching `task-run` channel + thread, with the team
//     auto-joined and a `kind='system'` "joined" notice posted.
//   * Optionally post a link-back card in the origin channel so the
//     conversation that prompted the work can find the new task channel.
//   * Persist a generic `MessageCard` payload on each system message via
//     the existing immutable `messages.tool_calls` JSON column. Concrete
//     card kinds (approvals, tool calls, completion summaries) ride on
//     the same primitive in later phases.
//   * Enforce the human-only origination invariant: only `kind='human'`
//     members can request a task session. Agent-authored requests are
//     rejected at this layer (the structural rule from the plan).
//
// Worker / supervisor / promoter lifecycles are explicitly NOT in
// Phase 1 — they live above this service and are added in Phase 2/3.
// -----------------------------------------------------------------------

export interface CreateTaskSessionInput {
  organizationId: string;
  requestedBy: string;
  prompt: string;
  team: string[]; // member ids on the task
  executionMode?: TaskExecutionMode;
  origin?: { channelId?: string; messageId?: string };
  promotionMetadata?: Record<string, unknown>;
  /**
   * Optional explicit slug. Useful for tests / CLI invocations that want
   * deterministic channel names. When omitted, a slug is derived from
   * the prompt + a short id.
   */
  slug?: string;
}

export interface TaskSessionDetail {
  session: TaskSession;
  channel: ReturnType<ApiRepository['getChannel']>;
}

export class TaskSessionService {
  constructor(
    private readonly repo: ApiRepository,
    private readonly conversations: ConversationService,
    /**
     * Phase 2 wiring. Optional so existing call sites (and Phase 1
     * tests) that don't care about the spirit layer can keep
     * constructing a TaskSessionService with two args.
     */
    private readonly spirits?: SpiritService,
  ) {}

  /**
   * Create a TaskSession + matching task-run channel + join system message
   * + optional origin link-back. Atomic from the caller's perspective:
   * either everything below the service line landed, or the call threw
   * and nothing should have persisted (the SQLite work is small enough
   * that we don't wrap it in an explicit transaction yet — Phase 2 may
   * tighten this when the worker loop adds run-row persistence to the
   * same call).
   */
  create(input: CreateTaskSessionInput): TaskSessionDetail {
    this.requireOrganization(input.organizationId);

    const requester = this.repo.getMember(input.organizationId, input.requestedBy);
    if (!requester) {
      throw new Error(`Requester not found: ${input.requestedBy}`);
    }
    // Human-only origination is a structural invariant from the plan
    // (only humans can originate tasks; agents waking each other never
    // creates a task channel). Enforced at the lowest service layer so
    // every entrypoint inherits the rule.
    if (requester.kind !== 'human') {
      throw new Error(
        `Only human members can originate tasks (member "${input.requestedBy}" is "${requester.kind}")`,
      );
    }

    // Validate the team set: every id must be a real, non-retired member
    // of the org. Avoids creating a session whose worker rows can never
    // run because the team points at deleted ids.
    const teamMembers = input.team.map((memberId) => {
      const member = this.repo.getMember(input.organizationId, memberId);
      if (!member) {
        throw new Error(`Team member not found: ${memberId}`);
      }
      if (member.retiredAt) {
        throw new Error(`Cannot include retired member "${memberId}" on a task team`);
      }
      return member;
    });

    const slug = this.allocateSlug(input.organizationId, input.slug ?? input.prompt);
    const channelId = `task:${slug}`;
    const sessionId = randomUUID();
    const now = new Date().toISOString();

    // 1. Create the task-run channel pinned to this session.
    const channelMemberIds = Array.from(
      new Set([requester.id, ...teamMembers.map((m) => m.id)]),
    );
    this.repo.saveChannel(
      ChannelSchema.parse({
        id: channelId,
        organizationId: input.organizationId,
        name: `#${slug}`,
        kind: 'task-run',
        topic: input.prompt.slice(0, 240),
        memberIds: channelMemberIds,
        createdAt: now,
      }),
    );
    this.repo.setChannelMembers(channelId, channelMemberIds);
    this.repo.ensureThread({
      id: channelId,
      organizationId: input.organizationId,
      channelId,
      title: `#${slug}`,
      memberIds: channelMemberIds,
      createdAt: now,
    });

    // 2. Persist the session row. `channel_id` is unique, so rerunning
    //    `create` with the same slug after a crash is rejected by the
    //    DB — callers must regenerate.
    const session = TaskSessionSchema.parse({
      id: sessionId,
      organizationId: input.organizationId,
      slug,
      channelId,
      requestedBy: requester.id,
      executionMode: input.executionMode ?? 'concurrent',
      status: 'queued',
      prompt: input.prompt,
      summary: '',
      teamMemberIds: teamMembers.map((m) => m.id),
      origin: {
        channelId: input.origin?.channelId,
        messageId: input.origin?.messageId,
      },
      promotionMetadata: input.promotionMetadata ?? {},
      supervisorTurnCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    this.repo.saveTaskSession(session);

    // 3. Post the "joined" system message in the new task-run channel.
    const joinCard: MessageCard = {
      kind: 'task.join',
      cardId: randomUUID(),
      taskSessionId: sessionId,
      memberIds: channelMemberIds,
    };
    const joinMessageContent =
      teamMembers.length > 0
        ? `${teamMembers.map((m) => m.name).join(', ')} joined`
        : `task #${slug} created`;
    this.publishCardMessage({
      organizationId: input.organizationId,
      threadId: channelId,
      channelId,
      content: joinMessageContent,
      card: joinCard,
    });

    // 4. Optional origin link-back. Posts a system message in the
    //    originating channel that points at the new task-run channel,
    //    so the ambient conversation surfaces the work.
    if (input.origin?.channelId && input.origin.channelId !== channelId) {
      const originChannel = this.repo.getChannel(input.organizationId, input.origin.channelId);
      if (originChannel) {
        const linkCard: MessageCard = {
          kind: 'task.origin-link',
          cardId: randomUUID(),
          taskSessionId: sessionId,
          taskChannelId: channelId,
          taskSlug: slug,
        };
        this.publishCardMessage({
          organizationId: input.organizationId,
          threadId: originChannel.id,
          channelId: originChannel.id,
          content: `Started #${slug} — follow along`,
          card: linkCard,
        });
      }
    }

    return {
      session,
      channel: this.repo.getChannel(input.organizationId, channelId),
    };
  }

  get(organizationId: string, taskSessionId: string): TaskSession | null {
    this.requireOrganization(organizationId);
    return this.repo.getTaskSession(organizationId, taskSessionId);
  }

  /**
   * Phase 2 entry point. Provisions a Worker row per agent on the team
   * (idempotent — re-calling is a no-op past the first time per
   * triple) and optionally drives one initial turn per worker. The
   * default behaviour is `provisionOnly`, leaving the actual run kick
   * off to the caller (route handler, supervisor, CLI). Tests pass
   * `runFirstTurn: true` to exercise the full path in one call.
   */
  async start(
    organizationId: string,
    taskSessionId: string,
    options: { runFirstTurn?: boolean } = {},
  ): Promise<{ session: TaskSession; spirits: Spirit[] }> {
    this.requireOrganization(organizationId);
    if (!this.spirits) {
      throw new Error('SpiritService is not wired into this TaskSessionService');
    }
    const session = this.repo.getTaskSession(organizationId, taskSessionId);
    if (!session) {
      throw new Error(`Task session not found: ${taskSessionId}`);
    }
    const spawned: Spirit[] = [];
    for (const memberId of session.teamMemberIds) {
      const spirit = this.spirits.spawn({
        organizationId,
        taskSessionId,
        memberId,
      });
      spawned.push(spirit);
    }

    // Bump the session row to `running` once at least one spirit
    // exists. The supervisor/promoter layer above can still flip it
    // back to `waiting_for_approval` etc on its own cadence.
    if (spawned.length > 0 && session.status === 'queued') {
      this.repo.saveTaskSession({
        ...session,
        status: 'running',
        updatedAt: new Date().toISOString(),
      });
    }

    if (options.runFirstTurn) {
      // Run spirits sequentially in tests so assertions stay
      // deterministic. Production drives this via the real run loop
      // and can choose its own concurrency.
      for (const spirit of spawned) {
        await this.spirits.run({
          organizationId,
          taskSessionId,
          memberId: spirit.memberId,
        });
      }
    }

    const refreshed = this.repo.getTaskSession(organizationId, taskSessionId) ?? session;
    return { session: refreshed, spirits: spawned };
  }

  list(
    organizationId: string,
    options: { cursor?: string; limit?: number; status?: TaskSessionStatus } = {},
  ): PaginatedTaskSessions {
    this.requireOrganization(organizationId);
    return this.repo.listTaskSessions(organizationId, options);
  }

  updateStatus(
    organizationId: string,
    taskSessionId: string,
    status: TaskSessionStatus,
    options: { summary?: string; completedAt?: string } = {},
  ): TaskSession | null {
    this.requireOrganization(organizationId);
    return this.repo.updateTaskSessionStatus(organizationId, taskSessionId, status, options);
  }

  // ------------------------------------------------------------------
  // internals
  // ------------------------------------------------------------------

  private publishCardMessage(input: {
    organizationId: string;
    threadId: string;
    channelId: string;
    content: string;
    card: MessageCard;
  }): void {
    const message = MessageSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      threadId: input.threadId,
      channelId: input.channelId,
      senderId: 'system',
      senderKind: 'human',
      kind: 'system',
      content: input.content,
      mentions: [],
      // The card payload rides on the immutable `tool_calls` JSON column.
      // Reusing this column keeps Phase 1 schema-additive — once tool-call
      // cards land in Phase 2/3 they share this exact shape.
      toolCalls: [
        {
          toolCallId: input.card.cardId,
          toolName: `card.${input.card.kind}`,
          args: input.card as unknown as Record<string, unknown>,
          isError: false,
        },
      ],
      createdAt: new Date().toISOString(),
    });
    this.conversations.publishMessage(message, []);
  }

  private allocateSlug(organizationId: string, basis: string): string {
    const base = sluggify(basis) || 'task';
    // Try the base slug first; on collision, append progressively longer
    // random suffixes until we land on a free name. The probability of
    // hitting a unique-violation past 4 chars is astronomically small.
    for (const suffixLen of [0, 4, 6, 8]) {
      const suffix = suffixLen === 0 ? '' : `-${randomShortId(suffixLen)}`;
      const candidate = `${base}${suffix}`.slice(0, 64);
      if (!this.repo.getTaskSessionBySlug(organizationId, candidate)) {
        return candidate;
      }
    }
    // Final fallback: full UUID suffix.
    return `${base}-${randomUUID().slice(0, 12)}`.slice(0, 64);
  }

  private requireOrganization(organizationId: string): void {
    if (!this.repo.getOrganization(organizationId)) {
      throw new Error(`Organization not found: ${organizationId}`);
    }
  }
}

function sluggify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function randomShortId(length: number): string {
  // Hex-based, lowercase, alphanumeric — fits the slug character class.
  return randomUUID().replace(/-/g, '').slice(0, length);
}
