# ADR 0006 — The web app's API seam lives in apps/web resource modules, not packages/client-sdk

- **Status:** Accepted (2026-08-21)
- **Supersedes:** none
- **Related:** architecture review 2026-08-21 (candidate E)

## Context

The dashboard makes ~68 raw same-origin `fetch` calls across 23 API path prefixes, with error-shape extraction (`body.message`) copy-pasted at 8+ sites and zod parsing applied ad hoc per call site. A purpose-built client exists — `packages/client-sdk` — but it is shaped for external daemon consumers: bearer-token auth, absolute base URLs, no cookie sessions, no Next.js basePath awareness, ~12 endpoints, no response validation. It has zero imports from `apps/web`. Separately, raw fetches ignore `NEXT_PUBLIC_SITE_BASE_PATH`, so any deployment under a non-empty site basePath would break every API call.

## Decision

Grow `apps/web/src/lib/client-api.ts` into per-resource modules (conversations, runs, approvals, workflows, settings, …) that own URL construction, zod parsing via `@ujima/api-schema`, error extraction, and central basePath handling. Components consume resource modules only — no component builds URLs or parses error bodies itself. `packages/client-sdk` remains the external-integration client and gains no web-app duties.

## Why not adopt client-sdk for the web app

Wrong auth model (bearer token vs same-origin cookie session), absolute-URL assumption vs relative paths under a configurable basePath, and a surface that covers a fraction of the workspace API. Reshaping it to serve both audiences would couple external and internal wire contracts — the opposite of ADR 0002 principle 9's discipline. Two adapters justify the seam where it now lives: the browser fetch in production and fixture fakes in tests.

## Consequences

New endpoints add one function to one resource module instead of another raw fetch. If external and internal clients ever converge, moving the resource modules under `packages/` is mechanical; nothing else references their location.
