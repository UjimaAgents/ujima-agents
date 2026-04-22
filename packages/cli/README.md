# Ujima CLI

Command-line entry point for bootstrapping and local setup.

The CLI is the fast path for getting a workspace ready. It should make the project easy to start, easy to understand, and hard to misconfigure.

## What It Does

- creates or loads an organization
- prompts for the workspace root
- configures provider keys
- seeds a starter team config
- starts the local stack

## Why It Exists

An open-source agent stack needs a clear first command. The CLI gives people a low-friction path from clone to running system.

## Build

```bash
bun install
bun --cwd packages/cli run build
```

## Notes

- Keep the flow opinionated.
- Treat workspace selection as onboarding.
- Reuse existing package primitives instead of duplicating setup logic.
