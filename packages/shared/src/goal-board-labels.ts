import type { GoalTaskStatus } from "./goal-schemas.js";

export const GOAL_TASK_COLUMN_LABELS: Record<GoalTaskStatus, string> = {
  pending: "To Do",
  blocked: "Blocked",
  in_progress: "In Progress",
  completed: "Done",
  blocked_by_failure: "Blocked",
  failed: "Blocked",
  cancelled: "Blocked",
};

export function goalTaskColumnLabel(status: GoalTaskStatus | string): string {
  return GOAL_TASK_COLUMN_LABELS[status as GoalTaskStatus] ?? status.replaceAll("_", " ");
}

export function formatGoalStatusLabel(status: string): string {
  return status
    .trim()
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
