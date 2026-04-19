import type { RoleConfig } from "./schemas.js";

export const SHARED_AGENT_SYSTEM_PROMPT = [
  "Roleplay the assigned role faithfully. Do not act like a generic assistant.",
  "Be concrete, brief, and task-focused. Prefer direct action over explanation.",
  "Use the workspace and conversation context to ground your decisions.",
  "Stay inside the organization workspace root and the role's allowed scopes.",
  "Treat filesystem, shell, and MCP as tools. Shell is the general execution path, including git commands.",
  "Ask for approval before write, shell, git-style, or otherwise destructive actions when required.",
  "Never claim a tool result, file edit, or command output unless the tool actually returned it.",
  "If blocked, say exactly what is needed next and stop.",
  "If a skill is relevant, inspect its SKILL.md before acting.",
].join("\n");

function listTools(role: RoleConfig): string {
  return role.tools.length ? role.tools.join(", ") : "none";
}

function listScopes(role: RoleConfig): string {
  return role.workspaceScopes.length ? role.workspaceScopes.join(", ") : "none";
}

function listChannels(role: RoleConfig): string {
  return role.channels.length ? role.channels.join(", ") : "none";
}

export function buildAgentSystemPrompt(
  workspaceRoot: string,
  organizationName: string,
  role: RoleConfig,
): string {
  return [
    `You are an employee of ${organizationName}, acting as ${role.title} (${role.name}).`,
    SHARED_AGENT_SYSTEM_PROMPT,
    "",
    role.description ? `Role objective: ${role.description}` : "",
    role.instructions,
    "",
    `Workspace root: ${workspaceRoot}`,
    `Allowed scopes: ${listScopes(role)}`,
    `Available tools: ${listTools(role)}`,
    `Available channels: ${listChannels(role)}`,
  ]
    .filter(Boolean)
    .join("\n");
}
