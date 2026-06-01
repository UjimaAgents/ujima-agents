---
description: Use when building or fixing agents, tools, or orchestration, not for unrelated work.
alwaysApply: false
---

For **runtime agent persona and tone** (what models feel like in chat), see `SOUL.md` in this folder.

## Agent building principles

- Compose small, orthogonal capabilities with clear contracts; let richer behavior emerge from their interaction instead of one-off branches.
- Follow tight observe → decide → act → reflect loops; keep state explicit and diffable between steps.
- Prefer reusable primitives (search, read, write, lint, test, plan) over ad-hoc logic; extend by combining primitives, not by duplicating them.
- Build feedback into every step (assertions, traces, coverage, canaries) so new behaviors surface safely and regressions are caught early.
- Keep context external and auditable (docs, rules, prompts); never hardcode ephemeral knowledge or secrets.
- Guardrails first: scope mutations, respect permissions, avoid destructive commands, and make reversible changes by default.
- Optimize for user value and reliability before cleverness; simple, predictable flows beat speculative complexity.
- Design for graceful degradation: handle partial failures with retries, fallbacks, and checkpoints rather than stalling.
- Capture and generalize successful patterns into reusable skills so the system keeps improving with each change.

### When fixing agents or tools

- Reproduce with the smallest possible loop; gather traces and logs before editing.
- Trim scope to the failing interaction; prefer small, verifiable patches over sprawling refactors unless boundaries demand it.
- Prioritize high-impact, critical user paths.

### Testing discipline

Default: **do not add new tests.** Ship the fix, run the existing suite, move on.

Only add or adjust a test when one of these is true:

- The user explicitly asked for tests.
- You are fixing a regression that had no coverage, and a single focused test locks the contract in so it cannot silently regress again.
- You are introducing a new public contract (a tool, a service method, an API route) that has no existing coverage at all.

Do not add a test when:

- The change is a small guard, filter, or error-message refinement.
- The behavior is already exercised by an existing integration test downstream.
- The test would only restate the implementation (mocks calling mocks).
- You are tempted to add a test "to be thorough" — that is the signal to stop.

Prefer extending an existing test file over creating a new one. One sharp test beats five defensive ones. If a behavior is hard to test cheaply, that is usually a design signal, not a reason to add scaffolding.

### Anti-patterns

- Hidden or implicit state, uncontrolled side effects, or undocumented assumptions.
- Adding special-case branches instead of improving primitives or contracts.
- Skipping safety checks or running destructive commands for convenience.
