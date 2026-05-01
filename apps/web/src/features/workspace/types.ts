/** Represents the currently selected conversation in the workspace. */
export interface SelectedConversation {
  type: "channel" | "dm" | "agent";
  id: string;
  name: string;
}
