# @ujima/api

Local backend for Ujima.

This service will own:
- team loading and validation
- local persistence
- AI SDK orchestration
- `socket.io` realtime events
- approvals and audit logs
- workspace root enforcement
- tool and MCP policy checks

## Status

The backend is scaffolded and will be wired to `@ujima/shared` and `@ujima/framework` next.

## Install

From the monorepo root:

```bash
bun install
```

## Development Notes

- Keep the API local-first.
- Never expose provider secrets to the browser.
- Use the workspace root as a hard boundary for local execution.
- Keep orchestration centered around the AI SDK and Ujima policy layers.

