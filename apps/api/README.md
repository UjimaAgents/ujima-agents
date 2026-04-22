# @ujima/api

Local backend and runtime service for Ujima Agents.

This app owns onboarding, organization state, SQLite persistence, approvals, realtime events, tool execution, and AI orchestration. It is the source of truth for workspace boundaries and run execution.

## Build

```bash
bun install
bun --cwd apps/api run build
bun --cwd apps/api run typecheck
```

## Entry Points

- `src/main.ts` boots the server and prints startup status.
- `src/server.ts` builds the Fastify app.
- `src/transport/*` handles HTTP and realtime transport.
- `test/*` covers the API runtime behavior.

## Dependencies

The API is wired to the merged runtime packages, including `@ujima/agent-runtime`, `@ujima/api-schema`, `@ujima/client-sdk`, `@ujima/context-store`, `@ujima/event-bus`, `@ujima/llm`, `@ujima/mcp-client`, `@ujima/orchestrator`, `@ujima/permissions`, `@ujima/runtime-core`, and `@ujima/shared`.

## Notes

- Keep shell and file operations inside the workspace root.
- Provider secrets stay local.
- Do not move orchestration logic into the web app or extension.
