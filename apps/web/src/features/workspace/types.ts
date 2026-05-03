/** Represents the currently selected conversation in the workspace. */
export interface SelectedConversation {
  type: "channel" | "agent";
  id: string;
  name: string;
}

export interface WorkspaceRoleInput {
  id?: string;
  name: string;
  title: string;
  description?: string;
  instructions: string;
  kind?: "agent";
  provider?: string;
  model?: string;
  workspaceScopes?: string[];
  tools?: string[];
  channels?: string[];
  skills?: string[];
}
