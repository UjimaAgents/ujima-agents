---
description: Use when building or fixing agents, tools, or orchestration, not for unrelated work.
alwaysApply: false
---

For **runtime agent persona and tone** (what models feel like in chat), see `SOUL.md` in this folder.

## Agent building principles

- Compose small, orthogonal capabilities with clear contracts; let richer behavior emerge from their interaction instead of one-off branches.
- Follow tight observe → decide → act → reflect loops; keep state explicit and diffable between steps.
- Prefer reusable primitives (search, read, write, lint, test, plan) over ad-hoc logic; extend by combining primitives, not by duplicating them.
- Build feedback into every step (assertions, traces, coverage, canaries) so new behaviors surface safely and regressions are caught early. Avoid bloated, low-value unit tests—not everything needs to be tested; keep the test suite reasonable, lean, and high-yield.
- Keep context external and auditable (docs, rules, prompts); never hardcode ephemeral knowledge or secrets.
- Guardrails first: scope mutations, respect permissions, avoid destructive commands, and make reversible changes by default.
- Optimize for user value and reliability before cleverness; simple, predictable flows beat speculative complexity.
- Design for graceful degradation: handle partial failures with retries, fallbacks, and checkpoints rather than stalling.
- Capture and generalize successful patterns into reusable skills so the system keeps improving with each change.

### When fixing agents or tools

- Reproduce with the smallest possible loop; gather traces and logs before editing.
- Trim scope to the failing interaction; prefer small, verifiable patches over sprawling refactors unless boundaries demand it.
- Prioritize high-impact, critical user paths. Keep tests focused and reasonable—only add or adjust tests that lock in key behaviors, avoiding brittle heuristics or testing trivial logic.

### Anti-patterns

- Hidden or implicit state, uncontrolled side effects, or undocumented assumptions.
- Adding special-case branches instead of improving primitives or contracts.
- Skipping safety checks or running destructive commands for convenience.
