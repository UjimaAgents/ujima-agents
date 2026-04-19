# Ujima Web

Next.js UI for the local Ujima control plane.

The web app will provide:
- onboarding
- chat and channel views
- DMs and mentions
- approvals
- run streams
- settings for providers, roles, and workspace scope

## Status

This is the primary browser UI, but it is not the source of truth. It consumes the local API.

## Install

From the monorepo root:

```bash
bun install
```

## Development Notes

- Use existing UI primitives first.
- Keep the UI thin and driven by API contracts.
- Align all workspace actions with the org root selected during onboarding.

