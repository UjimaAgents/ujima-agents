# Ujima Agents

![Ujima Agents Banner](./assets/banner.png)

[![npm version](https://img.shields.io/npm/v/ujima-agents.svg)](https://www.npmjs.com/package/ujima-agents)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

Ujima Agents is a local-first control plane and framework for building Slack-like teams of AI software development agents, with typed roles, workspace-bounded execution, approvals, realtime collaboration, agent messaging, and a local web, CLI, and editor experience.

## ✨ Features

- **Local-First & Secure:** Absolute control over AI execution—all orchestration, secrets, and agents reside on your machine or private infra.
- **Human-in-the-Loop by Default:** GUI-level approval gates block sensitive shell and filesystem actions without your explicit permission.
- **Slack-Like Mechanics:** Interact across group channels, threads, or DMs. Agents can message each other directly and retain cross-conversation memory as persistent virtual members.
- **Strict Workspace Bounds:** Hard-enforced sandbox directories prevent your agents from destructive traversal outside the organization boundary.
- **Typed Role & Skill Ecosystem:** Declarative TS configuration to bind presets, custom logic, and widely-available open source `SKILL.md` capabilities to specific agents.

## 🚀 Current State

The repo is in active build-out. The strongest pieces today are:
- `packages/shared`: shared schemas, socket event contracts, org charts, and workspace boundary helpers
- `packages/ujima`: the framework SDK for `AgentTeam`, role presets, provider/tool helpers, prompt composition, and loaders
- `apps/api`: the runnable backend for onboarding, persistence, messaging, approvals, realtime, and AI runs

## 🛠 Requirements

- Bun 1.3+
- Node-compatible editor support for TypeScript

## 📦 Install

```bash
bun install
```

## 🧩 Package Overview

### `packages/shared`
Shared runtime contracts used by every layer in the system.

Includes:
- domain schemas for organizations, org charts, members, channels, threads, messages, runs, approvals, and audits
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
- shared agent prompt composition
- workspace and loader utilities

See [`packages/ujima/README.md`](packages/ujima/README.md) for package API details.

### `apps/api`
Local backend for onboarding, persistence, policy enforcement, messaging, realtime events, approvals, and AI SDK-driven runs.

### `apps/web`
Next.js UI for chat, approvals, runs, settings, and onboarding.

### `apps/vscode-extension`
Editor surface for working with agent teams inside VS Code-compatible editors.

### `packages/cli`
Local bootstrap and setup CLI.

## 🧪 Working With The Packages

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

## 🧭 Suggested Development Order

1. Keep hardening `apps/api` as the backend foundation.
2. Wire `apps/web` and `apps/vscode-extension` to the same API.
3. Finish `packages/cli` once the boot flow is stable.

## 🤝 Notes For Contributors

- Use Bun for installs, scripts, and tests.
- Keep shared contracts small, explicit, and reusable.
- Prefer typed config and validation over loose runtime objects.
- Keep workspace path boundaries strict.
