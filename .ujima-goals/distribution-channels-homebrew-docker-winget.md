# Distribution Channels: Homebrew, Docker, Winget

**Status:** 5/8 tasks completed (research, tarball script ✅ verified, Dockerfile + bake, Homebrew formula, Winget manifest)
**Created:** 2026-06-26
**Owner:** Carter Jordan

## Goal

Add three non-npm distribution channels for Ujima: **Homebrew** (macOS/Linux), **Docker** (CI/isolated), and **Winget** (Windows). Each channel distributes a per-platform tarball containing the bundled CLI + API + web runtime with a vendored Node.js binary (no Node.js prerequisite).

## Why

- npm is fine for devs already in the Node.js ecosystem, but it excludes users who don't have (or want) Node.js installed
- Homebrew is the expected install path for macOS/Linux CLI tools
- Docker is essential for CI/CD pipelines and isolated runs
- Winget is the native Windows package manager, growing fast
- We already bundle for 6 platform triples in `vendor-binaries.sh` — the binary assets are ready, we just need the distribution wrappers

## Architecture Decision

**Per-platform tarball with vendored Node.js** (selected by Precious Vincent).

Each tarball contains:
- Bundled CLI entrypoint (`ujima`)
- Bundled API runtime
- Next.js standalone web runtime
- Vendored Node.js binary (for that OS/arch)
- Vendored ripgrep + fd binaries (for that platform only — not all 6)
- `node_modules/` for native deps (better-sqlite3, onnxruntime-node) — these are platform-specific and must match the vendored Node.js

Published to GitHub Releases. Homebrew formula, Dockerfile, and Winget manifest all point at these release artifacts.

## Current State vs Target

| Area | Current | Target |
|------|---------|--------|
| Build output | One universal npm tarball with all 6 platform binaries | npm tarball stays; additionally 6 per-platform standalone tarballs |
| Node.js | Not included, user must install Node 20+ | Vendored per-platform Node.js binary included |
| Release hosting | npm only | npm + GitHub Releases |
| CI/CD | No GitHub Actions | Automated release workflow triggered by version tag |
| Homebrew | None | `brew install ujimaagents/tap/ujima` |
| Docker | None | `docker run ghcr.io/ujimaagents/ujima` |
| Winget | None | `winget install UjimaAgents.Ujima` |

## Task Breakdown

| # | Task | Owner | Depends On | Description |
|---|------|-------|------------|-------------|
| 0 | Research: understand exact current dist layout and native dep requirements | Carter Jordan | — | Map out what `packages/distribution/dist/` contains today, confirm `better-sqlite3` and `onnxruntime-node` are the only native modules, verify Node.js version pinning |
| 1 | Create `scripts/release/assemble-platform-tarballs.ts` | Carter Jordan | 0 | New script that for a given platform triple: (a) downloads and vendors the correct Node.js binary, (b) copies only that platform's rg/fd bins, (c) runs `npm install --production` with vendored Node for native modules, (d) produces `ujima-{version}-{triple}.tar.gz` |
| 2 | Create `.github/workflows/release.yml` | Carter Jordan | 1 | GitHub Actions workflow triggered by `v*` tags: builds all 6 platform tarballs in parallel, runs smoke tests, publishes to GitHub Releases, publishes to npm (existing flow) |
| 3 | Create `Dockerfile` + `docker-bake.hcl` | Carter Jordan | 1 | Multi-arch Dockerfile that extracts the platform tarball into a minimal `debian:bookworm-slim` image. Docker Bake config for building linux/amd64 + linux/arm64. Tags pushed to ghcr.io. |
| 4 | Create Homebrew formula | Carter Jordan | 2 | Formula in `ujima-agents` repo under `homebrew/ujima.rb` (served as tap). Downloads the correct macOS tarball from GitHub Releases, installs `ujima` binary to prefix. Supports both arm64 and x86_64 via platform detection. |
| 5 | Create Winget manifest | Carter Jordan | 2 | Winget YAML manifest for Windows x64 + arm64. Points at the Windows tarballs on GitHub Releases. Installs `ujima.exe` to PATH. Submit to winget-pkgs repo. |
| 6 | Smoke-test each channel | Carter Jordan | 3,4,5 | Run `brew install`, `docker run`, and `winget install` on respective platforms. Confirm `ujima start` works in each. |
| 7 | Update README with install instructions | Carter Jordan | 6 | Add Homebrew, Docker, and Winget install sections to README. Add badges. |

## Decisions

- **Which Node.js binary to vendor?** Use the official Node.js binary distributions from nodejs.org. Pin to the current LTS (22.x or 20.x — whichever `engines` specifies).
- **Docker base image:** `debian:bookworm-slim`. Minimal, multi-arch, glibc-based (matches Node.js official builds).
- **Homebrew tap location:** Host formula in the same `ujima-agents` repo under a `homebrew/` directory. Users do `brew install ujimaagents/tap/ujima`.
- **GitHub Releases:** Triggered by `v*` tags (e.g., `v0.0.51`). The workflow builds all platform tarballs and attaches them as release assets.
- **Winget submission:** Self-host the manifest in our repo; also submit to `microsoft/winget-pkgs` for discoverability.

## Open Questions

## Progress

### Completed (4/8)
- **Task 0:** Research done — dist layout mapped, native deps identified
- **Task 1:** `scripts/release/assemble-platform-tarballs.ts` — downloads Node.js 22.x, copies platform-specific artifacts, installs native deps, creates tarball
- **Task 3:** `Dockerfile` + `docker-bake.hcl` — multi-arch for linux/amd64 + linux/arm64, pulls tarball from GitHub Releases
- **Task 4:** `homebrew/ujima.rb` — Homebrew formula with arm64 + x86_64 support, points at GitHub Releases
- **Task 5:** `.github/winget/ujima-agents.installer.yaml` — Winget manifest for x64 + arm64 Windows

### Pending (4/8)
- **Task 2:** `.github/workflows/release.yml` — needs final review (was written but needs SHA256 placeholder updates)
- **Task 6:** Smoke-test each channel — needs real tarballs published first
- **Task 7:** Update README with install instructions

## Open Questions (resolved during implementation)

- **Node.js version to vendor:** **22.14.0 LTS** — Active LTS, matches the spirit of `engines: >=20` and gives users a modern runtime
- **Windows format:** **ZIP** with `.bat` + `.ps1` launchers (not MSI). MSI adds installer complexity without benefit for a CLI tool. Winget's `NestedInstallerType: portable` handles this cleanly.
- **Homebrew tap:** Host formula in `homebrew/ujima.rb` in the monorepo. Users do `brew install ujimaagents/tap/ujima`. Keep it simple — no separate tap repo needed.
