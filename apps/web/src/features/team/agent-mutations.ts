import type { Member } from "@ujima/shared";
import type { SelectedConversation, WorkspaceRoleInput } from "@/features/workspace/types";

export type CreateAgentInput = {
  name: string;
  roleName: string;
  channelIds: string[];
  llm: string;
  model: string;
  role: WorkspaceRoleInput;
};

export type UpdateAgentInput = {
  previousAgentId: string;
  previousRoleName: string;
  memberId: string;
  name: string;
  roleName: string;
  personalityName: string;
  channelIds: string[];
  llm: string;
  model: string;
  role: WorkspaceRoleInput;
};

export type CreateAgentHandler = (
  input: CreateAgentInput,
) => Promise<SelectedConversation | null>;

export type UpdateAgentHandler = (input: UpdateAgentInput) => Promise<Member | null>;
