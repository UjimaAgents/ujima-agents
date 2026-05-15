import type { SelectedConversation } from "./types";

export function goalModePreferenceKey(
  organizationId: string | undefined,
  conversationId: SelectedConversation["id"],
): string {
  return `ujima:goalMode:${organizationId ?? "unknown"}:${conversationId}`;
}

export function readGoalModePreference(key: string): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(key) === "true";
}

export function writeGoalModePreference(key: string, active: boolean): void {
  if (typeof window === "undefined") return;
  if (active) window.localStorage.setItem(key, "true");
  else window.localStorage.removeItem(key);
}
