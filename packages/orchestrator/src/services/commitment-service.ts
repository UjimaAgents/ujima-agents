import { randomUUID } from 'node:crypto';
import {
  MessageSchema,
  SocketEventNames,
  TodoSchema,
  type Channel,
  type Message,
  type RunState,
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
 * Terminators that mean "the owner published concrete progress" for
 * the purposes of resetting the empty-wake counter. `channel.handoff`
 * counts as progress because handing off to another member is itself
 * forward motion on the deliverable.
 */
const PUBLISHING_TERMINATORS = new Set([
  'channel.reply',
  'channel.post',
  'channel.dm',
  'channel.handoff',
  'message',
]);

/**
 * Terminators that mean "the owner explicitly declared they have
 * nothing to publish this turn" — `channel.pass` with a real reason.
 * Counted as a non-empty acknowledgement: the agent didn't drop the
 * ball, it just doesn't have new content yet. We don't increment the
 * empty-wake counter, but we don't reset it either.
 */
const ACKNOWLEDGED_TERMINATORS = new Set(['channel.pass', 'channel.ack']);

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
  // Active commitment ("Starting now on X", "Beginning work on X",
  // "Kicking off the refactor"). The optional `work\s+` between the
  // verb and the connector is what catches "beginning work on X".
  /\b(?:starting|beginning|kicking off)\s+(?:work\s+)?(?:now\s+)?(?:on|with|the)\s+(\w[\w\s-]{2,80}?)(?:[.,!?\n]|$)/i,
  // "Drafting / writing / preparing X now" — present-progressive
  // promises of imminent output.
  /\b(?:drafting|writing|preparing|building|setting up|implementing)\s+(\w[\w\s-]{2,80}?)(?:\s+now)?(?:[.,!?\n]|$)/i,
];

// Past-tense completion detection — split into two predicates:
//
//  1. `COMPLETION_VERB_PATTERN` is the SIGNAL — "I have created /
//     drafted / written / saved …". When present, the body is a
//     delivery announcement, not a future commitment.
//  2. `PATH_TOKEN_PATTERN` extracts the artifact path independently
//     of the connector word. Earlier iterations of this code required
//     the path to follow a small allowlist of prepositions ("to" /
//     "at" / "in" / "on") which missed real-world deliveries phrased
//     as "review it here: `<path>`" or "See `<path>`". Decoupling the
//     verb from the path connector catches those without leaking
//     false positives — the body still has to contain a completion
//     verb at sentence start to be considered.
//
// Path token rules:
//   - Must contain `/` (so we don't grab "Phoebe.Parker") OR end with
//     a recognised file extension allowlist.
//   - HTTPS URLs and absolute system paths (other than /tmp/*) are
//     filtered downstream; they're not workspace artifacts.
const COMPLETION_VERB_PATTERN =
  /\bi(?:'ve| have| just)?\s+(?:drafted|written|wrote|created|prepared|built|set up|implemented|finished|completed|delivered|published|posted|compiled|saved|stored|uploaded)\b/i;
const BARE_COMPLETION_PATTERN =
  /\b(?:saved|stored|available|uploaded|wrote|delivered|posted)\s+(?:to|at|in|on|here)\b/i;
const KNOWN_FILE_EXTENSIONS = new Set([
  'md', 'mdx', 'txt', 'json', 'jsonc', 'ts', 'tsx', 'js', 'jsx',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'yaml', 'yml', 'toml', 'ini', 'env',
  'html', 'css', 'scss', 'less',
  'sh', 'bash', 'zsh', 'fish',
  'pdf', 'csv', 'tsv', 'xlsx',
  'sql',
]);
const PATH_TOKEN_PATTERN = /`?(\/?[A-Za-z0-9_][A-Za-z0-9_./-]*\.[A-Za-z0-9]{1,6})`?/g;

function findArtifactPath(body: string): string | null {
  // Two-stage: verb signal OR bare-completion shape ("Saved to X").
  if (!COMPLETION_VERB_PATTERN.test(body) && !BARE_COMPLETION_PATTERN.test(body)) {
    return null;
  }
  // Scan for the FIRST workspace-relative path-shaped token.
  PATH_TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATH_TOKEN_PATTERN.exec(body)) !== null) {
    const candidate = match[1];
    if (!candidate || candidate.length < 3) continue;
    // Absolute system paths are out of scope (sensitive root scan),
    // unless under /tmp/* which is the agreed sandbox.
    if (candidate.startsWith('/') && !candidate.startsWith('/tmp/')) continue;
    // URLs aren't artifacts.
    if (/^https?:\/\//i.test(candidate)) continue;
    // Must contain a slash (workspace path) OR end with a known
    // file extension. Without this guard a sentence-ending "Phoebe
    // Parker." or "Settings." trivially matches `.<extension>`.
    const ext = candidate.split('.').pop()?.toLowerCase() ?? '';
    const hasSlash = candidate.includes('/');
    if (!hasSlash && !KNOWN_FILE_EXTENSIONS.has(ext)) continue;
    return candidate;
  }
  return null;
}

