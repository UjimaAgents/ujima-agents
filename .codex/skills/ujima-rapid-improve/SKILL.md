---
name: ujima-rapid-improve
description: Find and fix bugs in the Ujima agent harness by sending real tasks to live agents, inspecting .agent-loop logs for correctness failures, patching the runtime, and re-verifying. Use when asked to improve Ujima itself, debug agent-loop issues, fix stalled/broken turns, hunt approval bugs, fix tool routing, or validate harness correctness.
---

# Ujima Rapid Improve

Use this skill inside `/Users/mac/Documents/Work/Ujima_Agents`.

## Loop

Primary target: find and fix **bugs in the Ujima harness** — the agent runtime, loop, approval system, tool routing, wake path, bridge, and logger. Do not optimize tests or benchmarks. Do not chase synthetic metrics.

1. **Start or connect** to a dev daemon with loop logging:
   - Check if `bun run dev` is running and writing `.agent-loop` files. If so, use it.
   - Otherwise: `UJIMA_AGENT_LOOP_LOGS=1 UJIMA_HOME="$HOME/.ujima" node packages/distribution/dist/cli.js start`
   - If a dev daemon is running but no new `.agent-loop` files appear after a real wake, restart with `UJIMA_AGENT_LOOP_LOGS=1`.

2. **Send a diagnostic prompt** to a real agent:
   - `UJIMA_SESSION_TOKEN=<token> bun .codex/skills/ujima-rapid-improve/scripts/agent-loop-smoke.ts`
   - The script picks a random harness area each run (multi-turn, approval, error-recovery, tool-routing, rapid-calls, or wake) and crafts a prompt to exercise that area. Run it multiple times to cover different harness paths.
   - The smoke script authenticates, selects an active agent, sends the prompt, polls for `.agent-loop` files, and outputs the paths plus which area and prompt it chose.

3. **Inspect `.agent-loop` for bugs**:
   - `bun .codex/skills/ujima-rapid-improve/scripts/agent-loop-bughunt.ts [file...]`
   - When run without arguments, scans all `.agent-loop/*.json` files.
   - When given specific paths (from step 2), scans only those.
   - Reports every bug with type, severity, file, turn index, and evidence.

4. **Hunt specific bug categories** (not just what the script finds — also manually inspect):
   - **Stalled turns**: a turn started but never produced steps or finished.
   - **Dropped tool results**: tool calls logged but no matching results. The bridge lost them.
   - **Orphan tool results**: results without a preceding call. Desync in the loop state machine.
   - **Tool call errors**: tools that returned error objects. Did the harness surface the error to the model or silently swallow it?
   - **Approval deadlocks**: approval requested but never resolved (no allow/reject logged). The turn hangs forever.
   - **Wake failures**: the message was received but no `.agent-loop` turn file was ever created. The wake path broke silently.
   - **Loop panic**: a turn file that ends abruptly mid-step with no `finishedAt`. The runtime crashed or threw unrecoverably.
   - **Duplicate tool routing**: the same tool invoked twice with identical params in the same step. Redundant bridge dispatch.
   - **Missing required log fields**: steps without `tokenUsage`, `timestamps`, `toolCalls`, or `toolResults` that should have them.
   - **Gap in turn sequence**: turn indices 0, 1, 3 — where is 2? Did the runner skip or lose a turn?
   - **Bridge-level errors**: tool names prefixed with internal routing prefixes that leaked into the agent's view.
   - **Stale agent selection**: the agent never woke (no loop files at all). Bootstrap returned an agent but the wake message didn't trigger a run.

5. **Patch the bug** in Ujima code:
   - Start at the causal file: `packages/agent-runtime/src/ai-sdk-loop.ts`, `packages/llm/src/codex-responses.ts`, `packages/llm/src/select.ts`, `packages/orchestrator/src/services/approval.ts`, `packages/orchestrator/src/debug/agent-loop-logger.ts`, `packages/shared/src/approval-scope.ts`, or the bridge/tool router.
   - Patch the smallest causal path. Remove dead fallback/duplication when touched.
   - Add a focused unit test that locks the fix.
   - Do not add broad safety layers, speculative fallbacks, or new abstractions.

6. **Rerun** steps 2–3 to verify the bug is gone and no new bugs appeared.

7. **Repeat** until no harness bugs are worth fixing.

## Bug Detection Script Rules

- Treat every `.agent-loop` file as a trace of the harness's internal state machine at one turn boundary.
- A valid run must create new `.agent-loop` files from the live agent, not only unit-test temp logs.
- The bughunt script must be deterministic: same input files → same output report.
- Do not count tools/actions as a quality metric. A run with 10 tools and 0 bugs is better than 50 tools and 3 bugs.
- Report false positives as `severity: info` with a note about why it might be valid. Do not silently filter them.

## Diagnostic Prompts

The prompt sent by `agent-loop-smoke.ts` should be tuned to the harness area you're hunting:

| Harness Area | Prompt Strategy | Example Snippet |
|---|---|---|
| Multi-turn loop stability | Long chain, many tool dependencies | "List files, read the 3 largest, summarize each, then search for todos" |
| Approval correctness | Write + delete with varied scopes | "Create a temp file, then delete it, then create another" |
| Tool routing | Cross-category switching per step | "List channels, then recall memory, then grep for a pattern, then read the match" |
| Error recovery | Invalid operations mixed with valid | "Read missing.txt, then read package.json, then delete missing2.txt, then write report.md" |
| Wake reliability | DM to agent, check if turn 0 appears | Any prompt, check for 0 loop files |
| Approval scoping | Nested or sequential approvals | "Create file A, then modify file A, then create file B" |
| Bridge reliability | Many rapid tool calls | "Read every .ts file in packages/agent-runtime/src" |

## Approval Bug Hunt

- `allow_once` should resume only the exact scope. Verify: after granting, does the next approval prompt a new dialog or auto-resume a different scope?
- `allow_always` should persist only the exact grant scope. Verify: does a similar-but-different scope auto-resolve?
- `allow_family` should cover the same command/tool family. Verify: unrelated families don't get a free pass.
- Check `packages/orchestrator/src/services/approval.ts` and `packages/shared/src/approval-scope.ts` for scope-matching bugs.

## Manual Investigation

When the bughunt script flags something suspicious, read the raw `agent-loop/*.json` file and trace through the turn's `steps[]` array. Look for:

- A step with `toolCalls` but no `toolResults` in the next step — the bridge probably dropped them.
- A step with `toolResults` whose indices don't match `toolCalls` — a desync.
- A `tokenUsage` object that goes backwards (fewer tokens than the previous turn).
- A `timestamps.finishedAt` that is before `timestamps.startedAt`.
- Any step with a `status` field that is not `success` or `complete`.

## Edit Rules

- Patch first-order cause only.
- Prefer deleting duplicated transforms, prompt sections, filters, wrappers, and stale compat.
- No broad safety layers, speculative fallbacks, or new abstractions unless they reduce real repeated cost.
- Add unit tests that lock the measured bug fix.

## Done

Report:
- diagnostic prompt used
- bug(s) found (type, file, turn, evidence)
- files changed to fix
- rerun result (bug gone? new bugs?)
- honest assessment: is the harness healthier?
