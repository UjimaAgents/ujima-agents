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

## Build

```bash
bun --cwd packages/ujima run build
```

## Notes

- Keep the API typed, small, and explicit.
- Workspace-aware config should stay in this package, not spread across apps.
