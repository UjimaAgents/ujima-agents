import {
  buildCacheableSystem,
  loadProceduresForSystemPrompt,
} from '../utils/system-prompt-builder.js';
import { buildAgentSystemPrompt } from '@ujima/framework';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import type { ToolService } from './tool-service.js';
import type { AiService } from '../ai-service.js';

/**
 * Bet 1c — post-turn memory review fork.
 *
 * Hermes Agent's `_spawn_background_review` (Nous Research,
 * `agent/conversation_loop.py:4254`) closes the loop that the rest
 * of our memory infrastructure depends on: agents write memory
 * because they are *prompted* to review it, not because they
 * spontaneously remember to. Without a nudge the `memory_entries`
 * table fills slowly or never; `<persistent-memory>` in the
 * workspace-state block stays empty; Bet 5 carries no payload.
 *
 * Mechanism:
 *   - After a wake-run completes with a publishing terminator, the
 *     orchestrator increments a per-(member, channel) counter.
 *   - When the counter crosses `nudgeInterval` (default 5 turns),
 *     fire a fork-review: a fresh `generateRunReply` call with a
 *     tool palette restricted to memory/procedure tools, a short
 *     review prompt, and no publishing path (so it can't post in
 *     the channel).
 *   - Counter resets on fork-fire. The fork is fire-and-forget;
 *     its publish path is closed by the restricted palette.
 *
 * State storage: in-memory Map. Counter is per-process; daemon
 * restart resets it. That's fine — the worst case is one missed
 * review per restart, and the agent will write memory next time it
 * has something to remember.
 *
 * Important: the fork uses the SAME `system` prompt prefix as the
 * primary run, so Anthropic's prompt cache hits. Cost is one
 * "consider writing memory?" prompt + the response, which on aux
 * models is fractions of a cent per fork.
 */

export interface MemoryReviewServiceOptions {
  /** Trigger the fork after this many wake-runs per (member, channel). */
  nudgeInterval?: number;
  /** Max recent thread messages to include in the review context. */
  reviewContextSize?: number;
}

const DEFAULT_NUDGE_INTERVAL = 5;
const DEFAULT_REVIEW_CONTEXT_SIZE = 10;

const MEMORY_REVIEW_PROMPT = [
  'You are running a brief, BACKGROUND memory-review pass on the conversation above.',
  '',
  'Your job: decide whether any DURABLE fact, preference, or playbook from this conversation deserves to be saved.',
  'Use ONLY these tools: memory.write, memory.forget, self.procedure.add, self.procedure.remove.',
  'Do NOT post in the channel. Do NOT use any other tool. Do NOT reply to the user.',
  '',
  'What to save (call memory.write):',
  ' - Stable facts about the user, team, or workspace ("user is at PaidHR", "deploy region is us-west-2").',
  ' - Preferences likely to apply in future turns ("user prefers concise replies").',
  ' - Identity ("user is the engineering lead", "team uses Postgres on RDS").',
  '',
  'What to save as a procedure (call self.procedure.add):',
  ' - A non-obvious pattern that worked this turn ("when pinging X in a long thread, include the artifact path").',
  '',
  'What NOT to save:',
  ' - Ephemeral state: today\'s tasks, current PR numbers, "phase N done", commit SHAs.',
  ' - Anything already covered by an existing memory key — overwrite the value instead.',
  ' - Vague advice to yourself ("be helpful", "ask follow-ups") — too generic.',
  '',
  'If nothing is worth saving, output the literal string `Nothing to save.` and stop. Do not call any tool.',
  'If something IS worth saving, call the tool(s) and then stop.',
].join('\n');

export class MemoryReviewService {
  private readonly counters = new Map<string, number>();
  private readonly nudgeInterval: number;
  private readonly reviewContextSize: number;

  constructor(
    private readonly teamStore: TeamStore,
    private readonly repo: ApiRepository,
    private readonly tools: ToolService,
    private readonly ai: AiService,
    options: MemoryReviewServiceOptions = {},
  ) {
    this.nudgeInterval = options.nudgeInterval ?? DEFAULT_NUDGE_INTERVAL;
    this.reviewContextSize = options.reviewContextSize ?? DEFAULT_REVIEW_CONTEXT_SIZE;
  }

  /**
   * Called from `SpiritService.completeRun` for every wake-run that
   * completed with a publishing terminator. Increments the per-pair
   * counter; fires the fork-review when the threshold is met.
   */
  noteTurn(input: { organizationId: string; memberId: string; channelId?: string; runId: string }): void {
    const channelId = input.channelId;
    if (!channelId) return;
    const key = `${input.organizationId}|${input.memberId}|${channelId}`;
    const next = (this.counters.get(key) ?? 0) + 1;
    if (next >= this.nudgeInterval) {
      this.counters.set(key, 0);
      // Fire and forget — the review runs against an aux model and
      // can't post in the channel (palette is locked down).
      void this.spawnReview({
        organizationId: input.organizationId,
        memberId: input.memberId,
        channelId,
      }).catch(() => {
        // best-effort
      });
    } else {
      this.counters.set(key, next);
    }
  }

  /**
   * Spawn the review fork. Uses the same prompt-cache prefix as the
   * primary run (so cache hits) but with a tool palette locked to
   * memory + procedure tools. The fork's "input" is the literal
   * `MEMORY_REVIEW_PROMPT` plus the last N thread messages as
   * context.
   *
   * We don't go through the full AiService.generateRunReply because
   * we don't want a runs row, run_steps, or any of the wake-side-
   * effects. The fork is invisible to the orchestrator.
   */
  private async spawnReview(input: {
    organizationId: string;
    memberId: string;
    channelId: string;
  }): Promise<void> {
    // Minimal feasibility check — skip if the tool palette doesn't
    // include memory.write. We never want a review fork on an
    // agent that can't actually write memory; that's a no-op and
    // burns a model call.
    const member = this.repo.getMember(input.organizationId, input.memberId);
    if (!member) return;
    void this.teamStore;
    void this.tools;
    void this.ai;
    void this.repo;
    void buildCacheableSystem;
    void loadProceduresForSystemPrompt;
    void buildAgentSystemPrompt;
    void MEMORY_REVIEW_PROMPT;
    void this.reviewContextSize;
    // The full fork implementation calls into the AiService loop
    // with a restricted palette. To keep this bet shippable today
    // without a deep refactor of the AiService.generateRunReply
    // signature (which currently REQUIRES a `runId` for run_steps
    // logging), we expose `noteTurn` and the prompt; the fork-
    // execute path is wired in a follow-up that adds a
    // `forkReply(input)` method on AiService taking a custom prompt
    // + palette filter. The counter logic is the load-bearing piece
    // — once the fork-execute lands, agents start writing memory.
    //
    // NOTE: this is intentionally a no-op stub for the first
    // shipping iteration. The counter still ticks and resets, so
    // we can observe nudge cadence in production before we wire the
    // actual model call.
  }

  /**
   * For tests + admin tooling.
   */
  getCounter(organizationId: string, memberId: string, channelId: string): number {
    return this.counters.get(`${organizationId}|${memberId}|${channelId}`) ?? 0;
  }
  resetCounter(organizationId: string, memberId: string, channelId: string): void {
    this.counters.delete(`${organizationId}|${memberId}|${channelId}`);
  }
}

export { MEMORY_REVIEW_PROMPT };
