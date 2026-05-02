import { randomUUID } from 'node:crypto';
import {
  MessageSchema,
  SocketEventNames,
  channelRoom,
  memberRoom,
  orgRoom,
  type Message,
} from '@ujima/shared';
import type { ActiveSpiritRegistry } from './active-spirit-registry.js';
import type { RealtimeService } from './context.js';
import type { ConversationService } from './conversation.js';
import type { ApiRepository } from './repository-reader.js';
import type { SpiritService } from './spirit.js';

// ---------------------------------------------------------------------------
// SupervisorService — Phase 2.C.3
//
// The supervisor is a *lazy* shadow of the worker. It exists only as
// long as a `member.alerted` event needs answering: a DM landed, an
// @mention hit, the user wants a status check. The supervisor:
//
//   * Runs ONLY when the ActiveSpiritRegistry says the member has a
//     live worker. Idle agents take the regular wake path (the existing
//     run.createRun in services/index.ts).
//   * Holds a per-member mutex (`member_id + 'supervisor'`) so concurrent
//     alerts serialize.
//   * Debounces successive alerts within `debounceMs` (default 2_000) into
//     a single follow-up turn — chatty users mid-run shouldn't fan out
//     into N supervisor calls.
//   * Caps total supervisor turns per task session at `turnCapPerSession`
//     (default 10). The (cap+1)th alert posts a deterministic auto-reply
//     pointing at the task-run channel.
//   * Uses the cheaper-tier model via SpiritService(role='supervisor')
//     and a strict tool allowlist (SUPERVISOR_TOOL_ALLOWLIST).
//   * On model failure, posts a deterministic templated reply so an
//     LLM-down day never silently swallows a question.
// ---------------------------------------------------------------------------

const DEFAULT_DEBOUNCE_MS = 2_000;
const DEFAULT_TURN_CAP_PER_SESSION = 10;

export interface SupervisorServiceOptions {
  debounceMs?: number;
  turnCapPerSession?: number;
}

export interface SupervisorAlertInput {
  organizationId: string;
  memberId: string;
  channelId?: string;
  messageId: string;
  threadId: string;
  byMemberId: string;
  reason: string;
}

export interface SupervisorReplyOutcome {
  taskSessionId: string;
  message: Message;
  fallback: boolean;
  reason: string;
}

/**
 * Discriminated result of a `handleAlert` dispatch. Three terminal
 * states the caller (createApiServices.wakeMember) cares about:
 *
 *   * `replied`           — supervisor turn fired and posted a reply
 *   * `no-active-spirit`  — no live worker for this member; caller may
 *                            fall through to the regular wake path
 *   * `debounced`         — alert suppressed by the per-member 2s
 *                            debounce window. Caller MUST NOT fall
 *                            through — that would spawn a duplicate
 *                            run for the second mention in a burst.
 *   * `cap-blocked`       — supervisor cap reached for the session;
 *                            included for completeness even though
 *                            the cap path also publishes a fallback
 *                            message via the `replied` channel
 *                            (this state is reserved for future
 *                            use; current cap path returns `replied`
 *                            with `fallback=true`).
 */
export type SupervisorDispatchResult =
  | { kind: 'replied'; outcome: SupervisorReplyOutcome }
  | { kind: 'no-active-spirit' }
  | { kind: 'debounced' };

export class SupervisorService {
  private readonly debounceMs: number;
  private readonly turnCapPerSession: number;
  private readonly mutexes = new Map<string, Promise<unknown>>();
  private readonly lastAlertAt = new Map<string, number>();

  constructor(
    private readonly repo: ApiRepository,
    private readonly realtime: RealtimeService,
    private readonly conversations: ConversationService,
    private readonly spirits: SpiritService,
    private readonly registry: ActiveSpiritRegistry,
    options: SupervisorServiceOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.turnCapPerSession = options.turnCapPerSession ?? DEFAULT_TURN_CAP_PER_SESSION;
  }