// In-channel artifact delivery — past-tense completion *without* a
// file path. Surfaces when the agent pastes the deliverable inline
// instead of writing it to disk ("I have compiled the documentation
// for X. Here is the task list: …"). These don't create their own
// `completed` todo (there's no path to put on the rail), but they
// DO resolve any matching open commitment for the same (channel,
// member) — closing the loop so the rail stops showing the stale
// "in progress" entry.
const IN_CHANNEL_DELIVERY_PATTERNS: RegExp[] = [
  /\bi(?:'ve| have| just)?\s+(?:compiled|drafted|written|created|prepared|built|implemented|finished|completed|delivered|posted)\b/i,
  /\b(?:here is|here's|below is|attached is|attached are|below are|here are)\s+(?:the|my|your|our)\s+\w/i,
];

function looksLikeInChannelDelivery(body: string): boolean {
  if (!body) return false;
  const trimmed = body.trim();
  // Substantive bodies only — a 10-word "I have compiled" with no
  // payload doesn't deliver anything.
  if (trimmed.length < 120) return false;
  for (const pattern of IN_CHANNEL_DELIVERY_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

/**
 * Word-overlap match between a candidate body and an open
 * commitment's deliverable summary. ≥4-char tokens, lowercased,
 * stopword-tolerant. Used to decide whether an in-channel delivery
 * shaped message ("Here is the task list…") refers to the same
 * deliverable as an existing open commitment.
 *
 * Threshold default 0.3 — generous because deliverable titles are
 * extracted from sometimes-noisy first-person sentences and the
 * follow-up message that delivers the artifact may use slightly
 * different vocabulary ("development task list" vs "task list").
 */
function deliverableOverlap(body: string, deliverable: string): number {
  const tokenize = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 4),
    );
  const bodyTokens = tokenize(body);
  const deliverableTokens = tokenize(deliverable);
  if (deliverableTokens.size === 0) return 0;
  let hits = 0;
  for (const t of deliverableTokens) if (bodyTokens.has(t)) hits += 1;
  return hits / deliverableTokens.size;
}

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
  // Default minimum length is 4. Short uppercase acronyms (BRD, PRD,
  // API, MVP, RFC, KPI) are legitimate nouns — keep them by special-
  // casing length-3 ALL-CAPS tokens before lowercasing. Without this,
  // "Drafting the BRD now" would have only stopwords + a 3-char
  // acronym left after filtering and would (incorrectly) be rejected.
  const rawTokens = text
    .replace(/[^A-Za-z0-9_\-\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);
  for (const raw of rawTokens) {
    const lower = raw.toLowerCase();
    const isShortAcronym = raw.length === 3 && raw === raw.toUpperCase();
    if (raw.length < 4 && !isShortAcronym) continue;
    if (NON_NOUN_TOKENS.has(lower)) continue;
    return true;
  }
  return false;
}

export interface ExtractedCommitment {
  deliverableSummary: string;
  rawMatch: string;
}

export interface ExtractedCompletion {
  deliverableSummary: string;
  artifactPath: string;
}

/**
 * Extract a past-tense completion announcement with a file path
 * ("I have drafted the BRD and saved it to `ai/memory-bank/site-
 * setup.md`"). Returns the path as the deliverable summary so the
 * goals rail shows what was actually produced — not just what was
 * promised. Without this, agents that go straight to producing
 * work (no "I'll draft X" announcement first) leave no trace on
 * the rail.
 */
export function extractCompletion(body: string): ExtractedCompletion | null {
  if (!body) return null;
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > 4000) return null;
  // Skip wholly-quoted bodies (replies that quote upstream work).
  const nonQuotedLines = trimmed
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('>') && !line.startsWith('|'));
  if (nonQuotedLines.length === 0) return null;
  const artifactPath = findArtifactPath(trimmed);
  if (!artifactPath) return null;
  return { deliverableSummary: artifactPath, artifactPath };
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
  /**
   * Lookback window for commitment dedup. When the extractor sees a
   * commitment on a `(channel, member)` pair and there is already an
   * open commitment for that pair created within this window, the new
   * message updates the existing row's `last_progress_at` and
   * `source_message_id` instead of inserting a duplicate. Defaults to
   * 5 minutes — Layla/Phoebe ping-pong loops were creating 3+
   * identical commitments inside 2-minute windows.
   */
  dedupWindowMs?: number;
  /**
   * Maximum number of consecutive empty self-followup wakes before
   * the service short-circuits `due_at` to fire the deadline-letter
   * early. Defaults to 3 — a generous heads-up before declaring the
   * commitment stuck, but firm enough that 24h doesn't silently
   * elapse. An "empty" wake is one whose run completed without any
   * publishing terminator (see {@link PUBLISHING_TERMINATORS}).
   */
  maxEmptyWakes?: number;
}

