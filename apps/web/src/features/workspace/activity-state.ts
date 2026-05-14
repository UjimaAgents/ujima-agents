import type { RunState } from "@ujima/shared/browser";

export type ActivityState = "loading" | "working" | "online" | "idle" | "offline" | "error";

const ACTIVE_RUN_STATES: RunState["status"][] = [
  "queued",
  "running",
  "waiting_for_approval",
];

export function conversationActivityState(input: {
  loading: boolean;
  activeRun?: Pick<RunState, "status"> | null;
  presence?: string;
}): ActivityState {
  if (input.loading) return "loading";
  if (input.activeRun && ACTIVE_RUN_STATES.includes(input.activeRun.status)) {
    return "working";
  }
  return presenceToActivityState(input.presence);
}

export function presenceToActivityState(presence?: string): Exclude<ActivityState, "loading" | "working"> {
  switch (presence) {
    case "online":
      return "online";
    case "busy":
    case "away":
      return "idle";
    case "offline":
      return "offline";
    default:
      return "online";
  }
}

export function activityStateToStatus(activity: ActivityState): {
  variant: "active" | "idle" | "offline" | "error";
  label: string;
} {
  switch (activity) {
    case "loading":
      return { variant: "idle", label: "loading" };
    case "working":
      return { variant: "active", label: "working" };
    case "online":
      return { variant: "active", label: "online" };
    case "idle":
      return { variant: "idle", label: "idle" };
    case "offline":
      return { variant: "offline", label: "offline" };
    case "error":
      return { variant: "error", label: "error" };
  }
}
