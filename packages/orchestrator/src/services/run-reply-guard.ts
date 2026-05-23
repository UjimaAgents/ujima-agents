/**
 * Tools that terminate the run loop. When any of these fired inside
 * a step, RunService must NOT publish the final assistant `text` as a
 * channel message — either the tool already published a visible reply
 * (`message`, `channel.post`, `channel.reply`, `channel.dm`,
 * `channel.handoff`) or the agent explicitly chose silence
 * (`channel.pass`).
 *
 * Renamed from THREAD_PUBLISHING_TOOL_NAMES because `channel.pass`
 * is a terminator that publishes nothing — the old name no longer
 * describes the membership accurately.
 */
export const RUN_TERMINATING_TOOL_NAMES = new Set([
  'message',
  'channel.dm',
  'channel.reply',
  'channel.post',
  'channel.handoff',
  'channel.ack',
  'channel.pass',
]);

/** @deprecated Renamed to {@link RUN_TERMINATING_TOOL_NAMES}. */
export const THREAD_PUBLISHING_TOOL_NAMES = RUN_TERMINATING_TOOL_NAMES;

function collectToolNamesFromList(list: unknown, out: Set<string>): void {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const name = readToolName(item);
    if (typeof name === 'string' && name.length > 0) {
      out.add(name);
    }
  }
}

function readToolName(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['toolName', 'toolId', 'tool_id']) {
    const name = record[key];
    if (typeof name === 'string' && name.length > 0) return name;
  }
  return undefined;
}

/** Collect the set of tool names that fired in this run result. */
export function collectFiredToolNames(result: unknown): Set<string> {
  const names = new Set<string>();
  if (!result || typeof result !== 'object') {
    return names;
  }
  const root = result as Record<string, unknown>;
  collectToolNamesFromList(root.toolResults, names);
  const steps = root.steps;
  if (Array.isArray(steps)) {
    for (const step of steps) {
      if (!step || typeof step !== 'object') continue;
      const s = step as Record<string, unknown>;
      collectToolNamesFromList(s.toolResults, names);
      collectToolNamesFromList(s.toolCalls, names);
    }
  }
  return names;
}

/**
 * Returns true when the generateText result already delivered content via a
 * channel/message tool that writes to the thread.
 *
 * Note: `channel.pass` is also in {@link RUN_TERMINATING_TOOL_NAMES} —
 * `runUsedThreadPublishingTool` still returns true for it. Run-loop
 * branching distinguishes pass vs. publish via {@link findTerminatingTool}.
 */
export function runUsedThreadPublishingTool(result: unknown): boolean {
  return findTerminatingTool(result) !== null;
}

/**
 * Deterministic precedence for terminating tools. When a model
 * fires multiple terminating tools in the same step (which can
 * happen under `toolChoice: 'required'` plus multi-call models),
 * the first-iteration Set order is implementation-defined. We
 * pin precedence so the run-loop always sees the same terminator
 * for the same combination:
 *
 *   1. posting tools (message, channel.post/reply/dm) — these
 *      already published a visible reply, that's the truth on
 *      the wire.
 *   2. channel.handoff — also publishes a visible message
 *      (with the [HANDOFF]/[DONE] marker).
 *   3. channel.pass — explicit silence, lowest precedence so it
 *      never overrides a real publish.
 *
 * Without this, a sycophantic `channel.reply` + `channel.pass` in
 * the same step would non-deterministically pick either branch in
 * run.ts.
 */
const TERMINATOR_PRECEDENCE: readonly string[] = [
  'message',
  'channel.post',
  'channel.reply',
  'channel.dm',
  'channel.handoff',
  // `channel.ack` and `channel.pass` are both silent terminators (no
  // channel message published). Precedence places real publishes
  // first; ack > pass because ack is the explicit "I saw it, nothing
  // to add" affordance for mandatory-reply turns, while pass is the
  // structured "I have a justification to stay silent" decision.
  'channel.ack',
  'channel.pass',
];

function pickTerminatingTool(names: Set<string>): string | null {
  for (const candidate of TERMINATOR_PRECEDENCE) {
    if (names.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Return the highest-precedence terminating tool that fired in
 * this run, or null if none fired.
 */
export function findTerminatingTool(result: unknown): string | null {
  return pickTerminatingTool(collectFiredToolNames(result));
}

/**
 * Return a terminating tool from persisted run steps.
 *
 * This is a safety net for provider / SDK result-shape changes:
 * the tool service records the canonical tool id after execution,
 * so a successful `channel.reply` row is authoritative even when
 * `streamText` does not echo `toolName` in the final step object.
 */
export function findTerminatingToolFromRunSteps(steps: unknown): string | null {
  if (!Array.isArray(steps)) return null;
  const names = new Set<string>();
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const record = step as Record<string, unknown>;
    if (record.status !== undefined && record.status !== 'ok') continue;
    const name = readToolName(record);
    if (name) names.add(name);
  }
  return pickTerminatingTool(names);
}

export function isAcknowledgementOnly(text: string): boolean {
  return /^acknowledged\.?$/i.test(text.trim());
}

/**
 * Did the run produce a `channel.pass` toolcall? The run-loop uses
 * this to detect "sycophantic pass" (pass + non-empty assistant text)
 * and to enforce the mandatory-reply contract: a `@mention`ed run
 * that ends with `channel.pass` is policy-rejected one level up, so
 * this should only fire for `wakeReason !== 'mention'` runs.
 */
export function runUsedChannelPass(result: unknown): boolean {
  return collectFiredToolNames(result).has('channel.pass');
}
