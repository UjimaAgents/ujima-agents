/**
 * Mirror-loop guard.
 *
 * Two complementary pieces:
 *
 *  1. {@link isMirrorFragileModel} — provider-aware predicate that
 *     identifies model ids known to aggressively mirror the dominant
 *     surface form of recent context. Used by ai-service.ts to inject
 *     an extra anti-mirror line into the wake-run scaffold for those
 *     models.
 *
 *  2. {@link detectMirrorChain} — provider-agnostic runtime guard
 *     that, after the model produces a reply, checks whether the
 *     reply (plus the prior N turns from the same agent or its
 *     immediate counterparty) form a vacuous-ack chain. When the
 *     chain trips, the run-loop converts the reply into a silent
 *     `channel.pass` with reason `mirror_chain_detected`, suppresses
 *     publish, and emits a UI affordance.
 *
 * Both pieces are intentionally simple — lexical and statistical
 * rather than LLM-mediated — because the loop they break is itself
 * an LLM artifact and adding another LLM call to detect it would
 * compound cost and latency. The runtime guard is the deterministic
 * backstop; the prompt nudge is the cheap first line of defence.
 */

/**
 * Returns true when the resolved AI-SDK model id matches a known
 * mirror-fragile family. Today: `gemini-*-flash`. Add new entries
 * here as we learn which providers/models exhibit the same pathology.
 *
 * We match conservatively (lower-cased substring scan) so a future
 * `gemini-2.5-flash-lite-preview` is still caught without code
 * changes.
 */
export function isMirrorFragileModel(modelId: string): boolean {
  if (!modelId) return false;
  const id = modelId.toLowerCase();
  if (id.includes('gemini') && id.includes('flash')) return true;
  return false;
}

/**
 * Tokenise a body for Jaccard comparison. Strips punctuation,
 * lowercases, drops short stop-tokens, dedupes. Conservative on
 * purpose: false positives on "Understood / await" pairs are
 * cheap (one suppressed reply, surface the suppression to the UI),
 * false negatives on genuine new content are expensive (the loop
 * continues).
 */
