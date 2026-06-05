# Ujima CLI

Bootstrap and start the local Ujima stack.

The CLI initializes your org and runs `ujima start` so the web (Slack-like UI) and VS Code extension can connect to the same local API. It is not a third chat surface.

## Commands

| Command | Description |
|---------|-------------|
| `ujima init` | Onboard organization, owner, and workspace |
| `ujima start` | Start the local API daemon and web UI |
| `ujima update` | Check for and install CLI updates |
| `ujima help` | Display help for a command |

## `ujima init`

Onboard a new organization against a running API.

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

Example:

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

## `ujima start`

Start the local API daemon and web UI (packaged or monorepo dev).

```bash
ujima start [options]

Options:
  --no-open   Do not open the browser after the web UI is ready
```

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `UJIMA_HOME` | `~/.ujima` | Data directory (token, SQLite, cache) |
| `UJIMA_TOKEN` | `$UJIMA_HOME/token` | Auth token for CLI ↔ API |
| `UJIMA_BIND_HOST` | `127.0.0.1` | API bind address |
| `UJIMA_PORT` | `7511` | API port |
| `WEB_PORT` | `3452` | Web UI port |
| `WEB_HOST` | `127.0.0.1` | Web UI bind address |

## `ujima update`

Check npm and install `@ujima/agents` updates.

```bash
ujima update [options]

Options:
  --check-only   Check without installing
  --force        Re-install even if up to date
```

Note: In monorepo development mode, `update` skips global self-update to avoid clobbering development builds. Run `bun run build` locally instead.

## Build

```bash
bun install
bun --cwd packages/cli run build
```