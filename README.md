# Ujima Agents

![Ujima Agents Banner](https://ujima-c3444.web.app/banner.webp)

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

**Prerequisites:** Node.js 20+ or Bun 1.3+, plus an LLM provider — either a hosted API key (Anthropic, OpenAI, DeepSeek) **or a local OpenAI-compatible server** (Ollama, vLLM, LM Studio, llama.cpp's server)

```bash
npm install -g @ujima/agents
# or: bun add -g @ujima/agents

# Terminal 1: Start the API daemon (generates auth token)
ujima start

# Terminal 2: Onboard your organization (uses the token)
ujima init --name "Acme Engineering" --owner "Alex" --owner-email "alex@example.com" --owner-password "securepass123" --workspace "$(pwd)"
```

Open **[http://localhost:3452](http://localhost:3452)** (web UI). API listens on **http://127.0.0.1:7511**.

> **Note:** `ujima start` runs in the foreground. Use two terminals, or run `ujima start &` in background.

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

## Local & self-hosted models

Ujima talks to any **OpenAI-compatible** endpoint, so your team can run on local
inference servers instead of (or alongside) hosted APIs. The flow is the same
for **Ollama**, **vLLM**, **LM Studio**, **llama.cpp's server**, or any remote
OpenAI-compatible service: start the server, then add it through the web UI as
a provider.

### Walkthrough — Ollama (easiest)

**1. Install Ollama and pull a model**

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh

# Start the daemon and pull a small model to try
ollama serve &
ollama pull qwen2.5:0.5b
```

Ollama listens on `http://127.0.0.1:11434` and exposes an OpenAI-compatible
endpoint at `/v1`. Confirm with:

```bash
curl http://127.0.0.1:11434/v1/models
```

**2. Wire it into Ujima**

Open `http://localhost:3452` → **Settings → Organization → Providers** → **Add**:

- **Provider**: Ollama
- **API key**: any string (Ollama doesn't validate it — `ollama` is fine)
- **Base URL**: `http://127.0.0.1:11434/v1`

Click **Test** — you should see "Connected".

**3. Assign it to an agent**

Go to **Settings → Organization → Agents**, edit any agent (or create a new
one), and set:

- **LLM provider**: Ollama
- **Model**: the dropdown queries your local Ollama and shows the actual tags
  you've pulled (e.g. `qwen2.5:0.5b`). Pick one.

Save, DM the agent, and you should get a response generated on your machine.

### Walkthrough — vLLM (production self-host)

**1. Start vLLM with an OpenAI-compatible name and an API key**

```bash
vllm serve <hf-repo-or-local-path> \
  --quantization awq \
  --served-model-name <short-name> \
  --api-key <your-bearer-token> \
  --host 127.0.0.1 \
  --port 8000
```

`--served-model-name` is what shows up in Ujima's Model dropdown — keep it
short and readable.

**2. Wire it into Ujima**

**Settings → Providers → Add**:

- **Provider**: Ollama (we use the same OpenAI-compat kind for any custom endpoint)
- **API key**: the Bearer token you passed as `--api-key`
- **Base URL**: `http://127.0.0.1:8000/v1`

Test the connection, then assign the model to an agent the same way as above.

### Notes

- Everything else (channels, approvals, workspace-bounded execution, MCP
  tools, role scoping) works identically against local models.
- You can mix and match — e.g. local Qwen for routine agents, Claude for
  your `code-reviewer`. Each agent picks its own provider + model in the
  edit modal.
- Discovery falls back to the static catalog if your server is offline or
  doesn't expose `/v1/models`, so the UI never gets stuck.

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
  --name, -n             Organization name (required)
  --owner, -o            Owner display name (required)
  --owner-email, -e      Owner email address (required)
  --owner-password, -p   Owner password, min 8 chars. Use -p - to prompt securely.
  --prompt-password      Prompt for password securely (hidden input)
  --workspace, -w        Workspace root path (required, must exist)
  --config, -c           Path to ujima.config.ts (optional)
  --provider             Provider key: name=key (repeatable)
```

### Secure password input

Avoid putting passwords in shell history:

```bash
# Prompt securely (hidden input)
ujima init --name "Acme" --owner "Alex" --owner-email "a@b.com" --prompt-password --workspace "$(pwd)"

# Or read from stdin
echo "securepass123" | ujima init --name "Acme" --owner "Alex" --owner-email "a@b.com" -p - --workspace "$(pwd)"
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

## What's Next After `ujima init`

1. Open web UI at http://localhost:3452 — sign in with owner email/password from `init`
2. Invite team members — Settings → Members → Invite (magic link email)
3. Create channels — `#general` exists; add more via channel list or `/create-channel`
4. Mention agents — `@backend-engineer` in any channel to assign work
5. Run tasks — agents execute in task-run channels with live progress; approvals in sidebar

### Common Commands

```bash
# First-time setup (two terminals):
# Terminal 1:
ujima start
# Terminal 2:
ujima init --name "Acme" --owner "Alex" --owner-email "a@b.com" --prompt-password --workspace "$(pwd)"

# Subsequent runs (single terminal):
ujima start --no-open                    # Start without opening browser
ujima start &                            # Run in background
UJIMA_PORT=8080 WEB_PORT=3000 ujima start  # Custom ports
UJIMA_HOME=/data/ujima ujima start       # Custom data directory
ujima update --check-only                # Check for updates only
ujima update --force                     # Force reinstall
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