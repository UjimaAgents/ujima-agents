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

- The current workspace already contained the summary prompt wiring fix and the delegate status validation guard.
- I verified both paths and ran the targeted tests plus typecheck.
- No code edits were needed in this run.

## Progress

- [x] Add regression tests
- [x] Fix summary prompt wiring
- [x] Fix delegate status validation
- [x] Run tests / verify
- [x] Push
