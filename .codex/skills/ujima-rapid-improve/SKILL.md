---
name: ujima-rapid-improve
description: Rapid recursive improvement workflow for Ujima agent/runtime speed, approval correctness, and prompt-cache efficiency. Use when asked to benchmark Ujima, optimize agent loops, reduce token/tool latency, inspect .agent-loop logs, test approve once/always/family behavior, verify static prompt caching stability, simulate the real system locally, or iteratively patch and rerun tests until bottlenecks improve.
---

# Ujima Rapid Improve

Use this skill inside `/Users/mac/Documents/Work/Ujima_Agents`.

## Loop

Primary target: improve Ujima runtime, loop, approval, and harness behavior.
Do not spend effort tuning the smoke script itself unless it exposes a real Ujima bug.
Tests are for proof and regression lock only; they are not the optimization target.
Keep `.agent-loop` artifacts complete and information-rich; do not trim away useful turn data just to make files smaller.

1. Start the real daemon with loop logs enabled, using the user's auth/session from `.ujima`:
   - First check whether `bun run dev` is already running; prefer using that dev server because it also writes `.agent-loop` logs when launched with loop logging.
   - `UJIMA_AGENT_LOOP_LOGS=1 UJIMA_HOME="$HOME/.ujima" node packages/distribution/dist/cli.js start`
   - If a dev daemon is already running and `.agent-loop` files are updating, do not restart it.
   - If a dev daemon is running but no new `.agent-loop` files appear after a real wake, restart only when needed with `UJIMA_AGENT_LOOP_LOGS=1`.
2. Run a real prompt smoke:
   - `UJIMA_SESSION_TOKEN=<web-session-token> bun .codex/skills/ujima-rapid-improve/scripts/real-loop-smoke.ts`
   - Or: `UJIMA_EMAIL=<owner-email> UJIMA_PASSWORD=<owner-password> bun .codex/skills/ujima-rapid-improve/scripts/real-loop-smoke.ts`
  - If bootstrap points at the wrong org, add `UJIMA_ORGANIZATION_ID=<org-id>`.
  - Keep the smoke prompt anchored on the main loop files and tool rotation, not just tool count; repeated `view`/`grep` loops usually mean the prompt is too vague. Use the canonical dotted tool IDs (`channel.list`, `channel.read`, `memory.recall`, `procedure.list`, `self.procedure.list`, `skill.read`) instead of shorthand aliases.
   - This must use `$HOME/.ujima/token`, post one complex prompt to a real agent, let the normal wake path run, force 15+ actions and 10+ distinct tools, then inspect `.agent-loop`.
3. Run focused local guards:
   - `bunx vitest run packages/orchestrator/src/debug/agent-loop-logger.test.ts`
   - `bunx vitest run packages/orchestrator/src/services/approval.test.ts packages/shared/src/approval-scope.test.ts`
   - `bunx vitest run packages/orchestrator/src/utils/prompt-context.test.ts packages/orchestrator/src/utils/prompt-assembly.test.ts packages/orchestrator/src/utils/to-model-messages.test.ts packages/orchestrator/src/utils/run-transcript.test.ts packages/orchestrator/src/utils/system-prompt-builder.test.ts packages/ujima/src/prompts.test.ts`
   - `bun .codex/skills/ujima-rapid-improve/scripts/agent-loop-report.ts`
4. Identify one real Ujima bottleneck from the live loop or harness: token waste, slow tool, repeated tool, prompt bloat, approval stall, cache-busting prompt drift, stalled turn, or logger/bridge bug.
5. Patch the smallest causal path in Ujima code first. Remove dead fallback/duplication when touched. Only touch the smoke when it blocks truth or reveals the bottleneck.
6. Rerun real smoke + focused guards. Keep only changes that improve speed, tokens, tool count, or clarity.
7. Repeat until the next bottleneck is not worth the complexity.

## Measurement Rules

