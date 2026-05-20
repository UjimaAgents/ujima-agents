import { randomUUID } from 'node:crypto';
import {
  MessageSchema,
  SocketEventNames,
  TodoSchema,
  type Channel,
  type Message,
  type TaskSession,
  type Todo,
  orgRoom,
  channelRoom,
  threadRoom,
  memberRoom,
} from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import type { ConversationService } from './conversation.js';
import type { RealtimeService } from './context.js';
import { AGENT_KIND } from '@ujima/shared';

/**
 * Bet 4 — durable commitment service.
 *
 * Three responsibilities:
 *
 * 1. **Commitment extraction.** When an agent publishes a message that
 *    contains a forward-looking commitment ("I'll draft", "I will run",
 *    "starting now"), persist a `todos` row with the deliverable, owner,
 *    channel, source message, and an idle deadline. The chat promise
 *    now has a durable home that survives the run terminating.
 *
 * 2. **Idle re-wake.** A periodic tick scans `todos` for commitments
 *    where `last_progress_at` is older than the idle threshold. The
 *    owner is woken with `wakeReason='self-followup'` — mandatory-reply
 *    is OFF for this reason, so the agent can deliver, declare a
 *    blocker via `supervisor.todo.update`, or `channel.pass`.
 *
 * 3. **Deadline-letter.** When a commitment's `due_at` elapses without
 *    a status flip to `completed`, the service posts a system message
 *    in the channel (`@owner missed deadline on '<deliverable>'`) and
 *    flips status to `expired`. The human sees the miss instead of
 *    silence.
 *
 * The extractor is lexical, not LLM-mediated — adding another LLM call
 * to detect a chat promise would compound cost and latency. Patterns
 * are tuned conservatively: missed commitments will fire later (when
 * the human notices); false positives produce one `todos` row that can
 * be resolved with `supervisor.todo.update`.
 */

