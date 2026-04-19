# Ujima Agents

Ujima Agents is a local-first control plane and framework for building Slack-like teams of AI software development agents, with typed roles, workspace-bounded execution, approvals, realtime collaboration, and a local web, CLI, and editor experience.

The project is structured as a Bun monorepo with:
- a typed framework package for defining agent teams in code
- shared contracts for schemas, events, and workspace safety
- a local API for orchestration, approvals, persistence, and realtime updates
- a Next.js web UI
- a VS Code extension
- a CLI for bootstrapping and running the local stack

## Current State

The repo is in active scaffold mode. The strongest pieces today are:
- `packages/shared`: shared schemas, socket event contracts, and workspace boundary helpers
- `packages/ujima`: the framework SDK for `AgentTeam`, role presets, provider/tool helpers, and loaders

The app layers are scaffolded and will be wired to these packages next.

## Requirements

- Bun 1.3+
- Node-compatible editor support for TypeScript

## Install

```bash
bun install
```

## Package Overview

### `packages/shared`
Shared runtime contracts used by every layer in the system.

Includes:
- domain schemas for organizations, members, channels, messages, runs, approvals, and audits
- `socket.io` event names and payload schemas
- workspace path safety helpers
- shared defaults and enums

See [`packages/shared/README.md`](packages/shared/README.md) for package API details.

### `packages/ujima`
The framework SDK users install to define an agent team in code.

Includes:
- `AgentTeam(...)`
- starter team config generation
- role presets
- provider/tool helpers
- workspace and loader utilities

See [`packages/ujima/README.md`](packages/ujima/README.md) for package API details.

### `apps/api`
Local backend for orchestration, persistence, policy enforcement, realtime events, and AI SDK-driven runs.

### `apps/web`
Next.js UI for chat, approvals, runs, settings, and onboarding.

### `apps/vscode-extension`
Editor surface for working with agent teams inside VS Code-compatible editors.

### `packages/cli`
Local bootstrap and setup CLI.

## Working With The Packages

Run package tests directly while iterating:

```bash
bun test packages/shared/index.test.ts
bun test packages/ujima/index.test.ts
```

If you are editing the framework package, start here:
- `packages/shared/src/schemas.ts`
- `packages/shared/src/events.ts`
- `packages/shared/src/paths.ts`
- `packages/ujima/src/team.ts`
- `packages/ujima/src/roles.ts`
- `packages/ujima/src/tools.ts`
- `packages/ujima/src/providers.ts`
- `packages/ujima/src/loaders.ts`

## Suggested Development Order

1. Finish `apps/api` around the shared contracts.
2. Wire `apps/vscode-extension` to the same backend.
3. Wire `apps/web` to the API.
4. Finish `packages/cli` once the boot flow is stable.

## Notes For Contributors

- Use Bun for installs, scripts, and tests.
- Keep shared contracts small, explicit, and reusable.
- Prefer typed config and validation over loose runtime objects.
- Keep workspace path boundaries strict.
