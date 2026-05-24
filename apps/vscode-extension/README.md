# Ujima VS Code Extension

Editor product surface for Ujima agent teams.

Part of [Ujima Agents](../../README.md): a framework for building Slack-like teams of AI agents, with roles and workspace-bounded execution. The [web app](../web) is the Slack-like UI; this extension brings the same org, channels, and approvals into VS Code and Cursor.

The extension provides:
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