const COMMITMENT_PATTERNS: RegExp[] = [
  // Future tense first-person ("I'll draft", "I will deliver",
  // "I am going to write", "I'm going to set up").
  /\bi(?:'ll| will| am going to| am about to|'m going to|'m about to)\s+(\w[\w\s-]{2,80}?)(?:[.,!?\n]|$)/i,
  // Active commitment ("Starting now on X", "Beginning work on X").
  /\b(?:starting|beginning|kicking off)\s+(?:now\s+)?(?:on|with)\s+(\w[\w\s-]{2,80}?)(?:[.,!?\n]|$)/i,
  // "Drafting / writing / preparing X now" — present-progressive
  // promises of imminent output.
  /\b(?:drafting|writing|preparing|building|setting up|implementing)\s+(\w[\w\s-]{2,80}?)(?:\s+now)?(?:[.,!?\n]|$)/i,
];

// Reject "verb-but-not-a-commitment" patterns. Pure acks
// ("I'll await", "I will wait", "I'll let you know"), meta-talk
// ("I'll be brief", "I'll say this", "I'll note that"), and
// endorsement ("I'll second / agree / acknowledge") all match a
// commitment-shaped regex but commit to NO deliverable.
const NEGATIVE_COMMITMENT_PATTERNS: RegExp[] = [
  /\bi(?:'ll| will)\s+(?:await|wait|continue to (?:await|wait)|stand by)\b/i,
  /\bi(?:'ll| will)\s+let you know\b/i,
  /\bi(?:'ll| will)\s+be\s+(?:brief|quick|short|right (?:back|there)|out)\b/i,
  /\bi(?:'ll| will)\s+(?:say|note|mention|add|point out|emphasize|stress)\s+(?:that|this)?\b/i,
  /\bi(?:'ll| will)\s+(?:second|agree|acknowledge|endorse|support|concur)\b/i,
  /\bi(?:'ll| will)\s+(?:think|consider|reflect|ponder|review)\s+(?:about|on|over)\b/i,
];

// Words a "deliverable" should NOT be just by itself — these are
// adjectives/qualifiers, not nouns. The captured deliverable text
// must contain at least one token NOT in this set, of length ≥ 4,
// so "be brief" / "be quick" don't produce todos titled "brief".
const NON_NOUN_TOKENS = new Set([
  'brief', 'quick', 'short', 'sure', 'fine', 'okay', 'right',
  'that', 'this', 'these', 'those', 'something', 'anything',
  'everything', 'nothing', 'much', 'more', 'less', 'better',
  'happy', 'glad', 'ready', 'available', 'around',
]);

function containsNounIshToken(text: string): boolean {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4);
  return tokens.some((token) => !NON_NOUN_TOKENS.has(token));
}

export interface ExtractedCommitment {
  deliverableSummary: string;
  rawMatch: string;
}

export function extractCommitment(body: string): ExtractedCommitment | null {
  if (!body) return null;
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > 2000) return null;
  // Reject when the WHOLE message is a quote — pasted Slack archives
  // and replies that quote upstream commitments would otherwise fire
  // the extractor on historical text.
  const nonQuotedLines = trimmed
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('>') && !line.startsWith('|'));
  if (nonQuotedLines.length === 0) return null;
  // Reject when the body is entirely inside a code fence.
  const fenceCount = (trimmed.match(/```/g) ?? []).length;
  if (fenceCount >= 2 && trimmed.startsWith('```') && trimmed.endsWith('```')) {
    return null;
  }
  for (const negativePattern of NEGATIVE_COMMITMENT_PATTERNS) {
    if (negativePattern.test(trimmed)) return null;
  }
  for (const pattern of COMMITMENT_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match && typeof match[1] === 'string') {
      const captured = match[1].trim();
      if (captured.length < 3) continue;
      // Require a noun-ish token in the captured deliverable so
      // "I'll be brief" / "I'll be quick" don't produce a todo
      // titled "be brief".
      if (!containsNounIshToken(captured)) continue;
      return {
        deliverableSummary: captured,
        rawMatch: match[0].trim(),
      };
    }
  }
  return null;
}

export interface CommitmentServiceOptions {
  /**
   * How long a commitment can sit at `last_progress_at` before the
   * scheduler re-wakes the owner. Defaults to 10 minutes; in
   * production this should be tuned to the team's working cadence.
   */
  idleThresholdMs?: number;
  /**
   * Default due-at offset when the extractor doesn't see an explicit
   * deadline. Defaults to 24 hours.
   */
  defaultDueOffsetMs?: number;
}

export class CommitmentService {
  private readonly idleThresholdMs: number;
  private readonly defaultDueOffsetMs: number;

  constructor(
    private readonly repo: ApiRepository,
    private readonly conversations: ConversationService,
    private readonly realtime: RealtimeService,
    private readonly wakeOwner: (input: {
      organizationId: string;
      memberId: string;
      channelId: string;
      threadId: string;
      messageId: string;
      reason: string;
      wakeReason: 'self-followup';
      byMemberId: string;
    }) => Promise<void> | void,
    options: CommitmentServiceOptions = {},
  ) {
    this.idleThresholdMs = options.idleThresholdMs ?? 10 * 60 * 1000;
    this.defaultDueOffsetMs = options.defaultDueOffsetMs ?? 24 * 60 * 60 * 1000;
  }

  /**
   * Inspect an agent-authored message that was just published. If it
   * contains a commitment, create the todo row and emit the
   * `commitment:created` event. Best-effort — failures are swallowed
   * to keep the publish hot-path resilient.
   */
  async onAgentMessagePublished(message: Message): Promise<void> {
    try {
      if (message.senderKind !== AGENT_KIND) return;
      if (message.kind === 'system') return;
      if (!message.channelId || !message.threadId) return;
      // Skip retired or missing senders — a delayed publish from a
      // sender that has since been retired would otherwise open a
      // commitment that the sweeper can never fulfill (createRun
      // fails on retired agents) and would cycle forever.
      const sender = this.repo.getMember(message.organizationId, message.senderId);
      if (!sender || sender.retiredAt) return;
      const extracted = extractCommitment(message.content);
      if (!extracted) return;
      const channel = this.repo.getChannel(message.organizationId, message.channelId);
      if (!channel) return;
      // Don't open commitments on private self-channels (workspace
      // notes) or empty-roster channels.
      if (channel.kind === 'self') return;

      const taskSession = this.ensureTaskSession(message, channel);
      const now = new Date().toISOString();
      const dueAt = new Date(Date.now() + this.defaultDueOffsetMs).toISOString();
      const todo: Todo = TodoSchema.parse({
        id: randomUUID(),
        organizationId: message.organizationId,
        taskSessionId: taskSession?.id,
        runId: undefined,
        memberId: message.senderId,
        title: extracted.deliverableSummary.slice(0, 120),
        status: 'in_progress',
        notes: extracted.rawMatch,
        channelId: message.channelId,
        sourceMessageId: message.id,
        deliverableSummary: extracted.deliverableSummary,
        dueAt,
        lastProgressAt: now,
        createdAt: now,
        updatedAt: now,
      });
      this.repo.saveTodo(todo);
      this.realtime.emit(
        SocketEventNames.commitmentCreated,
        this.toEventPayload(todo, 'created'),
        this.roomsFor(todo, channel),
      );
    } catch {
      // Best-effort — never let an extractor failure poison the publish path.
    }
  }

  /**
   * Idle sweep — re-wake owners whose commitments haven't moved.
   * Caller drives this via setInterval; the service is responsible
   * for the underlying queries and the wake call.
   *
   * Uses claim-by-update (`repo.claimIdleCommitment`) before firing
   * the wake so two overlapping sweeps, a daemon restart mid-sweep,
   * or a concurrent human update via `supervisor.todo.update` don't
   * cause the same commitment to wake twice. A retired/missing
   * owner row gets cancelled instead of cycled forever.
   */
  async sweepIdle(): Promise<number> {
    if (!this.repo.listIdleCommitments) return 0;
    const idleSince = new Date(Date.now() - this.idleThresholdMs).toISOString();
    const candidates = this.repo.listIdleCommitments({
      idleSinceIso: idleSince,
      statuses: ['pending', 'in_progress'],
      limit: 25,
    });
    let woken = 0;
    for (const todo of candidates) {
      if (!todo.channelId) continue;
      const channel = this.repo.getChannel(todo.organizationId, todo.channelId);
      if (!channel) continue;
      // Skip retired or missing owners — re-waking them runs into
      // `createRun` failing with `Agent retired:` and the todo
      // cycles forever. Cancel it so the rail and metrics stop
      // pretending the work is live.
      const owner = this.repo.getMember(todo.organizationId, todo.memberId);
      if (!owner || owner.retiredAt) {
        const cancelled = TodoSchema.parse({
          ...todo,
          status: 'cancelled',
          updatedAt: new Date().toISOString(),
        });
        this.repo.saveTodo(cancelled);
        this.realtime.emit(
          SocketEventNames.commitmentUpdated,
          this.toEventPayload(cancelled, 'updated'),
          this.roomsFor(cancelled, channel),
        );
        continue;
      }
      // Claim-by-update — only one sweep / restart can win this row.
      const now = new Date().toISOString();
      const claimed = this.repo.claimIdleCommitment?.(
        todo.id,
        todo.lastProgressAt ?? null,
        now,
      );
      if (claimed === false) continue;
      const sourceMessage = todo.sourceMessageId
        ? this.repo.getMessage(todo.organizationId, todo.sourceMessageId)
        : null;
      const threadId = sourceMessage?.threadId ?? todo.channelId;
      try {
        await this.wakeOwner({
          organizationId: todo.organizationId,
          memberId: todo.memberId,
          channelId: todo.channelId,
          threadId,
          messageId: todo.sourceMessageId ?? todo.id,
          reason: 'self-followup',
          wakeReason: 'self-followup',
          byMemberId: todo.memberId,
        });
        const updated: Todo = TodoSchema.parse({
          ...todo,
          lastProgressAt: now,
          updatedAt: now,
        });
        this.realtime.emit(
          SocketEventNames.commitmentUpdated,
          this.toEventPayload(updated, 'updated'),
          this.roomsFor(updated, channel),
        );
        woken += 1;
      } catch {
        // Swallow per-commitment failures so a bad row doesn't
        // bring down the whole sweep. The row's `lastProgressAt`
        // was already advanced by the claim — so it'll be eligible
        // again only after `idleThresholdMs` instead of immediately
        // re-firing on the next tick.
      }
    }
    return woken;
  }

  /**
   * Deadline-letter sweep — flip expired commitments to `expired` and
   * post a system message in the channel. Caller drives this via
   * setInterval (typically same tick as `sweepIdle`).
   */
  async sweepExpired(): Promise<number> {
    if (!this.repo.listExpiredCommitments) return 0;
    const now = new Date().toISOString();
    const candidates = this.repo.listExpiredCommitments({ nowIso: now, limit: 25 });
    let posted = 0;
    for (const todo of candidates) {
      if (!todo.channelId) continue;
      const channel = this.repo.getChannel(todo.organizationId, todo.channelId);
      if (!channel) continue;
      const owner = this.repo.getMember(todo.organizationId, todo.memberId);
      const ownerName = owner?.name ?? todo.memberId;
      const message = MessageSchema.parse({
        id: randomUUID(),
        organizationId: todo.organizationId,
        threadId: todo.channelId,
        channelId: todo.channelId,
        senderId: 'system',
        senderKind: 'human',
        kind: 'system',
        content: `Deadline missed: @${ownerName} did not deliver "${todo.deliverableSummary ?? todo.title}" by ${todo.dueAt}. Marking commitment expired — please follow up.`,
        createdAt: now,
      });
      try {
        this.conversations.publishMessage(message, [], undefined, {
          skipMentionResolution: true,
        });
      } catch {
        // best-effort
      }
      const expired: Todo = TodoSchema.parse({
        ...todo,
        status: 'expired',
        updatedAt: now,
      });
      this.repo.saveTodo(expired);
      this.realtime.emit(
        SocketEventNames.commitmentExpired,
        this.toEventPayload(expired, 'expired'),
        this.roomsFor(expired, channel),
      );
      posted += 1;
    }
    return posted;
  }

  /**
   * Auto-promote: if the channel already has a `queued`/`running`
   * task session, attach the todo there. Otherwise create a
   * lightweight session so the goals rail has something to render.
   * The session's `requestedBy` is set to the agent itself (the
   * committer), `executionMode='concurrent'` (the default).
   */
  private ensureTaskSession(message: Message, channel: Channel): TaskSession | null {
    if (!this.repo.findOpenTaskSessionForChannel) return null;
    const existing = this.repo.findOpenTaskSessionForChannel(
      message.organizationId,
      channel.id,
    );
    if (existing) return existing;
    const now = new Date().toISOString();
    const slug = `chan-${channel.id.slice(0, 6)}-${Date.now().toString(36)}`;
    try {
      return this.repo.saveTaskSession({
        id: randomUUID(),
        organizationId: message.organizationId,
        slug,
        channelId: channel.id,
        requestedBy: message.senderId,
        executionMode: 'concurrent',
        status: 'running',
        prompt: '',
        summary: 'Auto-promoted from in-channel commitment',
        teamMemberIds: channel.memberIds,
        origin: { messageId: message.id, threadId: message.threadId, channelId: channel.id },
        promotionMetadata: {},
        supervisorTurnCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      return null;
    }
  }

  private toEventPayload(todo: Todo, _event: 'created' | 'updated' | 'expired') {
    return {
      organizationId: todo.organizationId,
      channelId: todo.channelId,
      threadId: todo.channelId,
      todoId: todo.id,
      taskSessionId: todo.taskSessionId,
      ownerMemberId: todo.memberId,
      deliverable: todo.deliverableSummary ?? todo.title,
      status: todo.status,
      dueAt: todo.dueAt,
      occurredAt: new Date().toISOString(),
    };
  }

  private roomsFor(todo: Todo, channel: Channel): string[] {
    return [
      orgRoom(todo.organizationId),
      memberRoom(todo.memberId),
      ...(todo.channelId ? [channelRoom(todo.channelId)] : []),
      ...(todo.channelId ? [threadRoom(todo.channelId)] : []),
      ...(channel.id ? [channelRoom(channel.id)] : []),
    ];
  }
}