export class CommitmentService {
  private readonly idleThresholdMs: number;
  private readonly defaultDueOffsetMs: number;
  private readonly dedupWindowMs: number;
  private readonly maxEmptyWakes: number;

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
    this.dedupWindowMs = options.dedupWindowMs ?? 5 * 60 * 1000;
    this.maxEmptyWakes = options.maxEmptyWakes ?? 3;
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
      // Try future-tense commitment first; fall back to past-tense
      // completion so delivered work (Layla announcing "I have
      // drafted X to /path") still lands on the rail even when no
      // commitment was announced beforehand.
      const futureCommitment = extractCommitment(message.content);
      const completion = futureCommitment ? null : extractCompletion(message.content);
      const inChannelDelivery =
        !futureCommitment && !completion && looksLikeInChannelDelivery(message.content);
      if (!futureCommitment && !completion && !inChannelDelivery) return;
      const channel = this.repo.getChannel(message.organizationId, message.channelId);
      if (!channel) return;
      // Don't open commitments on private self-channels (workspace
      // notes) or empty-roster channels.
      if (channel.kind === 'self') return;

      // Delivery resolution — both path-bearing completions and
      // in-channel inline deliveries should close the matching open
      // commitment for the same `(channel, member)` pair instead of
      // leaving a stale "in progress" row alongside the delivered
      // artifact. Path-bearing variants additionally upgrade the
      // closed row's `deliverableSummary` to the artifact path so the
      // rail shows the file the human can open; in-channel variants
      // just close the row (there's no path to surface).
      const deliverySignal = completion ?? (inChannelDelivery ? 'inline' : null);
      if (deliverySignal && this.repo.findOpenChannelCommitmentForMember) {
        const since = '1970-01-01T00:00:00.000Z';
        const open = this.repo.findOpenChannelCommitmentForMember(
          message.organizationId,
          message.channelId,
          message.senderId,
          since,
        );
        if (open) {
          // Decide overlap target. For path-bearing completion the
          // *path filename* against the commitment deliverable; for
          // inline delivery the *full message body* against the
          // deliverable. Path-bearing has a stricter signal (same
          // agent, same channel, fresh artifact) so the threshold is
          // looser; inline delivery needs more vocabulary overlap.
          const target =
            completion?.artifactPath
              ? completion.artifactPath.replace(/^.*\//, '').replace(/\.\w+$/, '')
              : message.content;
          const overlap = deliverableOverlap(target, open.deliverableSummary ?? open.title);
          const overlapThreshold = completion ? 0.2 : 0.3;
          if (overlap >= overlapThreshold || completion) {
            // For completions we always close (path-bearing delivery
            // in the same channel by the same agent is a near-certain
            // resolution); for inline we require token overlap so
            // unrelated substantive posts don't accidentally close a
            // commitment.
            const now = new Date().toISOString();
            const closed: Todo = TodoSchema.parse({
              ...open,
              status: 'completed',
              deliverableSummary: completion?.artifactPath ?? open.deliverableSummary,
              notes: completion?.artifactPath ?? open.notes,
              sourceMessageId: message.id,
              lastProgressAt: now,
              updatedAt: now,
            });
            this.repo.saveTodo(closed);
            this.realtime.emit(
              SocketEventNames.commitmentUpdated,
              this.toEventPayload(closed, 'updated'),
              this.roomsFor(closed, channel),
            );
            // For path-bearing completion we still fall through to
            // create the standalone completed row (so the rail shows
            // the delivered artifact even if the open commitment had
            // unrelated wording). For inline delivery there's nothing
            // more to do.
            if (!completion) return;
          }
        }
        // Inline delivery with no matching open commitment — nothing
        // to do, no row to create.
        if (!completion) return;
      }

      const taskSession = this.ensureTaskSession(message, channel);
      const now = new Date().toISOString();
      const isCompletion = completion !== null;
      const dueAt = isCompletion
        ? undefined
        : new Date(Date.now() + this.defaultDueOffsetMs).toISOString();
      const deliverable =
        futureCommitment?.deliverableSummary ?? completion?.deliverableSummary ?? '';
      const notes = futureCommitment?.rawMatch ?? completion?.artifactPath ?? '';

      // Dedup — when the same agent restates an open commitment in
      // the same channel within `dedupWindowMs`, update the existing
      // row instead of creating a parallel one. Past-tense completions
      // bypass dedup so a delivered artifact always lands as its own
      // `completed` row on the rail. Without this, Phoebe↔Layla mirror
      // loops produce 3+ identical "I will proceed…" todos that each
      // trigger an independent self-followup wake cycle.
      if (!isCompletion && this.repo.findOpenChannelCommitmentForMember) {
        const since = new Date(Date.now() - this.dedupWindowMs).toISOString();
        const existing = this.repo.findOpenChannelCommitmentForMember(
          message.organizationId,
          message.channelId,
          message.senderId,
          since,
        );
        if (existing) {
          const refreshed: Todo = TodoSchema.parse({
            ...existing,
            // Roll forward to the newest message so re-wakes target
            // the most recent context, and the goals rail surfaces
            // the most recent restatement.
            sourceMessageId: message.id,
            deliverableSummary:
              existing.deliverableSummary && existing.deliverableSummary.length >= deliverable.length
                ? existing.deliverableSummary
                : deliverable,
            notes: existing.notes || notes,
            // Restating the commitment counts as a soft "still
            // working" signal — push lastProgressAt forward so the
            // sweeper doesn't immediately re-wake.
            lastProgressAt: now,
            updatedAt: now,
          });
          this.repo.saveTodo(refreshed);
          this.realtime.emit(
            SocketEventNames.commitmentUpdated,
            this.toEventPayload(refreshed, 'updated'),
            this.roomsFor(refreshed, channel),
          );
          return;
        }
      }

      const todo: Todo = TodoSchema.parse({
        id: randomUUID(),
        organizationId: message.organizationId,
        taskSessionId: taskSession?.id,
        runId: undefined,
        memberId: message.senderId,
        title: deliverable.slice(0, 120),
        // Past-tense completions land directly as `completed` so the
        // rail can show them as delivered (and the sweeper won't
        // re-wake the owner). Future-tense commitments start as
        // `in_progress`.
        status: isCompletion ? 'completed' : 'in_progress',
        notes,
        channelId: message.channelId,
        sourceMessageId: message.id,
        deliverableSummary: deliverable,
        dueAt,
        lastProgressAt: now,
        emptyWakeCount: 0,
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
   * Post-run hook fired when a wake completes. Late-bound by
   * `services/index.ts` via `SpiritService.setRunCompletedHook`.
   *
   * Two responsibilities:
   *
   *  1. **Empty-wake counter.** For `wakeReason === 'self-followup'`,
   *     classify the run's terminating tool. Publishing terminators
   *     (`channel.reply` / `channel.post` / `channel.dm` /
   *     `channel.handoff`) reset the counter — the owner did the
   *     work. Acknowledged terminators (`channel.pass` /
   *     `channel.ack`) leave the counter unchanged. Anything else
   *     (`NULL`, `self.note` only, etc.) increments it.
   *
   *  2. **Early deadline-letter escalation.** When the counter
   *     reaches `maxEmptyWakes`, the commitment is "stuck" — the
   *     owner has woken N times without publishing or even
   *     acknowledging. We short-circuit `due_at` to fire the
   *     deadline-letter on the next `sweepExpired` tick, instead of
   *     waiting the full 24h. The user sees the stall surface as a
   *     system message in the channel.
   *
   * Failures are swallowed — a flaky hook must never poison run
   * completion.
   */
  async onRunCompleted(run: RunState): Promise<void> {
    try {
      if (run.status !== 'completed') return;
      if (run.wakeReason !== 'self-followup') return;
      if (!run.sourceMessageId) return;
      if (!this.repo.findCommitmentBySourceMessage) return;

      const todo = this.repo.findCommitmentBySourceMessage(
        run.organizationId,
        run.sourceMessageId,
      );
      if (!todo) return;
      // Already-resolved todos shouldn't be touched — the owner
      // closed the work via `supervisor.todo.update` or the past-
      // tense extractor fired.
      if (todo.status !== 'pending' && todo.status !== 'in_progress') return;

      const terminator = run.terminatingTool ?? null;
      const now = new Date().toISOString();

      if (terminator && PUBLISHING_TERMINATORS.has(terminator)) {
        // Real progress. Reset the counter.
        if (todo.emptyWakeCount === 0) return;
        const cleared: Todo = TodoSchema.parse({
          ...todo,
          emptyWakeCount: 0,
          lastProgressAt: now,
          updatedAt: now,
        });
        this.repo.saveTodo(cleared);
        return;
      }

      if (terminator && ACKNOWLEDGED_TERMINATORS.has(terminator)) {
        // The owner explicitly acknowledged the wake with a pass /
        // ack. Don't reward (no counter reset) but don't escalate
        // either — they answered the door, just didn't deliver yet.
        return;
      }

      // Empty wake. Increment counter; escalate if past the
      // threshold.
      const nextCount = todo.emptyWakeCount + 1;
      const shouldEscalate = nextCount >= this.maxEmptyWakes;
      const updated: Todo = TodoSchema.parse({
        ...todo,
        emptyWakeCount: nextCount,
        // Short-circuit due_at so sweepExpired picks this up on the
        // next tick. Only override when the new due_at would be
        // *sooner* than the existing one — if the commitment was
        // already due in the next 60s, don't push it back.
        dueAt:
          shouldEscalate &&
          (!todo.dueAt || new Date(todo.dueAt).getTime() > Date.now())
            ? now
            : todo.dueAt,
        updatedAt: now,
      });
      this.repo.saveTodo(updated);

      const channel = todo.channelId
        ? this.repo.getChannel(todo.organizationId, todo.channelId)
        : null;
      this.realtime.emit(
        SocketEventNames.memberEmptyWake,
        {
          organizationId: run.organizationId,
          memberId: run.agentId,
          runId: run.id,
          channelId: todo.channelId,
          threadId: run.threadId,
          todoId: todo.id,
          emptyWakeCount: nextCount,
          escalated: shouldEscalate,
          occurredAt: now,
        },
        channel ? this.roomsFor(updated, channel) : [orgRoom(todo.organizationId), memberRoom(todo.memberId)],
      );
    } catch {
      // best-effort — never poison run completion
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