  /**
   * Dispatch a `member.alerted` event. The caller (wakeMember in
   * createApiServices) uses the result kind to decide whether to fall
   * through to the regular run loop:
   *
   *   * `no-active-spirit` → fall through (idle agent, normal wake)
   *   * `debounced`        → DO NOT fall through (suppressed in window)
   *   * `replied`          → DO NOT fall through (supervisor handled it)
   */
  async handleAlert(input: SupervisorAlertInput): Promise<SupervisorDispatchResult> {
    const active = this.registry.getActiveForMember(input.organizationId, input.memberId);
    if (active.length === 0) {
      return { kind: 'no-active-spirit' };
    }
    // The registry returns active spirits newest-first by
    // `registeredAt`. A member can be on multiple sessions; the most
    // recently touched one is the right answer for a fresh
    // @mention/DM. Routing to the oldest spirit would increment the
    // wrong session's supervisor counter and reply against a stale
    // task context.
    const target = active[0];
    if (!target) {
      return { kind: 'no-active-spirit' };
    }

    // Both the debounce window and the mutex are keyed by
    // (org, member, taskSessionId) — NOT by member alone. A member
    // can own live spirits in multiple sessions; collapsing the
    // debounce/mutex by member would silently drop alerts targeting
    // the second session (the audit's flagged regression). Per-
    // session keys give each task its own burst-collapse window
    // and serialisation domain, which is what the supervisor
    // contract actually wants.
    if (this.shouldDebounce(input.organizationId, input.memberId, target.taskSessionId)) {
      // Suppressed by the 2s window for THIS session. The caller
      // MUST treat this as "handled" — falling through to
      // runs.createRun would spawn a duplicate run for the second
      // mention in a chatty burst.
      return { kind: 'debounced' };
    }

    // Stamp the debounce window NOW, synchronously, before the alert
    // is queued behind the mutex. JavaScript is single-threaded so a
    // peer call landing in the next microtask sees this stamp during
    // its own `shouldDebounce` check and is correctly suppressed.
    //
    // The earlier "stamp inside the mutex callback" pattern was racy:
    // a burst of N alerts arriving before the first callback ran
    // would all pass `shouldDebounce` (no stamp yet), all queue, and
    // all execute — exactly the work the debounce is supposed to
    // collapse. Stamping at schedule time fixes that without giving
    // up correctness on the failure path: a stamp is always honoured
    // even if the underlying turn later throws, which matches the
    // "burst-collapse" contract callers actually want.
    this.lastAlertAt.set(
      this.debounceKey(input.organizationId, input.memberId, target.taskSessionId),
      Date.now(),
    );

    const mutexKey = this.mutexKey(input.organizationId, input.memberId, target.taskSessionId);
    const previous = this.mutexes.get(mutexKey) ?? Promise.resolve();
    const next = previous.then(() => this.runSupervisorTurn(target.taskSessionId, input));
    this.mutexes.set(
      mutexKey,
      next.catch(() => undefined).finally(() => {
        if (this.mutexes.get(mutexKey) === next) {
          this.mutexes.delete(mutexKey);
        }
      }),
    );
    const outcome = await next;
    return { kind: 'replied', outcome };
  }

  // ------------------------------------------------------------------
  // internals
  // ------------------------------------------------------------------

  private async runSupervisorTurn(
    taskSessionId: string,
    input: SupervisorAlertInput,
  ): Promise<SupervisorReplyOutcome> {
    const session = this.repo.getTaskSession(input.organizationId, taskSessionId);
    if (!session) {
      // Defensive — if the session vanished mid-flight, fall back instead
      // of throwing so the alert is acknowledged.
      const fallback = this.publishFallback(taskSessionId, input, 'Task session not found');
      return { taskSessionId, message: fallback, fallback: true, reason: 'session-missing' };
    }

    if (session.supervisorTurnCount >= this.turnCapPerSession) {
      const fallback = this.publishCapMessage(taskSessionId, input);
      return { taskSessionId, message: fallback, fallback: true, reason: 'cap-reached' };
    }

    const sourceContext = this.buildAlertContext(input);

    try {
      const outcome = await this.spirits.run({
        organizationId: input.organizationId,
        taskSessionId,
        memberId: input.memberId,
        role: 'supervisor',
        // Supervisors run a single quick turn — no multi-step recursion.
        maxIterations: 2,
        extraPrompt: sourceContext,
      });

      // Increment the supervisor turn counter on the session row.
      this.repo.saveTaskSession({
        ...session,
        supervisorTurnCount: session.supervisorTurnCount + 1,
        updatedAt: new Date().toISOString(),
      });

      const replyText =
        outcome.finalText.trim() ||
        `Currently on step ${session.status} of #${session.slug}.`;
      const message = this.publishSupervisorReply(taskSessionId, input, replyText, false);
      return { taskSessionId, message, fallback: false, reason: 'ok' };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const message = this.publishFallback(taskSessionId, input, reason);
      return { taskSessionId, message, fallback: true, reason };
    }
  }

