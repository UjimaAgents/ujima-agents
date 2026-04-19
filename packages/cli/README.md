# Ujima CLI

Local bootstrap and setup command for the Ujima stack.

The CLI will:
- create or load an organization
- prompt for the workspace root
- configure provider keys
- generate starter team config
- start the local API and web UI
- help attach the VS Code extension to the same backend

## Status

The CLI is scaffolded and will become the main local entrypoint after the backend boot flow is stable. It should wire into the onboarding flow that creates the human owner member and seeds the org chart.

## Install

From the monorepo root:

```bash
bun install
```

## Development Notes

- Keep the CLI opinionated and low-friction.
- Treat workspace selection as part of onboarding.
- Prefer wiring existing package primitives over duplicating setup logic.
