import { createHash } from 'node:crypto';
import type { ModelMessage } from 'ai';
import { buildEnvironmentTimestamp, buildEnvironmentTimezone, type WakeReason } from '@ujima/shared';
import { ANTI_MIRROR_SCAFFOLD_LINE, BASE_WAKE_SCAFFOLD_LINES } from './wake-reply-policy.js';
import { loadProceduresForSystemPrompt as loadProceduresIndex } from '../tools/self-procedure.js';
import { aggregateProcedures, type AggregatorOutput } from './procedures.js';

/**
 * Bet 1 — cache-stable system prompt.
 *
 * Today's wake-run path bakes per-wake mutations (anti-mirror line
 * for gemini-flash) into the
 * `system` string before handing it to the AI-SDK. Every wake of
 * the same agent+thread therefore busts Anthropic's prefix cache,
 * even though 80%+ of the prompt is identical.
 *
 * The structural fix:
 *
 *   - `system: string` carries only Zone 1 (truly invariant per
 *     agent+thread): role identity, collaboration protocol, base
 *     scaffold, the agent's own procedural memory.
 *   - Per-wake variations live
 *     in a SEPARATE block appended to the messages array AFTER the
 *     cache breakpoint. They mutate freely without invalidating the
 *     cached prefix.
 *
 * Procedures.md (Bet 7) loads into Zone 1 because it is per-agent
 * stable: an agent's own playbook changes only when the agent
 * explicitly calls `procedure add/remove`. The cache busts on
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
/**
 * Memory write-policy guidance. Lifted from Hermes Agent's
 * `MEMORY_GUIDANCE` (Nous Research, `agent/prompt_builder.py`)
 * and adapted to ujima's `memory.write` tool. Without this block,
 * agents can call `memory.write` but have no policy for WHEN to
 * fire it or WHAT counts as durable — we built the warehouse and
 * shipped no inventory. The block is prescriptive on purpose;
 * vague guidance produces noisy memory tables.
 *
 * Loaded into Zone 1 (cache-stable prefix) iff `memory.write` is in
 * the resolved tool palette. Skipped otherwise — agents without
 * memory tools don't see the guidance, keeping the prompt clean.
 */
export const MEMORY_GUIDANCE: readonly string[] = Object.freeze([
  '## Persistent Memory — Your Cross-Session Brain (Active Tool)',
  '',
  'Memory is how you get smarter over time. Every fact you write makes',
  'every future wake more informed, less repetitive, and more effective.',
  'Treat memory as a first-class tool — use it actively, not as an afterthought.',
  '',
  '### When to use memory.recall',
  '- **Before asking clarifying questions.** If the user may have already told you something, call `memory.recall` with a query first. The recall engine uses fuzzy search (Fuse.js) — it handles typos, partial words, and approximate matches ("prefer concice" will find "prefers concise responses").',
  '- **When starting a new task.** Recall any relevant context before you begin: user preferences, project patterns, team conventions.',
  '- **When unsure.** A quick recall is cheaper than asking the user a question they\'ve already answered.',
  '',
  '### What to write with memory.write',
  '- **Declarative facts** about the user, the team, or this workspace that will still be true next week. Examples: "User prefers concise replies", "Deploy region is us-west-2", "PaidHR engineering owns auth + payroll".',
  '- **User preferences and patterns** you observe. If the user corrects your response style, write that preference immediately.',
  '- **Identity and role** information: who owns what, what the team uses, what the conventions are.',
  '',
  '### What NOT to write',
  '- **Ephemeral state**: PR numbers, issue numbers, commit SHAs, "phase N done", today\'s date, status updates. That belongs in channel messages.',
  '- **Instructions to yourself** ("always respond concisely"). Write the fact ("user prefers concise responses") and let the agent decide.',
  '',
  '### Key rules',
  '- **One key, one value.** Reuse keys: `memory.write({ key: "user.tone-preference", value: "..." })` overwrites the old value. Don\'t hoard versioned keys.',
  '- **TTL**: pass `expires_in_days` for facts that have a natural decay (current quarter, ongoing project). Omit it for stable facts (preferences, identity).',
  '- **Be aggressive about writing.** If you\'re unsure whether a fact belongs in memory, err on writing it. The fuzzy recall engine will handle noisy results; an empty memory table is always worse than a full one.',
  '- **Memory recall is fuzzy.** You can search with natural language, partial words, or even misspellings. The engine will rank results by relevance.',
]);

/**
 * Procedures (Bet 7) write-policy guidance. Same idea as
 * `MEMORY_GUIDANCE` but for the per-agent playbook. Procedures are
 * "when X, do Y" rules — they are the agent's view of HOW it
 * should act, not what it knows.
 */
export const PROCEDURES_GUIDANCE: readonly string[] = Object.freeze([
  'Procedural memory (procedure add / remove):',
  '- Write a procedure when you discover a non-obvious pattern that worked: "When pinging Phoebe in #design on a long thread, include the artifact path explicitly so she doesn\'t have to scroll".',
  '- Procedures are FOR YOU. Phrase them as "When X, do Y" — short, specific, actionable.',
  '- Do NOT add a procedure for behavior the system already enforces (mandatory-reply, channel.pass rules). Those live in the wake scaffold.',
  '- Remove a procedure when it stops being useful — outdated playbooks poison every future wake.',
  '- The procedure file is YOUR playbook. It is not the user\'s style guide and not the team\'s process doc.',
]);

