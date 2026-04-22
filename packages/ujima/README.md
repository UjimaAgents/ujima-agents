# @ujima/framework

Framework SDK for defining an agent team in code.

This package is for people who want to describe a real team, not just a prompt blob. It gives you a typed way to define roles, personalities, tools, providers, and workspace-aware org structure.

## What It Does

- validates and normalizes team configuration
- provides agent, role, personality, provider, and tool helpers
- builds the shared agent system prompt
- loads team definitions from files
- keeps workspace-scoped config explicit

## Why It Exists

The framework is the public language of the project. It lets the open-source stack stay programmable without forcing every app to reinvent the same config shape.

## Install

```bash
bun add @ujima/framework
```

In this monorepo:

```bash
bun install
```

## Main Exports

- `AgentTeam`
- `createStarterAgentTeamConfig`
- `loadAgentTeam`
- `loadAgentTeamFromFile`
- `ROLE_PRESETS`
- `PERSONALITY_PRESETS`
- `DEFAULT_TOOL_CATALOG`
- `buildAgentSystemPrompt`
- `SHARED_AGENT_SYSTEM_PROMPT`
- `createAgent`
- `normalizeAgents`
- `createRoleFromPreset`
- `defineRole`
- `normalizeRoles`
- `createPersonalityFromPreset`
- `definePersonality`
- `defineProvider`
- `normalizeProviders`
- `defineTool`
- `normalizeTools`
- `createOrganizationChart`
- `createWorkspaceConfig`

## Quick Start

```ts
import { AgentTeam } from "@ujima/framework";

const team = AgentTeam({
  name: "Acme Team",
  workspace: {
    root: process.cwd(),
    roleScopes: {
      frontend: ["apps/web"],
      backend: ["apps/api"],
    },
  organizationChart: {
    reportsTo: {
      Taylor: "Sam", // Taylor reports to Sam
    },
  },
  policies: {
    requireApprovalForWrites: true,
    requireApprovalForShell: true,
    workspaceBoundaryMode: "hard",
  },
  roles: [
    {
      name: "frontend",
      title: "Frontend Engineer",
      instructions: "Build and polish the UI.",
      workspaceScopes: ["apps/web"],
      tools: ["filesystem", "shell", "message"],
      channels: ["general"],
    },
    {
      name: "backend",
      title: "Backend Engineer",
      instructions: "Keep the backend simple and secure.",
      workspaceScopes: ["apps/api"],
      tools: ["filesystem", "shell", "message"],
      channels: ["general"],
    },
  ],
  agents: [
    { name: "Taylor", roleName: "frontend", personalityName: "thoughtful" },
    { name: "Sam", roleName: "backend", personalityName: "precise" },
  ],
});
```

## Defining Hierarchy

The `organizationChart` defines the reporting structure of your team. This is used by the orchestrator to resolve escalations and determine who has authority over whom during multi-step tasks.

```ts
import { createOrganizationChart } from "@ujima/framework";

const chart = createOrganizationChart(
  {
    "Taylor": "Sam", // Child: Parent
  },
  agents
);
```

## Governance & Safety

Ujima is built for autonomous action, which requires strong guardrails. The `policies` object controls how agents are allowed to interact with your system.

- **`requireApprovalForWrites`**: Agents must request human approval via the event bus before modifying any files.
- **`requireApprovalForShell`**: Agents must request approval before running commands in the shell.
- **`workspaceBoundaryMode`**: When set to `"hard"`, agents are strictly forbidden from reading or writing outside of their defined `workspaceScopes`.

## Workspace Isolation

Workspace scopes allow you to partition your codebase. Agents only see and act on the paths they are explicitly assigned to.

```ts
workspace: {
  root: ".",
  roleScopes: {
    "frontend": ["apps/web", "packages/ui"],
    "backend": ["apps/api", "packages/db"],
  }
}
```

## Extending the Team

You can define custom personalities and roles beyond the built-in presets:

```ts
import { defineRole, definePersonality } from "@ujima/framework";

const customRole = defineRole({
  name: "security-auditor",
  title: "Security Auditor",
  instructions: "Review every change for potential vulnerabilities.",
  tools: ["filesystem", "mcp"]
});

const customPersonality = definePersonality({
  name: "pedantic",
  instructions: "Correct every small detail, even if it doesn't affect functionality."
});
```

## Loading Teams

You can define your team in a standalone `.json` or `.ts` file and load it dynamically:

```ts
import { loadAgentTeamFromFile } from "@ujima/framework";

// Supports .json and .ts (via default export or 'team' export)
const team = await loadAgentTeamFromFile("./ujima.config.ts");
console.log(team.config.name); // "Ujima Sample Team"
```

## Build

```bash
bun --cwd packages/ujima run build
```

## Notes

- Keep the API typed, small, and explicit.
- Workspace-aware config should stay in this package, not spread across apps.
