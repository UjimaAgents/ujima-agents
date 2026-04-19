export const DEFAULT_GENERAL_CHANNEL = Object.freeze({
  id: "general",
  name: "general",
  kind: "general" as const,
  topic: "",
  memberIds: [] as string[],
});

export const DEFAULT_WORKSPACE_ROLE_SCOPES = Object.freeze<Record<string, string[]>>({});
