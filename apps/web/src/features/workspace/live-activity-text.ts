import type { ActivityEvent, RunState } from "@ujima/shared/browser";
import { summarizeRunActivity } from "./lib/run-activity-helpers";

const LIVE_RUN_STATUSES = new Set(["queued", "running", "waiting_for_approval", "waiting_for_input"]);
const MAX_ACTIVITY_LOOKBACK = 160;

/**
 * Returns a compact single-line activity text for a live (queued/running)
 * run. Shows the latest operation label if available, otherwise a fallback
 * status description. Designed for agent pills and chat row headers.
 */
export function liveActivityTextForRun(run: RunState, activity: readonly ActivityEvent[]): string {
  const summary = summarizeRunActivity(run, activity.slice(-MAX_ACTIVITY_LOOKBACK));
  const operation = summary.latestOperation;
  if (operation) return operation;

  // Fallback when no activity events are available yet.
  if (run.status === "waiting_for_approval") return "Waiting for approval";
  if (run.status === "waiting_for_input") return "Waiting for input";
  if (run.status === "queued") return "Queued";
  const step = run.step?.trim();
  return step ? `Working: ${step}` : "Working";
}

/**
 * Finds the most recent live run from a list and returns its compact
 * activity text. Returns undefined when no run is currently live.
 */
export function liveActivityTextForRuns(
  runs: readonly RunState[],
  activity: readonly ActivityEvent[],
): string | undefined {
  let selected: RunState | undefined;
  for (const run of runs) {
    if (!LIVE_RUN_STATUSES.has(run.status)) continue;
    if (!selected || Date.parse(run.startedAt) > Date.parse(selected.startedAt)) selected = run;
  }
  return selected ? liveActivityTextForRun(selected, activity) : undefined;
}
