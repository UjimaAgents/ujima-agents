# Ujima Agents

![Ujima Agents Banner](https://cdn.jsdelivr.net/npm/@ujima/agents@latest/assets/banner.png)

[![npm version](https://img.shields.io/npm/v/@ujima/agents.svg)](https://www.npmjs.com/package/@ujima/agents)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

**Ujima Agents** is a framework for building Slack-like teams of AI agents, with roles and workspace-bounded execution.

Define persistent agent members, assign roles, and work in channels — the same collaboration model as a team chat app, backed by a local runtime that enforces approvals and keeps every tool call inside your workspace root.

**Product surfaces** (via `@ujima/agents` on npm):

- **Web** — Slack-like UI for channels, DMs, mentions, approvals, and task runs
- **CLI** — Initialize your org and start the local API + web stack (`ujima init`, `ujima start`)
- **VS Code extension** — Same team in your editor (coming soon)

---

## Core Concepts

- **Organization** — Team with a name, workspace root, and persistent agent members
- **Roles** — Typed roles (`backend-engineer`, `frontend-engineer`, `code-reviewer`, `pm`, etc.) with system instructions, tool access, and workspace scope
- **Channels** — Named channels, threads, DMs, and private self-channels; agents respond when `@mentioned`
- **Task runs** — Focused work in dedicated `task-run` channels with visible progress; summaries link back to conversation
- **Approvals** — Sensitive actions (file writes, shell commands, git) gated behind human approval
- **Workspace Bounds** — All execution hard-sandboxed to your organization root
- **Skills** — Agents equipped with `SKILL.md` capabilities loaded into their context
- **Owner Sessions** — Onboarding creates durable owner credentials; returning restores your signed-in workspace

---

## Quick Start (npm)

**Prerequisites:** Node.js 20+ or Bun 1.3+, LLM API keys (Anthropic, OpenAI, DeepSeek)

```bash
npm install -g @ujima/agents
# or: bun add -g @ujima/agents

ujima init --name "Acme Engineering" --owner "Alex" --owner-email "alex@example.com" --owner-password "securepass123" --workspace "$(pwd)"
ujima start
```

Open **[http://localhost:3452](http://localhost:3452)** (web UI). API listens on **http://127.0.0.1:7511**.

---

## Provider API Keys

Pass keys at init (stored locally in daemon, never sent to web UI):

```bash
ujima init \
  --name "Acme Engineering" \
  --owner "Alex" \
  --owner-email "alex@example.com" \
  --owner-password "securepass123" \
  --workspace "$(pwd)" \
  --provider anthropic=sk-ant-... \
  --provider openai=sk-...
```

Or set via environment variables before `ujima start`:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `UJIMA_HOME` | `~/.ujima` | Data directory (token, SQLite, cache) |
| `UJIMA_TOKEN` | `$UJIMA_HOME/token` | Auth token for CLI ↔ API |
| `UJIMA_BIND_HOST` | `127.0.0.1` | API bind address |
| `UJIMA_PORT` | `7511` | API port |
| `WEB_PORT` | `3452` | Web UI port |
| `WEB_HOST` | `127.0.0.1` | Web UI bind address |

---

## `ujima init` Reference

```bash
ujima init [options]

Options:
  --name, -n           Organization name (required)
  --owner, -o          Owner display name (required)
  --owner-email, -e    Owner email address (required)
  --owner-password, -p Owner password, min 8 chars (required)
  --workspace, -w      Workspace root path (required)
  --config, -c         Path to ujima.config.ts (optional)
  --provider           Provider key: name=key (repeatable)
```

---

## Team Config (`ujima.config.ts`)

Create in workspace root or pass `--config`:

```typescript
import {createStarterAgentTeamConfig} from "@ujima/framework";

export const team = createStarterAgentTeamConfig({
  name: "Acme Product Team",
  workspaceRoot: process.cwd(),
  providers: {
    anthropic: {apiKeyRef: "ANTHROPIC_API_KEY"},
    openai: {apiKeyRef: "OPENAI_API_KEY"},
  },
  roles: [
    {
      name: "backend-engineer",
      title: "Backend Engineer",
      workspaceScopes: ["apps/api", "packages/shared"],
      tools: ["read_file", "write_file", "search_grep", "execute_command"],
      instructions: "Follow Clean Architecture. Write unit tests for all domain logic.",
    },
    {
      name: "code-reviewer",
      title: "Senior QA & Code Reviewer",
      workspaceScopes: ["."],
      tools: ["read_file", "execute_command"],
      instructions: "Analyze code diffs critically. Do not accept code with linting errors.",
    },
  ],
  agents: [
    {name: "Alex", roleName: "backend-engineer", personalityName: "direct"},
    {name: "Quinn", roleName: "code-reviewer", personalityName: "skeptical"},
  ],
  channels: [
    {name: "general", topic: "Company-wide alignment and announcements."},
    {name: "engineering", topic: "Technical syncs, code reviews, and test statuses."},
  ],
  policies: {
    requireApprovalForWrites: true,
    requireApprovalForShell: true,
  },
});

export default team;
```

---

## What's Next After `ujima start`

1. Open web UI at http://localhost:3452 — sign in with owner email/password from `init`
2. Invite team members — Settings → Members → Invite (magic link email)
3. Create channels — `#general` exists; add more via channel list or `/create-channel`
4. Mention agents — `@backend-engineer` in any channel to assign work
5. Run tasks — agents execute in task-run channels with live progress; approvals in sidebar

### Common Commands

```bash
ujima start --no-open                    # Start without opening browser
ujima update --check-only                # Check for updates only
ujima update --force                     # Force reinstall
UJIMA_PORT=8080 WEB_PORT=3000 ujima start  # Custom ports
UJIMA_HOME=/data/ujima ujima start       # Custom data directory
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `ujima init`: "no token found" | Run `ujima start` first to generate daemon token, then `init` |
| Port already in use | Change `UJIMA_PORT`/`WEB_PORT` or kill process on that port |
| Web UI won't load | Check `UJIMA_BIND_HOST`/`WEB_HOST` — use `0.0.0.0` for Docker/remote |
| Agent not responding | Verify agent is channel member; role has needed tools |
| Approvals not showing | Ensure `requireApprovalForWrites`/`requireApprovalForShell` are `true` |
| Lost owner session | Delete `$UJIMA_HOME/token` and re-run `ujima init` |

---

## Security Model

- **Secrets stay local** — Provider keys in local daemon; web UI/extension never store or transmit them
- **Workspace-bounded execution** — Filesystem, shell, git actions resolved under org `workspaceRoot`; path escapes rejected
- **Approvals** — Writes, shell commands, sensitive ops wait for confirmation in web UI/VS Code
- **Role scopes** — Restrict agents to subtrees for monorepo separation

---

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Web UI    │     │ VS Code Ext │     │    CLI      │
│  (Next.js)  │     │ (coming)    │     │ (@ujima/..) │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           ▼
              ┌────────────────────────┐
              │    API Daemon          │
              │  (Fastify + WebSockets)│
              └───────────┬────────────┘
                          ▼
              ┌────────────────────────┐
              │    SQLite DB           │
              └────────────────────────┘
                          ▼
              ┌────────────────────────┐
              │  Orchestrator + Runtime│
              │  (Agent execution)     │
              └───────────┬────────────┘
                          ▼
              ┌────────────────────────┐
              │  MCP Servers + LLMs    │
              │  (Anthropic, OpenAI,   │
              │   DeepSeek, etc.)      │
              └────────────────────────┘
```

---

## Source & Development

Full source and local dev setup in this repository.

## Contact

Questions: [@vincent_presh on X](https://x.com/vincent_presh) or [oluwaseyinexus137@gmail.com](mailto:oluwaseyinexus137@gmail.com)

## License

`@ujima/agents` npm distribution is licensed under [MIT](./LICENSE).