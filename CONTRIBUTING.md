# Contributing to Ujima Agents

Thanks for helping build Ujima Agents.

This repo is intentionally small in surface area and strict in design. We prefer direct implementations over abstractions, and we keep the shared contracts stable so the rest of the monorepo stays easy to reason about.

## Before You Start

- Use Bun for installs, scripts, and tests.
- Start with the package that owns the change.
- Keep edits focused and avoid unrelated cleanup.
- Prefer typed config and explicit exports.

## Suggested Work Order

1. `packages/shared`
2. `packages/ujima`
3. `apps/api`
4. `apps/vscode-extension`
5. `apps/web`
6. `packages/cli`

## Local Workflow

```bash
bun install
bun test packages/shared/index.test.ts
bun test packages/ujima/index.test.ts
```

If you touch package APIs, update the matching README in the same change.

## Code Style

- Keep the implementation simple and end-to-end.
- Do not add fallback branches, dedupe layers, or defensive abstractions unless they solve a real problem.
- Remove unused code instead of preserving entropy.
- Keep workspace and tool boundaries explicit.

## Pull Requests

- Explain what changed and why.
- Mention any user-facing impact.
- Include the commands you ran.
- Keep the diff as small as possible.

## Questions

If something in the scaffold feels unclear, open an issue or start a discussion before expanding the API surface.