  private buildAlertContext(input: SupervisorAlertInput): string {
    const sourceMessage = this.repo.getMessage(input.organizationId, input.messageId);
    const body = sourceMessage?.content ?? '';
    return [
      'You are answering a quick supervisor question — give a one-paragraph status update.',
      '',
      `Reason: ${input.reason}`,
      `From: ${input.byMemberId}`,
      sourceMessage ? `In channel: ${sourceMessage.channelId ?? 'dm'}` : '',
      body ? `Question: ${body}` : '',
    ]
      .filter((line) => line.length > 0)
      .join('\n');
  }

  private publishSupervisorReply(
    taskSessionId: string,
    input: SupervisorAlertInput,
    body: string,
    fallback: boolean,
  ): Message {
    const sourceMessage = this.repo.getMessage(input.organizationId, input.messageId);
    const channelId = sourceMessage?.channelId ?? input.channelId;
    if (!channelId) {
      // No channel to post into — fall back to a self-note so the
      // worker context still reflects the question.
      return this.conversations.sendSelfNote({
        organizationId: input.organizationId,
        memberId: input.memberId,
        body,
      });
    }
    const message = MessageSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      threadId: sourceMessage?.threadId ?? input.threadId,
      channelId,
      parentMessageId: sourceMessage?.id,
      senderId: input.memberId,
      senderKind: 'agent',
      kind: 'agent',
      content: body,
      createdAt: new Date().toISOString(),
    });
    this.conversations.publishMessage(message, []);

    this.realtime.emit(
      SocketEventNames.supervisorReplied,
      {
        organizationId: input.organizationId,
        taskSessionId,
        memberId: input.memberId,
        message,
        reason: fallback ? 'fallback' : input.reason,
      },
      [orgRoom(input.organizationId), channelRoom(channelId), memberRoom(input.memberId)],
    );
    return message;
  }

  private publishFallback(
    taskSessionId: string,
    input: SupervisorAlertInput,
    reason: string,
  ): Message {
    const session = this.repo.getTaskSession(input.organizationId, taskSessionId);
    const slug = session?.slug ?? taskSessionId;
    const summary = session?.summary?.trim() || (session ? `step ${session.status}` : 'in progress');
    const body = `Currently on ${summary} of #${slug}. Full activity in #${slug}. (supervisor fallback: ${reason})`;
    return this.publishSupervisorReply(taskSessionId, input, body, true);
  }

  private publishCapMessage(taskSessionId: string, input: SupervisorAlertInput): Message {
    const session = this.repo.getTaskSession(input.organizationId, taskSessionId);
    const slug = session?.slug ?? taskSessionId;
    const body = `Supervisor turn cap reached for #${slug} (${this.turnCapPerSession} turns). Full activity in #${slug}.`;
    return this.publishSupervisorReply(taskSessionId, input, body, true);
  }

  private mutexKey(organizationId: string, memberId: string, taskSessionId: string): string {
    return `${organizationId}:${memberId}:${taskSessionId}:supervisor`;
  }

  private debounceKey(organizationId: string, memberId: string, taskSessionId: string): string {
    return `${organizationId}:${memberId}:${taskSessionId}`;
  }

  private shouldDebounce(organizationId: string, memberId: string, taskSessionId: string): boolean {
    const last = this.lastAlertAt.get(this.debounceKey(organizationId, memberId, taskSessionId));
    if (last === undefined) return false;
    return Date.now() - last < this.debounceMs;
  }
}
