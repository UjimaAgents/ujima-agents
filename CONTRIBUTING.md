# Contributing to Ujima Agents

Thanks for helping build Ujima Agents — a framework for Slack-like teams of AI agents, with roles and workspace-bounded execution.

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
- Keep the diff as small as possible. Aim for under 500 lines added; CI blocks PRs that **add more than 2000 lines** (insertions only — deletions and refactors do not count toward the limit; lockfiles and `.vsix` artifacts are excluded).

To check size locally before opening a PR:

```bash
BASE_SHA=origin/main HEAD_SHA=HEAD MAX_LINES=2000 bash .github/scripts/check-pr-size.sh
```

## Releasing

Releases are **tag-driven**. Day-to-day work still merges to `main`; npm publish happens only when a version tag is pushed.

### Version source of truth

[`packages/distribution/package.json`](packages/distribution/package.json) — workspace package `@ujima/distribution`; published to npm as **`ujima-agents`**.

### Prepare a release

1. Ensure `main` is green in CI.
2. Update [`CHANGELOG.md`](CHANGELOG.md) under `[Unreleased]` with user-facing notes.
3. Bump the distribution version and roll the changelog:

```bash
bun run release:prepare 0.2.0
```

4. Commit, tag, and push:

```bash
git add packages/distribution/package.json CHANGELOG.md
git commit -m "chore(release): v0.2.0"
git tag v0.2.0
git push origin main && git push origin v0.2.0
```

The tag **must** match the package version exactly (`v0.2.0` ↔ `"version": "0.2.0"`).

**Important:** Use a **`v` prefix** on the git tag (e.g. `v0.0.1`, not `0.0.1`). The [release workflow](.github/workflows/release.yml) only runs on `v*` tags; a GitHub “pre-release” checkbox alone does not publish to npm.

### CI publish

[`.github/workflows/release.yml`](.github/workflows/release.yml) runs on `v*` tags: validates the tag, runs tests, assembles `packages/distribution/dist` (compiled runtime only — no TypeScript sources), publishes to npm, and creates a GitHub Release with the VSIX attached.

Set the repository secret **`NPM_TOKEN`** (npm automation token with publish access to `ujima-agents`).

### Local checks

```bash
bun run release:check          # tag ↔ package.json (set TAG=v0.2.0 if not on a tag)
bun run release:dist             # assemble dist/
bun run release:smoke            # npm pack + install + ujima --help (+ API /health)
bun run release:smoke --skip-start   # skip API health probe
```

## Questions

If something in the scaffold feels unclear, open an issue or start a discussion before expanding the API surface.