- Use `.agent-loop/*.json` as the primary trace source.
- Treat the smoke as a probe. Never optimize the probe before the product.
- A valid run must create new `.agent-loop` files from the live agent, not only unit-test temp logs.
- Treat one file as one agent turn. Do not aggregate by run group unless comparing whole-run totals.
- Compare before/after using:
  - total tokens
  - input/output tokens
  - tool count
  - slowest tool duration when present
  - wall time from timestamps
  - duplicate tool calls
  - approval requests/resolutions by scope
  - approve once vs approve always vs approve family retry behavior
  - static prompt prefix hash/shared-prefix stability
- Prefer local virtual simulation over live systems. Avoid production/network unless user approves.

## Real Smoke Requirements

- Use `scripts/real-loop-smoke.ts`; do not hand-roll curl unless fixing the script.
- Auth password is user-specific. Do not hardcode or persist it in this skill. Use `UJIMA_SESSION_TOKEN` when available, or use a per-run `UJIMA_EMAIL`/`UJIMA_PASSWORD` value explicitly provided by the user for that run.
- Login is org-scoped. If `/api/bootstrap` returns a different default org than the provided user, pass `UJIMA_ORGANIZATION_ID`; do not assume the bootstrap org owns the login email.
- If password-in-command escalation is rejected, ask the user for a session token or explicit approval to use the provided local login env for the smoke; do not waste time on DB session hashes.
- If ports `3452` or `7511` are already busy, assume the dev server may be intentional. Probe it with `/api/bootstrap` and run the smoke against it before killing anything.
- Only kill/restart a running server when the smoke proves it is stale, missing loop logging, or pointed at the wrong home/API.
- It must:
  - read `$HOME/.ujima/token`
  - authenticate with `UJIMA_SESSION_TOKEN`, or login using `UJIMA_EMAIL`/`UJIMA_PASSWORD`
  - call `GET /api/bootstrap`
  - choose a real active agent
  - send that agent a DM prompt
  - let Ujima's normal message wake path create/run the agent turn
  - stop polling when the agent stops producing new `.agent-loop` files; do not wait for the full timeout after the run has ended
  - require at least 15 model/tool actions
  - require at least 10 distinct tool names in `.agent-loop`
  - output bottleneck summary from new files only
- If it reports fewer tools/actions, improve the prompt or tool exposure first. Do not call the skill validated.
- Do not count `/api/tasks`, direct `/api/runs`, or unit tests as the real smoke. It must hit the conversation wake path that writes `.agent-loop`.
- `agent-loop-report.ts` skips empty/truncated logs and reports `skipped`; keep using valid new files only.
- A daemon warning `Unknown file extension ".ts" for ujima.config.ts` is config-sync noise unless it blocks bootstrap or wake.

## Approval Rules

- Track approvals as part of loop latency, not separate UX.
- Verify `allow_once` resumes only the current exact scope.
- Verify `allow_always` persists only exact grant scope.
- Verify `allow_family` covers same command/tool family without granting unrelated families.
- For approval bugs, start at `packages/orchestrator/src/services/approval.ts`, `packages/shared/src/approval-scope.ts`, and the UI caller that sends `allow_once | allow_always | allow_family | reject`.

## Prompt Cache Rules

- Static prompt caching means byte-stable reusable prefix across wakes.
- Keep wake-specific/user-runtime context after durable transcript/prefix.
- Sort prompt-visible collections deterministically.
- Do not solve cache misses by trimming history first. Fix order/duplication/drift first.

## Edit Rules

- Patch first-order cause only.
- Prefer deleting duplicated transforms, prompt sections, filters, wrappers, and stale compat.
- No broad safety layers, speculative fallbacks, or new abstractions unless they reduce real repeated cost.
- Tests only where they lock measured behavior.

## Done

Report:
- real smoke command/result
- bottleneck found
- files changed
- after command/result
- measured improvement or honest no-win
