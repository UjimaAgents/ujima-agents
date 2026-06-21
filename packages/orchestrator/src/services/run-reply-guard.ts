import {
  RUN_TERMINATING_TOOL_NAMES,
  normalizeToDottedToolName,
} from '@ujima/agent-core';

export { RUN_TERMINATING_TOOL_NAMES, normalizeToDottedToolName } from '@ujima/agent-core';

export function isDelegateMessage(message: { metadata?: unknown } | null | undefined): boolean {
  return !!(message?.metadata as { delegate?: unknown } | undefined)?.delegate;
}

function collectToolNamesFromList(list: unknown, out: Set<string>): void {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const name = readTerminatingToolName(item);
    if (typeof name === 'string' && name.length > 0) {
      out.add(name);
    }
  }
}

function readTerminatingToolName(value: unknown): string | undefined {
  const name = readToolName(value);
  if (name) return name;
  if (!value || typeof value !== 'object') return undefined;
  const output = (value as { output?: unknown }).output;
  const status = output && typeof output === 'object' ? (output as { status?: unknown }).status : undefined;
  if (status === 'passed') return 'channel.pass';
  if (status === 'acked') return 'channel.ack';
  if (status === 'acknowledged') return 'channel.ack';
  if (status === 'handoff_sent') return 'channel.handoff';
  return undefined;
}

function readToolName(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['toolName', 'toolId', 'tool_id']) {
    const name = record[key];
    if (typeof name === 'string' && name.length > 0) return normalizeToDottedToolName(name);
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
      collectToolNamesFromList(s.staticToolResults, names);
      collectToolNamesFromList(s.staticToolCalls, names);
      collectToolNamesFromList(s.dynamicToolResults, names);
      collectToolNamesFromList(s.dynamicToolCalls, names);
      collectToolNamesFromList(s.content, names);
    }
  }
  return names;
}

/**
 * Returns true when the generateText result already closed the current
 * thread via a visible reply/post/handoff or a silent pass/ack. `channel.dm`
 * is intentionally excluded: it delivers to another DM thread and the agent
 * should keep going so it can close the loop where it was asked.
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
 *   1. posting tools (message, channel.post/reply) — these
 *      already published a visible reply, that's the truth on
 *      the current thread.
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
    const name = readTerminatingToolName(record);
    if (name) names.add(name);
  }
  return pickTerminatingTool(names);
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

const SILENT_TERMINATING_TOOLS = new Set(['channel.pass', 'channel.ack']);

/**
 * Steps containing silent terminators (`channel.pass`, `channel.ack`)
 * must not publish assistant text — the tool is the stand-down signal.
 */
export function stepContainsSilentTerminator(step: unknown): boolean {
  if (!step || typeof step !== 'object') return false;
  const record = step as Record<string, unknown>;
  const items = [
    ...(Array.isArray(record.toolCalls) ? record.toolCalls : []),
    ...(Array.isArray(record.toolResults) ? record.toolResults : []),
    ...(Array.isArray(record.staticToolCalls) ? record.staticToolCalls : []),
    ...(Array.isArray(record.dynamicToolCalls) ? record.dynamicToolCalls : []),
    ...(Array.isArray(record.staticToolResults) ? record.staticToolResults : []),
    ...(Array.isArray(record.dynamicToolResults) ? record.dynamicToolResults : []),
    ...(Array.isArray(record.content) ? record.content : []),
  ];
  return items.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const name = (item as { toolName?: string }).toolName;
    return typeof name === 'string' && SILENT_TERMINATING_TOOLS.has(normalizeToDottedToolName(name));
  });
}
