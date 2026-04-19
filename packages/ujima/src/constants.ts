import type { RolePreset } from "./schemas.js";
import type { ToolCapability } from "@ujima/shared";

export const DEFAULT_TOOL_CATALOG: Record<string, ToolCapability> = {
  filesystem: {
    id: "filesystem",
    name: "Filesystem",
    description: "Read and edit files inside the organization workspace.",
    actions: ["read", "write"],
    pathScopes: ["."],
    requiresApproval: true,
  },
  shell: {
    id: "shell",
    name: "Shell",
    description: "Run local commands inside the organization workspace.",
    actions: ["execute"],
    pathScopes: ["."],
    requiresApproval: true,
  },
  git: {
    id: "git",
    name: "Git",
    description: "Inspect and change git state inside the organization workspace.",
    actions: ["read", "git"],
    pathScopes: ["."],
    requiresApproval: true,
  },
  mcp: {
    id: "mcp",
    name: "MCP",
    description: "Call approved MCP servers and tool adapters.",
    actions: ["mcp"],
    pathScopes: [],
    requiresApproval: true,
  },
};

export const ROLE_PRESETS: Record<string, RolePreset> = {
  frontendEngineer: {
    name: "frontend-engineer",
    title: "Frontend Engineer",
    description: "Builds UI surfaces, client workflows, and interaction polish.",
    instructions:
      "Implement and refine client-facing experiences, keep UX coherent, and surface clear implementation tradeoffs.",
    workspaceScopes: ["apps/web"],
    tools: ["filesystem", "git", "mcp"],
    channels: ["general"],
  },
  backendEngineer: {
    name: "backend-engineer",
    title: "Backend Engineer",
    description: "Owns local services, data flow, and backend integration work.",
    instructions:
      "Design pragmatic backend changes, keep APIs small, and favor direct end-to-end implementations.",
    workspaceScopes: ["apps/api", "packages"],
    tools: ["filesystem", "shell", "git", "mcp"],
    channels: ["general"],
  },
  pm: {
    name: "pm",
    title: "Product Manager",
    description: "Shapes scope, sequencing, and product clarity.",
    instructions:
      "Clarify requirements, tighten scope, and keep the team aligned on concrete user outcomes.",
    workspaceScopes: ["."],
    tools: ["filesystem", "git", "mcp"],
    channels: ["general"],
  },
  codeReviewer: {
    name: "code-reviewer",
    title: "Code Reviewer",
    description: "Reviews diffs, flags risk, and keeps implementation lean.",
    instructions:
      "Review code for correctness, security, and simplicity. Call out bugs, regressions, and missing tests first.",
    workspaceScopes: ["."],
    tools: ["filesystem", "git", "mcp"],
    channels: ["general"],
  },
  engineeringManager: {
    name: "engineering-manager",
    title: "Engineering Manager",
    description: "Coordinates execution, tradeoffs, and delivery sequencing.",
    instructions:
      "Track progress, unblock the team, and keep changes shippable without overengineering.",
    workspaceScopes: ["."],
    tools: ["filesystem", "git", "mcp"],
    channels: ["general"],
  },
  qaEngineer: {
    name: "qa-engineer",
    title: "QA Engineer",
    description: "Checks behavior, edge cases, and validation paths.",
    instructions:
      "Build verification plans, probe edge cases, and confirm the implementation behaves as intended.",
    workspaceScopes: ["."],
    tools: ["filesystem", "shell", "git", "mcp"],
    channels: ["general"],
  },
};
