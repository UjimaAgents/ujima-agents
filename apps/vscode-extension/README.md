# Ujima VS Code Extension

Editor surface for the Ujima agent system.

The extension will provide:
- channel and DM views
- chat with agents
- agent messaging
- approvals
- run visibility
- workspace-aware actions inside the opened project
- agent and org identity visibility tied to the local backend

## Status

This is a thin client for the local backend, not a separate orchestration engine. It uses the same API contract as the web app.

## Install

From the monorepo root:

```bash
bun install
```

## Development Notes

- Keep the extension connected to the same local API as the web app.
- Do not duplicate backend policy or orchestration logic here.
- Keep all editor actions aligned with the selected workspace root.