function tokenize(body: string): Set<string> {
  return new Set(
    body
      .toLowerCase()
      .replace(/[`*_~>[\]()'"!?,.;:]+/g, ' ')
      .replace(/@\w+/g, '')
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface MirrorDetectionInput {
  /**
   * The body the model just produced (NOT yet published). For
   * tool-mediated posts (`channel.reply` / `channel.post`), this is
   * the tool's `body` argument; for free-text terminators it is the
   * model's final text. An empty body bypasses the check (a tool
   * call without a body cannot be a mirror).
   */
  candidateBody: string;
  /**
   * The recent thread history (oldest first), filtered to the
   * messages the model actually saw in this turn's context. The
   * guard inspects only the most recent `windowSize` agent-authored
   * entries.
   */
  recentAgentMessages: readonly { senderId: string; content: string }[];
  /**
   * The agent producing the candidate body. Used to identify the
   * agent's own previous turn (mirroring oneself) and its
   * counterparty's previous turn (mirroring the other).
   */
  selfMemberId: string;
  /** Defaults to 0.75. */
  similarityThreshold?: number;
  /** Defaults to 3 — the chain needs at least N near-duplicates to trip. */
  windowSize?: number;
}

export interface MirrorDetectionResult {
  triggered: boolean;
  similarityScore: number;
  reason: 'self-mirror' | 'pair-mirror' | null;
}

/**
 * Detect a mirror chain. Returns `triggered: true` when the recent
 * agent-authored messages form a vacuous-acknowledgement chain that
 * the candidate body would extend.
 *
 * The signal we actually care about is "N parties keep responding
 * with content-free acks." Token-level similarity (Jaccard / cosine)
 * is too strict — Gemini-flash mirrors at the message-TEMPLATE level
 * (`"Understood, @X. I will [verb]…"`), not at the token level, so
 * paraphrased acks score below any reasonable threshold while still
 * being functionally identical from the user's perspective. The
 * cheaper and more accurate signal: did the last N agent messages
 * AND the candidate ALL classify as `isVacuousAck`? If yes, the
 * conversation is a vacuous-ack chain regardless of the exact tokens.
 *
 * Caller is responsible for the consequences (suppress publish,
 * record `channel.ack`, emit `mirror:suppressed`). This helper is a
 * pure function — no side effects, no I/O.
 */
export function detectMirrorChain(input: MirrorDetectionInput): MirrorDetectionResult {
  const windowSize = input.windowSize ?? 3;
  const candidate = input.candidateBody.trim();
  if (candidate.length === 0) {
    return { triggered: false, similarityScore: 0, reason: null };
  }

  // Candidate must itself be a vacuous ack — a substantive body
  // never trips the mirror guard even if the recent window is.
  if (!isVacuousAck(candidate)) {
    return { triggered: false, similarityScore: 0, reason: null };
  }

  // Look at the last `windowSize` agent messages, oldest first.
  const window = input.recentAgentMessages.slice(-windowSize);
  if (window.length < windowSize) {
    return { triggered: false, similarityScore: 0, reason: null };
  }

  // Every message in the window must also be a vacuous ack — even
  // one substantive turn breaks the chain.
  const allVacuous = window.every((m) => isVacuousAck(m.content));
  if (!allVacuous) {
    return { triggered: false, similarityScore: 0, reason: null };
  }

  // Score = average Jaccard across the window, reported for
  // observability only. The trigger decision is the vacuous-ack
  // chain above; Jaccard is just a metric.
  const tokenizedWindow = window.map((m) => tokenize(m.content));
  const candidateTokens = tokenize(candidate);
  const lastEntry = tokenizedWindow[tokenizedWindow.length - 1];
  const similarityScore = lastEntry ? jaccard(candidateTokens, lastEntry) : 0;

  // Classify self vs pair: if the most recent window entry was the
  // same agent that's now about to post the candidate, it's a self-
  // mirror; otherwise it's a pair-mirror (the more common shape).
  const lastSender = window[window.length - 1]?.senderId;
  const reason: MirrorDetectionResult['reason'] =
    lastSender === input.selfMemberId ? 'self-mirror' : 'pair-mirror';

  return { triggered: true, similarityScore, reason };
}

/**
 * Compact, lexical "is this a vacuous acknowledgement" classifier.
 * Used by the fanout layer to suppress the auto-re-mention rule so
 * a reply that adds no new information doesn't re-wake the
 * counterparty. Strict on purpose: we'd rather miss a few acks (let
 * the chain run one extra turn) than misclassify substantive replies
 * (which would suppress a real mention).
 */
const VACUOUS_ACK_OPENERS = [
  'understood',
  'acknowledged',
  'got it',
  'thanks',
  'thank you',
  'will do',
  'noted',
  'i will await',
  "i'll await",
  'i will wait',
  "i'll wait",
  'i am still working',
  "i'm still working",
  'still working',
  'continuing',
] as const;

export function isVacuousAck(body: string): boolean {
  if (!body) return false;
  const trimmed = body.trim().toLowerCase();
  if (trimmed.length === 0) return false;
  if (trimmed.length > 240) return false;
  if (trimmed.includes('?')) return false;
  // Tool-call markers, code blocks, structured artifacts → real content.
  if (trimmed.includes('```') || trimmed.includes('http://') || trimmed.includes('https://')) {
    return false;
  }
  const opener = VACUOUS_ACK_OPENERS.find((candidate) => trimmed.startsWith(candidate));
  if (!opener) return false;
  // QA flagged: a reply that OPENS with "Got it" but then carries
  // substantive content ("Got it, sending the file now: /tmp/x.pdf")
  // was being classified as vacuous, which dropped the auto-re-
  // mention and sent the counterparty a soft `channel-read` wake.
  // The substantive payload then went unanswered.
  //
  // The fix: the residue (post-opener portion of the body) is
  // *substantive* when it contains either:
  //  (a) a path-like, filename-like, or URL-like token, or
  //  (b) an action verb that implies imminent work
  //      (sending, drafting, writing, building, posting, deploying,
  //       fixing, working, running, deleting, removing, etc.) —
  //      these signal the agent has committed to doing something
  //      beyond just acknowledging.
  // Otherwise the residue is template filler ("I will continue to
  // await your reply on the BRD") and the message is vacuous.
  const residue = trimmed.slice(opener.length);
  if (residue.length === 0) return true;
  // Path-like / filename-like tokens.
  if (/\/\S+/.test(residue) || /\.\w{1,5}(\b|$)/.test(residue)) return false;
  // Numeric ids / version numbers — agent is referencing specific state.
  if (/\b\d{3,}\b/.test(residue)) return false;
  // Substantive action verbs.
  for (const verb of SUBSTANTIVE_ACTION_VERBS) {
    if (new RegExp(`\\b${verb}\\b`).test(residue)) return false;
  }
  return true;
}

// Verbs that, if present in the post-opener residue, mean the body
// is announcing imminent work — NOT a vacuous acknowledgement.
// Bias toward false-vacuous (let through a few extra mention-fanout
// turns) rather than false-substantive (suppress a real reply).
const SUBSTANTIVE_ACTION_VERBS = [
  'sending', 'send', 'drafting', 'draft', 'drafted', 'writing', 'wrote',
  'building', 'built', 'preparing', 'prepared', 'implementing', 'implemented',
  'posting', 'posted', 'pushing', 'pushed', 'deploying', 'deployed',
  'fixing', 'fixed', 'running', 'ran', 'reviewing', 'reviewed',
  'deleting', 'deleted', 'removing', 'removed', 'updating', 'updated',
  'finishing', 'finishedreply', 'completing', 'completed', 'shipping', 'shipped',
  'addressing', 'addressed', 'resolving', 'resolved', 'opening', 'opened',
  'merging', 'merged', 'closing', 'closed', 'starting', 'started',
  'creating', 'created', 'investigating', 'investigated', 'debugging', 'debugged',
];

/**
 * High-level "should this posting tool suppress publish?" decision
 * for channel.* posting tools. Combines the lexical vacuous-ack
 * check and the mirror-chain detector. Returns a suppression result
 * the tool can act on without further branching.
 *
 * Performs no I/O — caller supplies the recent agent messages.
 * Pure function for testability.
 */
export interface MirrorSuppressionInput {
  candidateBody: string;
  recentAgentMessages: readonly { senderId: string; content: string }[];
  selfMemberId: string;
}

export interface MirrorSuppressionResult {
  suppress: boolean;
  similarityScore: number;
  reason: 'self-mirror' | 'pair-mirror' | null;
}

export function shouldSuppressForMirror(input: MirrorSuppressionInput): MirrorSuppressionResult {
  if (!isVacuousAck(input.candidateBody)) {
    return { suppress: false, similarityScore: 0, reason: null };
  }
  const result = detectMirrorChain({
    candidateBody: input.candidateBody,
    recentAgentMessages: input.recentAgentMessages,
    selfMemberId: input.selfMemberId,
  });
  return {
    suppress: result.triggered,
    similarityScore: result.similarityScore,
    reason: result.reason,
  };
}
