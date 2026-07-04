@AGENTS.md

## Agent philosophy

- Prefer model intelligence over hand-coded agent behavior.
- Do not add heuristics, brittle rules, or special-case logic for agent decisions unless there is no other safe option.
- When the behavior involves what an agent should choose, shape the prompt, context, and information flow first.
- Treat emergence as the default design principle: give the model better context and constraints, then let it reason.
- Only add hard-coded behavior for safety, permissions, or platform limits — not to simulate judgment.
- Avoid “smart” fallback logic that encodes policy in code when the same outcome can come from better grounding.