/**
 * Re-exported from `wake-reply-policy.ts` (the canonical owner of
 * scaffold prose). The cache-stability test imports this name; the
 * underlying lines are now sourced from `SCAFFOLD_RULES` so a single
 * rule edit lands in every consumer (base + channel + DM).
 */
export const BASE_WAKE_SCAFFOLD: readonly string[] = BASE_WAKE_SCAFFOLD_LINES;

export interface CacheableSystemInput {
  /** Output of `buildAgentSystemPrompt` — stable per (agent, thread). */
  baseSystem: string;
  /** Enforced org procedures rendered before lower-priority prompt sections. */
  lawText?: string;
  /** One-line workspace, channel, and agent procedure index. */
  proceduresText?: string;
  /**
   * Per-thread base scaffold (DM vs channel) from
   * `resolveWakeReplyPolicy().scaffoldBlock`. Stable for the
   * lifetime of a thread — DM threads get the DM scaffold, channel
   * threads get the channel scaffold; neither flips per wake. When
   * omitted, falls back to the joined `BASE_WAKE_SCAFFOLD` for
   * backwards-compatibility with non-policy-driven callers (tests
   * and any legacy code path).
   */
  baseScaffold?: string;
  /**
   * Resolved tool palette for this wake — used to gate memory /
   * procedure guidance blocks. When the agent doesn't have
   * `memory.write`, the MEMORY_GUIDANCE block is omitted so the
   * cache prefix stays minimal. Pass an empty array (or omit) to
   * skip all guidance.
   */
  availableToolIds?: readonly string[];
}

export interface CacheableSystemOutput {
  /** Final `system` string for the AI-SDK. Zone 1 + procedures + base scaffold. */
  system: string;
  /** SHA-256 of the cacheable prefix, for the CI stability test. */
  hash: string;
}

export function buildCacheableSystem(input: CacheableSystemInput): CacheableSystemOutput {
  const sections: string[] = [input.baseSystem];
  if (input.lawText) sections.push(input.lawText);
  // Bet 1b — memory/procedure write-policy guidance, gated on
  // tool availability so prompts without memory tools stay clean.
  const toolIds = new Set(input.availableToolIds ?? []);
  if (toolIds.has('memory.write')) sections.push(MEMORY_GUIDANCE.join('\n'));
  if (toolIds.has('procedure')) sections.push(PROCEDURES_GUIDANCE.join('\n'));
  if (input.proceduresText) {
    sections.push(input.proceduresText);
  }
  sections.push(input.baseScaffold ?? BASE_WAKE_SCAFFOLD.join('\n'));
  const system = sections.filter(Boolean).join('\n\n');
  const hash = createHash('sha256').update(system).digest('hex');
  return { system, hash };
}

export interface WakeContextInput {
  wakeReason: WakeReason | null;
  /** Resolved AI-SDK model id — used to gate the anti-mirror line. */
  modelIdString: string;
  /** When present, prefer JSON-shape thinking for fragile models. */
  isMirrorFragile: boolean;
}

/**
 * Build the ephemeral per-wake context message (current date/time).
 * This is the ONLY part of the wake context that changes between
 * consecutive wakes. It is emitted as a `user`-role message at the
 * tail of the stable transcript prefix, so the rest of the prompt
 * stays cached.
 *
 * Returns an empty array when no per-wake content applies — caller
 * appends as-is to its messages array.
 */
export function buildWakeContextMessages(input: WakeContextInput): ModelMessage[] {
  const lines = [buildEnvironmentTimestamp(), buildEnvironmentTimezone()];
  if (input.isMirrorFragile) lines.push(ANTI_MIRROR_SCAFFOLD_LINE);
  return [
    {
      role: 'user',
      content: `<wake-context>\n${lines.join('\n')}\n</wake-context>`,
    },
  ];
}

/**
 * Best-effort read of the agent's procedural memory index. Returns
 * undefined when no procedures exist; never throws on read errors
 * (we degrade to "no procedures" rather than block a wake).
 *
 * Bet 2 (Hermes-inspired): the system prompt loads only
 * `name: description` lines for each procedure, NOT the full
 * bodies. The agent calls `procedure view(name)` on demand.
 * This keeps the cache-stable prefix lean even when the agent
 * accumulates many playbooks.
 */
export async function loadProceduresForSystemPrompt(
  workspaceRoot: string,
  memberId: string,
): Promise<string | undefined> {
  try {
    return await loadProceduresIndex(workspaceRoot, memberId);
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

export async function loadCultureForSystemPrompt(input: {
  workspaceRoot: string;
  organizationId: string;
  memberId: string;
  channelId?: string;
}): Promise<AggregatorOutput> {
  try {
    return await aggregateProcedures(input);
  } catch {
    return { applied: [] };
  }
}
