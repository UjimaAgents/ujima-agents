# Goal: Emergence-first prompt/tool boundaries

## Overview
Audit the orchestrator’s runtime prompt and tool layers, then separate hard constraints from agent reasoning. The goal is to keep safety, permissions, and platform limits in code, while moving agent-choice behavior back into prompt/context design wherever possible.

## Decision
Ujima should prefer model intelligence over hard-coded agent behavior. Heuristics, brittle rules, and special-case logic should not be used to simulate judgment.

## Plan
1. Read the current runtime prompt construction and tool gating paths.
2. Classify each rule into one of three buckets:
   - keep in code for safety/platform limits
   - move into prompt/context
   - remove as a heuristic
3. Update the docs so the boundary is explicit in the repo’s agent instructions.
4. Verify the system still boots and the docs reflect the new rule.

## Tasks
- Audit runtime prompt/tool logic in orchestrator.
- Classify decision rules and produce a cleanup list.
- Update agent docs to reflect emergence-first boundaries.
- Verify the result and record follow-up items.

## Status
Planning complete. Ready to start implementation after board sync.
