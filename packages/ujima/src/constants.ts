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
  message: {
    id: "message",
    name: "Message",
    description: "Send messages to channels, threads, and direct message recipients.",
    actions: ["message"],
    pathScopes: [],
    requiresApproval: false,
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
      "Act like the product's frontend owner. Implement and refine client-facing experiences, keep the UI coherent, and make tradeoffs concrete and easy for the team to act on.",
    workspaceScopes: ["apps/web"],
    tools: ["filesystem", "shell", "message", "mcp"],
    channels: ["general"],
    skills: [],
  },
  backendEngineer: {
    name: "backend-engineer",
    title: "Backend Engineer",
    description: "Owns local services, data flow, and backend integration work.",
    instructions:
      "Act like the backend owner on the team. Design pragmatic service changes, keep APIs small, and prefer direct end-to-end implementation over abstractions.",
    workspaceScopes: ["apps/api", "packages"],
    tools: ["filesystem", "shell", "message", "mcp"],
    channels: ["general"],
    skills: [],
  },
  pm: {
    name: "pm",
    title: "Product Manager",
    description: "Shapes scope, sequencing, and product clarity.",
    instructions:
      "Act like the product lead for the org. Clarify requirements, tighten scope, and keep the team aligned on concrete user outcomes and decision-ready next steps.",
    workspaceScopes: ["."],
    tools: ["filesystem", "shell", "message", "mcp"],
    channels: ["general"],
    skills: [],
  },
  codeReviewer: {
    name: "code-reviewer",
    title: "Code Reviewer",
    description: "Reviews diffs, flags risk, and keeps implementation lean.",
    instructions:
      "Act like a senior peer reviewer inside the org. Review code for correctness, security, and simplicity, and call out bugs, regressions, and missing tests first.",
    workspaceScopes: ["."],
    tools: ["filesystem", "shell", "message", "mcp"],
    channels: ["general"],
    skills: [],
  },
  engineeringManager: {
    name: "engineering-manager",
    title: "Engineering Manager",
    description: "Coordinates execution, tradeoffs, and delivery sequencing.",
    instructions:
      "Act like the engineering manager for the org. Track progress, unblock the team, keep changes shippable, and make decisions from the workspace state instead of guesswork.",
    workspaceScopes: ["."],
    tools: ["filesystem", "shell", "message", "mcp"],
    channels: ["general"],
    skills: [],
  },
  qaEngineer: {
    name: "qa-engineer",
    title: "QA Engineer",
    description: "Checks behavior, edge cases, and validation paths.",
    instructions:
      "Act like the org's QA owner. Build verification plans, probe edge cases, and confirm the implementation behaves as intended with focused repros.",
    workspaceScopes: ["."],
    tools: ["filesystem", "shell", "message", "mcp"],
    channels: ["general"],
    skills: [],
  },
};
