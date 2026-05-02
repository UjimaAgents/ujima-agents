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
   * the entire DB write set (channel, channel members, thread, session,
   * join message, optional origin link-back message) runs inside one
   * `repo.transaction()`. If any step throws, ROLLBACK leaves the org's
   * task-run state untouched — no orphan channels, no half-created
   * sessions, no pinned messages with a missing parent.
   *
   * Realtime emits fire after the commit so consumers never see events
   * for state that may roll back.
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

    const sessionId = randomUUID();
    const now = new Date().toISOString();

    const channelMemberIds = Array.from(
      new Set([requester.id, ...teamMembers.map((m) => m.id)]),
    );

    // Atomic write block — channel + members + thread + session are
    // ALL committed or NONE. The audit flagged the prior code for
    // leaving orphan channels/threads when the session insert later
    // raced on the slug UNIQUE; ROLLBACK eliminates that path.
    //
    // Slug collision retry — `allocateSlug` is an optimistic probe
    // that closes the common case, but two concurrent `create()`
    // calls in the same org can both pick the same candidate slug
    // and both reach the transaction. Whichever loses the race hits
    // SQLite's UNIQUE-violation on `task_sessions(organization_id,
    // slug)` (or the channel PK, which is `task:${org}:${slug}`).
    // We catch it, walk the next suffix, and retry. The probe is
    // still worth keeping — it makes the first attempt succeed for
    // every non-racing call.
    //
    // Messages (`task.join` + optional origin link-back) are published
    // AFTER the commit. They're idempotent in the recovery sense — if
    // the daemon dies between commit and publish, the channel still
    // exists with valid session backing and we lose only the join card
    // (a cosmetic, not a structural, loss). Putting them inside the tx
    // would require duplicating ConversationService.publishMessage's
    // mention-resolve / realtime-emit work — too much surface for too
    // little gain.
    let slug = '';
    let channelId = '';
    let session: TaskSession | undefined;
    let lastError: unknown;
    const slugBasis = input.slug ?? input.prompt;
    for (let attempt = 0; attempt < SLUG_ATTEMPT_LIMIT; attempt += 1) {
      slug = this.allocateSlug(input.organizationId, slugBasis, attempt);
      channelId = taskRunChannelId(input.organizationId, slug);
      session = TaskSessionSchema.parse({
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
      try {
        const channelToSave = ChannelSchema.parse({
          id: channelId,
          organizationId: input.organizationId,
          name: `#${slug}`,
          kind: 'task-run',
          topic: input.prompt.slice(0, 240),
          memberIds: channelMemberIds,
          createdAt: now,
        });
        this.repo.transaction(() => {
          this.repo.saveChannel(channelToSave);
          this.repo.setChannelMembers(channelId, channelMemberIds);
          this.repo.ensureThread({
            id: channelId,
            organizationId: input.organizationId,
            channelId,
            title: `#${slug}`,
            memberIds: channelMemberIds,
            createdAt: now,
          });
          // saveTaskSession enforces UNIQUE(organization_id, slug)
          // and UNIQUE(channel_id) at commit. A racing creator wins
          // here and we throw → ROLLBACK undoes the channel/thread
          // writes, the catch loops with a new suffix.
          this.repo.saveTaskSession(session as TaskSession);
        });
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err;
        if (!isUniqueViolation(err)) throw err;
        // Continue with the next suffix attempt.
      }
    }
    if (lastError !== undefined || !session) {
      throw lastError ?? new Error('failed to allocate a unique slug for task session');
    }

    // Post-commit messages. Use publishMessage so the realtime path
    // and mention-resolve plumbing match the rest of the substrate.
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
    const spirits = this.spirits;
    if (!spirits) {
      throw new Error('SpiritService is not wired into this TaskSessionService');
    }
    const session = this.repo.getTaskSession(organizationId, taskSessionId);
    if (!session) {
      throw new Error(`Task session not found: ${taskSessionId}`);
    }

    // Pre-validate every team member BEFORE spawning anything. spawn()
    // does the same checks itself, but each spawn writes a Spirit row,
    // a Run row, and an in-memory registry entry. Without pre-flight
    // a member that was retired AFTER the session was created (e.g.
    // by config-sync) would fail mid-loop and leave earlier members
    // half-spawned: the API surfaces the error but the session is in
    // an inconsistent state and can't be cleanly retried.
    //
    // Caveat: this is not TOCTOU-tight on its own — a member could
    // race a retirement between the pre-flight and the spawn. The
    // remaining race is acceptable because the spawn() code path
    // re-validates and the fix here covers the common case (members
    // already in a bad state at start time). A SQL transaction could
    // tighten it further but spawn() also writes the in-memory
    // registry which is non-transactional, so the value is limited.
    for (const memberId of session.teamMemberIds) {
      const member = this.repo.getMember(organizationId, memberId);
      if (!member) {
        throw new Error(`Team member not found: ${memberId}`);
      }
      if (member.kind !== 'agent') {
        throw new Error(`Member "${memberId}" is not an agent`);
      }
      if (member.retiredAt) {
        throw new Error(`Cannot start task session — member "${memberId}" is retired`);
      }
    }

    // Wrap the spawn loop + status flip in a SQL transaction so a
    // mid-loop failure rolls the persisted Spirit/Run rows back to
    // their pre-call state. The in-memory ActiveSpiritRegistry is
    // not rollback-aware on its own, so we track the spirits this
    // call CREATED (not the ones it found pre-existing) and unregister
    // only those on failure. Pre-existing spirits' DB rows survive
    // the rollback — touching their registry entries would blind the
    // supervisor gate to live work that pre-dated this call. The
    // realtime emits inside spawn() already fired before any rollback
    // — consumers of `spirit:started` are expected to be best-effort
    // (same trade-off as TaskSessionService.create's join message).
    const spawned: Spirit[] = [];
    const created: Spirit[] = [];
    try {
      this.repo.transaction(() => {
        for (const memberId of session.teamMemberIds) {
          const result = spirits.spawnTracked({
            organizationId,
            taskSessionId,
            memberId,
          });
          spawned.push(result.spirit);
          if (result.created) {
            created.push(result.spirit);
          }
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
      });
    } catch (err) {
      // SQL writes have rolled back. Mirror that on the registry —
      // but ONLY for spirits this call created. Pre-existing spirits
      // weren't written by this transaction; their registry entries
      // are still source-of-truth-correct.
      const registry = spirits.getActiveRegistry();
      for (const spirit of created) {
        registry.unregister(spirit.organizationId, spirit.memberId, spirit.id);
      }
      throw err;
    }

    if (options.runFirstTurn) {
      // Run spirits sequentially in tests so assertions stay
      // deterministic. Production drives this via the real run loop
      // and can choose its own concurrency.
      for (const spirit of spawned) {
        await spirits.run({
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

  /**
   * Pick a candidate slug for a given attempt index. The probe against
   * `getTaskSessionBySlug` closes the common case; the actual UNIQUE
   * collision retry happens at the transaction layer in `create()`,
   * so this method is allowed to optimistically return a candidate
   * even when a concurrent creator hasn't committed yet.
   *
   * Attempt schedule:
   *   0       → bare slug
   *   1       → 4-char random suffix
   *   2       → 6-char random suffix
   *   3       → 8-char random suffix
   *   4..N-1  → 12-char UUID-derived suffix (always-fresh entropy)
   */
  private allocateSlug(organizationId: string, basis: string, attempt: number): string {
    const base = sluggify(basis) || 'task';
    if (attempt === 0) {
      const candidate = base.slice(0, 64);
      if (!this.repo.getTaskSessionBySlug(organizationId, candidate)) {
        return candidate;
      }
    }
    const suffixLen = attempt === 1 ? 4 : attempt === 2 ? 6 : attempt === 3 ? 8 : 12;
    return `${base}-${randomShortId(suffixLen)}`.slice(0, 64);
  }

  private requireOrganization(organizationId: string): void {
    if (!this.repo.getOrganization(organizationId)) {
      throw new Error(`Organization not found: ${organizationId}`);
    }
  }
}

/**
 * Maximum number of slug attempts before `create()` gives up. Each
 * attempt is a fresh transaction with a different candidate suffix.
 * 8 is well past the practical collision rate for 12-char hex suffixes
 * (which would require ≥ 2^48 concurrent same-org creators to plausibly
 * exhaust).
 */
const SLUG_ATTEMPT_LIMIT = 8;

/**
 * Detect SQLite/better-sqlite3 UNIQUE-constraint violations. The
 * `task_sessions` UNIQUE on (organization_id, slug) and the channels
 * PK both surface as `SqliteError` with a message containing
 * "UNIQUE constraint failed". The `code` field is more reliable when
 * present.
 */
function isUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')) return true;
  return /UNIQUE constraint failed/i.test(err.message);
}

/**
 * Compose the global PK for a task-run channel. The `channels.id`
 * column is a global primary key, but slugs are only unique per
 * organisation — without the org prefix two orgs choosing the same
 * slug would collide on the channel PK and corrupt each other's
 * task-run state. Exported so test fixtures can assert the shape.
 */
export function taskRunChannelId(organizationId: string, slug: string): string {
  return `task:${organizationId}:${slug}`;
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
