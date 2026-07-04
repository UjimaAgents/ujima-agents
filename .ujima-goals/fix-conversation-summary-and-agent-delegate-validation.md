# Fix conversation summary prompt wiring and agent.delegate status validation

**Status:** in progress
**Owner:** Carter Jordan

## Goal

Fix two real bugs in orchestrator:
1. `conversation-summary.ts` still references a removed constant and does not pass the merged summary system prompt into the LLM calls.
2. `agent.delegate` status can succeed with no task id and return an empty result set instead of rejecting the call.

## Plan

1. Add regression coverage for the summary prompt wiring and missing-task-id validation.
2. Fix `extractSummary()` to pass the generated system prompt into both `streamText` and `generateText`.
3. Fix `agent.delegate` status validation so it throws when no task id(s) are provided.
4. Run the relevant test subset and the full verification pipeline.
5. Push the fix.

## Notes

- The summary bug is high severity because it is both a compile break and a logic break.
- The delegate bug is medium severity because malformed status calls look like successful no-ops.
- I am keeping the patch minimal and scoped to the two confirmed bugs.

## Progress

- [ ] Add regression tests
- [ ] Fix summary prompt wiring
- [ ] Fix delegate status validation
- [ ] Run tests / verify
- [ ] Push
