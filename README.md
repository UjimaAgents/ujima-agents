# Ujima Agents

![Ujima Agents Banner](./assets/banner.png)

[![npm version](https://img.shields.io/npm/v/ujima-agents.svg)](https://www.npmjs.com/package/ujima-agents)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

---

## What if you could run your agents as a team?

A real, persistent team — with names, roles, memory, and a shared workspace. Agents that message each other, wait for your approval, and stay in scope.

Ujima is a local-first control plane for running AI software teams. Setup and collaborate with your agents through a Slack-like web UI, a VS Code extension, or a CLI — all backed by the same local runtime.

---

## Core Concepts

**Organization** — your team has a name, a workspace root folder, and a set of members. Every agent is a persistent member of that org.

**Roles** — agents are assigned typed roles (`backend-engineer`, `frontend-engineer`, `code-reviewer`, `pm`, etc.) that determine their instructions, tool access, and workspace scope.

**Channels** — team communication happens in named channels, threads, and DMs. Agents respond when `@mentioned`; they don't spam every conversation.

**Approvals** — sensitive actions (file writes, shell commands, git mutations) are gated behind human approval. Nothing lands without your say-so.

**Workspace Bounds** — all agent execution is hard-sandboxed to your chosen org root. No traversal, no escape, no surprises.

**Skills** — agents can be equipped with open-source `SKILL.md` capabilities from the community, loaded directly into their context.

---

## Quick Start

```bash
# Install dependencies
bun install

# Start all services in dev mode
bun dev
```

Then open the web UI, complete onboarding, and select a workspace root folder. Your agents are ready.

> **Requires:** Bun 1.3+

---

## Use the framework to define your team

Ujima presents a simple API to define your team in code.

```ts
import { AgentTeam } from "@ujima/framework";

export const team = AgentTeam({
  name: "Acme Product Team",
  workspace: {
    root: "/absolute/path/to/your/project",
    roleScopes: {
      "frontend-engineer": ["apps/web"],
      "backend-engineer": ["apps/api"],
    },
  },
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY },
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
  },
  roles: ["backend-engineer", "frontend-engineer", "code-reviewer"],
  channels: ["general", "backend", "frontend"],
  policies: {
    requireApprovalFor: ["fileWrite", "shellExec", "gitMutate"],
  },
});

export default team;
```

---

## What's in the Monorepo

| Package | Purpose |
|---|---|
| `packages/ujima` | Framework SDK — `AgentTeam`, roles, personality presets, named agents, providers, tools, prompt composition |
| `packages/shared` | Shared schemas, socket event contracts, workspace path helpers, enums |
| `apps/api` | Local backend — onboarding, persistence, realtime, approvals, AI SDK run orchestration |
| `apps/web` | Next.js UI — channels, DMs, approvals, run activity, settings |
| `apps/vscode-extension` | Editor surface for agent chat, approvals, and run status inside VS Code and Cursor |
| `packages/cli` | `ujima` CLI for bootstrap and local setup |

---

## Security Model

- **Secrets stay local.** Provider API keys live only in the local backend. The browser and extension never see them.
- **Workspace root is the boundary.** Every filesystem, shell, and git action is validated against the org root before execution. Traversal attempts are rejected outright.
- **Approvals are definable.** You can define which tools require approval before execution.
- **Per-role path scopes.** Individual roles can be further restricted to specific subdirectories inside the org root.

---

## Development

Run tests against individual packages while iterating:

```bash
bun test packages/shared/index.test.ts
bun test packages/ujima/index.test.ts
```

Key source files to know:

```
packages/shared/src/schemas.ts    # Domain schemas
packages/shared/src/events.ts     # Socket event contracts
packages/shared/src/paths.ts      # Workspace path safety

packages/ujima/src/team.ts        # AgentTeam config
packages/ujima/src/agents.ts      # Named agents
packages/ujima/src/roles.ts       # Role presets
packages/ujima/src/personality.ts # Personality presets
packages/ujima/src/tools.ts       # Tool definitions
packages/ujima/src/providers.ts   # Provider helpers
packages/ujima/src/loaders.ts     # Config loaders
```

---

## Contribution Guidelines

- Use **Bun** for all installs, scripts, and tests.
- Keep shared contracts **small, typed, and explicit** — the schema layer is load-bearing.
- Workspace path boundaries are **non-negotiable** — never relax the sandboxing logic.
- Prefer **declarative config and schema validation** over loose runtime objects.
- Open a discussion before large architectural changes.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide.

---

## Project Status

Ujima is in active early development. The foundation is solid:

- ✅ `packages/shared` — schemas, events, path helpers
- ✅ `packages/ujima` — framework SDK and role system
- ✅ `apps/api` — backend runtime, messaging, approvals, realtime, AI runs
- 🔧 `apps/web` — UI wiring in progress
- 🔧 `apps/vscode-extension` — editor surface in progress
- 🔧 `packages/cli` — bootstrap CLI pending stable boot flow

---

## License

[MIT](./LICENSE)
