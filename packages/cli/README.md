# Ujima CLI

Bootstrap and start the local Ujima stack.

The CLI initializes your org and runs `ujima start` so the web (Slack-like UI) and VS Code extension can connect to the same local API. It is not a third chat surface.

## What It Does

- creates or loads an organization
- prompts for the workspace root
- configures provider keys
- seeds a starter team config
- starts the local stack

## Why It Exists

`ujima init` and `ujima start` are the path from clone to a running team — web UI and extension ready to connect.

## Build

```bash
bun install
bun --cwd packages/cli run build
```

## Notes

- Keep the flow opinionated.
- Treat workspace selection as onboarding.
- Reuse existing package primitives instead of duplicating setup logic.
