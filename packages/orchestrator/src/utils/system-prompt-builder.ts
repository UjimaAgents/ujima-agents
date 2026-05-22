import { createHash } from 'node:crypto';
import type { ModelMessage } from 'ai';
import { loadProceduresFile, PROCEDURE_FILE_MAX_BYTES } from '../tools/self-procedure.js';

/**
 * Bet 1 — cache-stable system prompt.
 *
 * Today's wake-run path bakes per-wake mutations (anti-mirror line
 * for gemini-flash, self-followup publish contract) into the
 * `system` string before handing it to the AI-SDK. Every wake of
 * the same agent+thread therefore busts Anthropic's prefix cache,
 * even though 80%+ of the prompt is identical.
 *
 * The structural fix:
 *
 *   - `system: string` carries only Zone 1 (truly invariant per
 *     agent+thread): role identity, collaboration protocol, base
 *     scaffold, the agent's own procedural memory.
 *   - Per-wake variations (anti-mirror, self-followup contract) live
 *     in a SEPARATE block appended to the messages array AFTER the
 *     cache breakpoint. They mutate freely without invalidating the
 *     cached prefix.
 *
 * Procedures.md (Bet 7) loads into Zone 1 because it is per-agent
 * stable: an agent's own playbook changes only when the agent
 * explicitly calls `self.procedure.add/remove`. The cache busts on
 * those (rare) writes — every other wake is a cache hit.
 *
 * `cacheHashFor(system)` returns a deterministic SHA-256 so the CI
 * lint at packages/orchestrator/test/cache-stability.test.ts can
 * assert that two simulated wakes on the same (member, channel,
 * wakeReason) produce byte-identical system prompts.
 */

/**
 * The decision-tree scaffolding that lands in every wake regardless
 * of wakeReason or model. Extracted here so it is provably stable
 * across wakes — the CI lint hashes this list along with the rest
 * of the cacheable system content.
 *
 * KEEP THIS ARRAY LITERAL. The const-frozen assertion is what the
 * cache-stability test relies on: if a future refactor pushes a
 * `wakeReason`-dependent line in here, the assertion fails.
 */
export const BASE_WAKE_SCAFFOLD: readonly string[] = Object.freeze([
  'Before you pick a tool, read the <thread-state> block in the most recent user message.',
  'Treat its <agents-not-yet-responded> and <you-explicitly-addressed> / <you-implicitly-addressed> fields as ground truth — they are computed from the actual channel state, not from your reading.',
  // Decision-tree terminator: name each tool by its function, not by
  // quoting model-emittable strings. Quoting "noted" or "I'll await"
  // inline causes Claude/GPT to pattern-match the example as a
  // canonical exemplar and emit it through channel.ack even when
  // richer replies were warranted.
  'channel.ack = you were addressed but have no new information, question, or status to add. channel.pass = you were not addressed at all. channel.reply = you have substantive content (an answer, an artifact, a question, a status that changes the picture).',
  'If <you-explicitly-addressed>true</you-explicitly-addressed>, you must terminate via a tool. Use channel.reply ONLY when you have substantive content per the definition above; otherwise use channel.ack with an empty body. Acknowledging via channel.reply with paraphrased filler is treated as a missed reply.',
  'If <you-explicitly-addressed>false</you-explicitly-addressed> AND <you-implicitly-addressed>false</you-implicitly-addressed>, call channel.pass and stop. Do not post any message. The audit log already records that you considered the thread.',
  'When you call channel.pass, the note field must reference a specific fact from <thread-state>. Empty notes and generic phrasing are rejected.',
  'An auto-re-mention closing a hand-off does NOT count as being addressed. If the previous message is a plain acknowledgement of YOUR work and contains no new question, treat the chain as complete — call channel.handoff with complete:true (if you initiated the chain) or channel.ack (if you are receiving the acknowledgement).',
]);

export interface CacheableSystemInput {
  /** Output of `buildAgentSystemPrompt` — stable per (agent, thread). */
  baseSystem: string;
  /** Optional procedures.md content (Bet 7). When present, appended to the cache-stable prefix. */
  proceduresText?: string;
  /** Optional task-session goal suffix (still cache-stable per task). */
  goalSuffix?: string;
}

