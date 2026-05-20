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
 * Detect a mirror chain. Returns `triggered: true` only when:
 *  - the candidate body has ≥ {@link similarityThreshold} Jaccard
 *    overlap with at least one recent message from this agent
 *    (self-mirror) or its immediate counterparty (pair-mirror), AND
 *  - the last {@link windowSize} agent-authored messages in the
 *    window are pairwise similar above the threshold (chain shape,
 *    not a one-off ack).
 *
 * Caller is responsible for the consequences (suppress publish,
 * record `channel.pass` with reason, emit UI event). This helper is
 * a pure function — no side effects, no I/O.
 */
export function detectMirrorChain(input: MirrorDetectionInput): MirrorDetectionResult {
  const threshold = input.similarityThreshold ?? 0.75;
  const windowSize = input.windowSize ?? 3;
  const candidate = input.candidateBody.trim();
  if (candidate.length === 0) {
    return { triggered: false, similarityScore: 0, reason: null };
  }

  const candidateTokens = tokenize(candidate);
  if (candidateTokens.size < 3) {
    // Too few tokens to compare meaningfully ("ok", "thx") — not a
    // mirror, just brevity.
    return { triggered: false, similarityScore: 0, reason: null };
  }

  // Look at the last `windowSize` agent messages, oldest of the
  // window first.
  const window = input.recentAgentMessages.slice(-windowSize);
  if (window.length < windowSize) {
    return { triggered: false, similarityScore: 0, reason: null };
  }

  const tokenized = window.map((m) => ({
    senderId: m.senderId,
    tokens: tokenize(m.content),
  }));

  // Compare candidate to the most recent window entry. If it's
  // below threshold, no chain.
  const lastEntry = tokenized[tokenized.length - 1];
  if (!lastEntry) {
    return { triggered: false, similarityScore: 0, reason: null };
  }
  const candidateVsLast = jaccard(candidateTokens, lastEntry.tokens);
  if (candidateVsLast < threshold) {
    return { triggered: false, similarityScore: candidateVsLast, reason: null };
  }

  // Verify the window itself is a chain — every consecutive pair
  // within the window is also above threshold. This catches the
  // "N+1 turns of the same shape" pattern and avoids tripping on a
  // single off-topic mirror that immediately follows a different
  // conversation.
  for (let i = 1; i < tokenized.length; i += 1) {
    const prev = tokenized[i - 1];
    const curr = tokenized[i];
    if (!prev || !curr) continue;
    const sim = jaccard(prev.tokens, curr.tokens);
    if (sim < threshold) {
      return { triggered: false, similarityScore: sim, reason: null };
    }
  }

  // The chain is real. Classify the mirror as self vs pair.
  const reason: MirrorDetectionResult['reason'] =
    lastEntry.senderId === input.selfMemberId ? 'self-mirror' : 'pair-mirror';

  return { triggered: true, similarityScore: candidateVsLast, reason };
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
  return VACUOUS_ACK_OPENERS.some((opener) => trimmed.startsWith(opener));
}

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