export interface CacheableSystemOutput {
  /** Final `system` string for the AI-SDK. Zone 1 + procedures + base scaffold. */
  system: string;
  /** SHA-256 of the cacheable prefix, for the CI stability test. */
  hash: string;
}

export function buildCacheableSystem(input: CacheableSystemInput): CacheableSystemOutput {
  const sections: string[] = [input.baseSystem];
  if (input.goalSuffix) sections.push(input.goalSuffix);
  if (input.proceduresText) {
    sections.push('Your procedural memory (per-agent playbook):');
    sections.push(input.proceduresText);
  }
  sections.push(BASE_WAKE_SCAFFOLD.join('\n'));
  const system = sections.filter(Boolean).join('\n\n');
  const hash = createHash('sha256').update(system).digest('hex');
  return { system, hash };
}

export interface WakeContextInput {
  wakeReason: 'mention' | 'self-followup' | 'channel-read' | 'dm' | 'handoff' | 'parent-thread' | null;
  /** Resolved AI-SDK model id — used to gate the anti-mirror line. */
  modelIdString: string;
  /** When present, prefer JSON-shape thinking for fragile models. */
  isMirrorFragile: boolean;
}

/**
 * Per-wake mutations land here as user-role messages AFTER the
 * cache breakpoint. The anti-mirror line targets `gemini-*-flash`
 * (the only family that needs the explicit nudge today); the
 * self-followup contract is the publish-or-pass instruction that
 * lands on scheduler-driven wakes.
 *
 * Returns an empty array when no per-wake content applies — caller
 * appends as-is to its messages array.
 */
export function buildWakeContextMessages(input: WakeContextInput): ModelMessage[] {
  const lines: string[] = [];

  if (input.isMirrorFragile) {
    lines.push(
      'IMPORTANT — anti-mirror rule: Do NOT paraphrase the previous message. If your intended reply restates what the previous turn already said, differs only by swapping names, or amounts to "noted / understood / I will await", call channel.ack with no body. Filler acknowledgements waste team attention and trigger redundant wakes.',
    );
  }

  if (input.wakeReason === 'self-followup') {
    lines.push(
      'You are waking on a commitment you made earlier in this channel. Before you stop, do one of: (a) call channel.post or channel.reply with concrete progress — a path you wrote, a result, or the actual artifact; (b) call channel.pass with a real reason ("still gathering inputs", "blocked on X") if you have no publishable progress yet; (c) call supervisor.todo.update if you need to mark the commitment blocked or completed. self.note alone is NOT a valid termination — every team member will notice you went silent on your own promise.',
    );
    lines.push(
      'For ANY deliverable longer than ~10 lines (task lists, BRDs, PRDs, specs, multi-section docs): use the `write` tool to save the artifact to a file in the workspace (e.g. ai/memory-bank/tasks/<name>.md) FIRST, then post a short channel.post that says "Delivered — see <path>". Pasting long markdown inline gets truncated at the token cap and the reader sees a half-written document.',
    );
  }

  if (lines.length === 0) return [];
  return [
    {
      role: 'user',
      content: `<wake-context>\n${lines.join('\n')}\n</wake-context>`,
    },
  ];
}

/**
 * Best-effort read of the agent's procedural memory file. Returns
 * undefined when the file doesn't exist; never throws on read
 * errors (we degrade to "no procedures" rather than block a wake).
 * Caps the returned text at PROCEDURE_FILE_MAX_BYTES — the file
 * tool also enforces this on write, but reading is the second line
 * of defence.
 */
export async function loadProceduresForSystemPrompt(
  workspaceRoot: string,
  memberId: string,
): Promise<string | undefined> {
  try {
    const loaded = await loadProceduresFile(workspaceRoot, memberId);
    if (!loaded || loaded.entries.length === 0) return undefined;
    const raw = loaded.raw;
    if (raw.length === 0) return undefined;
    return raw.length > PROCEDURE_FILE_MAX_BYTES ? raw.slice(0, PROCEDURE_FILE_MAX_BYTES) : raw;
  } catch {
    return undefined;
  }
}

/**
 * Hash arbitrary text for the CI stability lint. Exported so tests
 * can hash blocks of the prompt individually (system, scaffold,
 * thread-state) and pinpoint exactly which zone broke when a
 * regression fires.
 */
export function hashPromptZone(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
