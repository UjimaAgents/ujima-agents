# Procedures as Culture — design spec

**Status:** Draft, council-reviewed
**Author:** Architecture council (synthesised)
**Date:** 2026-05-24

## TL;DR

Today we ship per-agent procedures (Bet 7). Extend the same primitive to two more scopes — **org** and **channel** — so the team encodes how it works *as culture in the product*. Humans curate org and channel culture; agents self-edit only their own. A handful of org entries can be marked `enforced: true` (LAW) for hard safety lines. The channel-scope is the actual product wedge; org is table-stakes that follows naturally.

In the UI: **Workspace Culture** (org) and **Channel Culture** (channel). The word "Memory" stays reserved for the agent's recall of people and facts — keeping the user-facing distinction crisp.

## Why

Procedures today are per-agent markdown files in `ai/memory-bank/agents/<id>/procedures/<slug>.md` with YAML frontmatter. They work — but they're sprawling because everything procedural-ish gets dumped into them.

The reframe: **procedures aren't memory, they're culture.**

- *Memory* = what an agent knows about a person (preferences, facts, history).
- *Culture* = how a team agrees to work — the company's voice, etiquette, attribution norms, safety lines.

Once split that way, three scopes emerge cleanly. (Role was considered and dropped — it has no natural addressing key separate from agent, and `team.config.role.instructions` already covers the half of it that's load-bearing.)

## The three scopes

| Scope | UI label | What lives here | Who edits | Example |
|---|---|---|---|---|
| **Org** | Workspace Culture | Universal cultural norms across the workspace | Org admin (human) | "Never share customer data in chat." "Decisions attributed with @decided-by." |
| **Channel** | Channel Culture | Cultural norms for this specific channel | Channel admin (human) | `#incident-response`: pages stay open until RCA is posted. `#design-review`: never approve without checking dev specs. |
| **Agent** | (no human-facing tab; read-only profile view) | Personal style the agent learned | The agent itself, via `self.procedure.*` | "Layla learned Phoebe needs artifact paths explicitly mentioned." |

The load-bearing rule: **humans curate org and channel; agents self-edit only their own**. That constraint preserves trust — an agent cannot rewrite the team's culture by calling a tool.

The product distinction is **channel-as-opinionated-substrate** — competitors are single-agent (Bridge, Mem0, Hermes); ujima is multi-agent with channels. Channel Culture turns each channel into a place with its own personality that all agents joining it inherit. That's the wedge.

## Data model

No new tables for procedure bodies. Two more folders under the existing `ai/memory-bank/` convention. Frontmatter mirrors what `self.procedure.*` already uses.

```
ai/memory-bank/
├── org/procedures/<slug>.md              # NEW
├── channels/<channel-id>/procedures/<slug>.md # NEW
└── agents/<agent-id>/procedures/<slug>.md # exists (Bet 7)
```

Frontmatter (all three scopes share the shape):

```yaml
---
name: attribute-decisions
description: Tag durable decisions with the deciding member.
created_at: 2026-05-24T10:00:00Z
created_by: oluwaseyi-ajadi          # human user OR self.<agent-id>
updated_at: 2026-05-24T10:00:00Z
updated_by: oluwaseyi-ajadi
version: 3
enforced: false                      # org-only flag; LAW when true (max 2-3 per org)
---
When you make a decision that affects future work,
include "decided-by: @<your-name>" in the message.
```

One small new table — **`procedure_revisions`** — is required so the UI can render version history without shelling out to git:

```sql
CREATE TABLE procedure_revisions (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  scope           TEXT NOT NULL,        -- 'org' | 'channel' | 'agent'
  scope_id        TEXT NOT NULL,        -- '' for org; channel_id; agent_id
  name            TEXT NOT NULL,        -- procedure slug
  version         INTEGER NOT NULL,
  body_snapshot   TEXT NOT NULL,
  description     TEXT NOT NULL,
  updated_by      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_procedure_revisions_lookup
  ON procedure_revisions(organization_id, scope, scope_id, name, version DESC);
```

Append-only. Written on every save. UI reads from it for the version-history pane.

## Wake-time aggregation

The procedures section in `buildCacheableSystem` becomes:

```
Workspace Culture — applies to everyone in this org
Channel Culture — applies in this channel
Your own procedures — what you have learned
```

Bodies are NOT loaded into the prompt. Only one-line `name: description` summaries. Bodies load on demand via `procedure.view(name)`.

Prefixed once at the top of the section (Anthropic's recommendation to prevent the freeze on contradictory layers):

> *"These are guidelines. When two conflict, pick the more specific scope and continue. Items marked LAW are non-negotiable."*

### Token budget (hard cap)

| Layer | Max bytes | Approx procedures |
|---|---|---|
| Org | 750 | 5-7 |
| Channel | 750 | 5-7 |
| Agent | 500 | 3-5 |
| **Total** | **2,000** | **13-19** |

Conservative on purpose. We can grow later; we cannot shrink without breaking established procedures.

When a layer overflows, oldest entries truncate first. The admin UI surfaces a "you're over budget" warning before save. The cache-stability lint asserts total procedure bytes ≤ 2KB on every simulated wake.

### Zone 1 ordering

Critical detail from prompt-engineering review — the scaffold MUST stay last for recency advantage. The system prompt assembles in this order:

```
1. baseSystem (role identity, organization context)
2. LAW (org procedures with enforced: true) — rendered as "LAW (do not violate): <body>"
3. MEMORY_GUIDANCE / PROCEDURES_GUIDANCE
4. Procedures section (workspace culture + channel culture + own procedures)
5. goalSuffix (task-session goal if any)
6. BASE_WAKE_SCAFFOLD (decision tree — must be last)
```

Procedures live in Zone 1 (cacheable) and sort by `name` (not `createdAt`) so any reorder doesn't bust the prefix cache. Write-time normalisation strips trailing whitespace and CRLF so editor-induced byte changes don't bust cache silently.

## Conflict policy

**Additive, not override.** All applicable scopes' procedures apply simultaneously. If two contradict, the agent treats it as ambiguity and asks via `channel.reply` or `channel.pass(reason: 'needs-clarification')`. The prelude line ("pick the more specific scope and continue") shortcuts the freeze.

The exception: **org procedures marked `enforced: true` are LAW**. They cannot be violated even if a lower scope's procedure pulls the other way. Rendered at the top of Zone 1 above all other procedures so the model sees them first. Cap at 2-3 per org — reserved for safety / compliance ("never share customer data", "no shell commands without approval").

Without `enforced`, the layered design is a culture-vibes feature; with it, it's a safety primitive.

## Security boundary

The current tool surface only exposes `self.procedure.*` to agents — but agents also have `write`, `edit`, `multiedit`, and `shell`. Nothing stops them from clobbering `ai/memory-bank/org/procedures/<slug>.md` directly.

**Add a filesystem path-prefix guard** in the workspace write tools (`write` / `edit` / `multiedit` / `shell`): reject any agent-initiated write to:

- `ai/memory-bank/org/**`
- `ai/memory-bank/channels/**`
- `ai/memory-bank/agents/<not-self>/**`

Agents may only write to their own subtree under `ai/memory-bank/agents/<self>/**`. The guard belongs next to the existing `assertWorkspaceBoundary` + `isSensitiveWorkspacePath` checks.

## FTS exclusion

`workspace_files_fts` indexes everything under `ai/memory-bank/**` for `channel.recall(scope: 'files')`. Procedures must NOT surface there:

- **Org procedures**: leakage between orgs is the worry — already prevented by `organizationId` filter in `searchWorkspaceFiles`, but procedures should still not appear in artifact recall.
- **Channel procedures**: leakage between channels of the same org is the real risk. An agent in `#engineering` should never see `#legal`'s culture entries via `channel.recall`.
- **Agent procedures**: another agent should not surface my procedures via recall.

**Implementation:** the workspace-files indexer skips any path under `ai/memory-bank/{org,channels,agents}/**/procedures/`. Procedures are loaded only by the wake-time aggregator, which knows the current channel + agent id and reads the right folders directly. They are a system of record, not a recall artifact.

## Tool surface

```
# Agent-only writes (existing — keep)
self.procedure.add({name, description, body})
self.procedure.remove({name})

# Cross-scope reads (renamed — drop the `self.` prefix)
procedure.list({scope?: 'all' | 'org' | 'channel' | 'agent'})
procedure.view({name, scope?})

# NOT a tool — humans only, via UI
# Org and channel writes never expose an agent-callable tool.
```

The agent tool surface stays minimal. Reads are unified across scopes so the agent can audit its full effective rule set; writes are scope-segregated by who's allowed to make them.

## UI placement

Each scope maps to an existing surface in the present frontend:

| UI location | Scope | Behaviour |
|---|---|---|
| **Settings → Organization → Workspace Culture** (new tab) | Org | Full CRUD: add, edit, disable, version history. `enforced: true` toggle gated to org-owner role. |
| **Channel header → Channel Culture** (new tab next to Conversation / Members / Approvals / Tasks / Files / Activity) | Channel | Same editor component as Workspace Culture, scoped to the channel. Starter-pack picker on empty state. |
| **Profile page → Procedures section** (read-only) | Agent | Browseable list of what the agent has self-edited. Humans can disable an entry; only the agent's own tool writes new ones. |

The Channel Culture tab is the new UI element that changes the product feel. Right now channel header tabs are limited to conversation flow + audit views. A culture tab makes the channel an opinionated workspace with house personality that survives across agent membership changes.

### Where it lives in the present frontend

Concrete file and route references so engineers can start without re-discovering the layout:

**Workspace Culture** — new tab inside Settings → Organization
- **Route**: `/settings/organization` (already exists, see [apps/web/src/app/settings/organization/page.tsx](apps/web/src/app/settings/organization/page.tsx))
- **Tab registration**: extend `SettingsTabId` + `NAV_GROUPS` in [apps/web/src/features/settings/organization/components/organization-settings.tsx](apps/web/src/features/settings/organization/components/organization-settings.tsx) — add `"culture"` to the union, mount it in the existing **Workspace** nav group next to `General` / `Workspaces` / `Policies`
- **New component**: `apps/web/src/features/settings/organization/components/culture-tab.tsx` — modelled on the existing `policies-tab.tsx` (similar CRUD shape; humans only)
- **New API routes**: `apps/web/src/app/api/settings/culture/route.ts` (list + create); `apps/web/src/app/api/settings/culture/[name]/route.ts` (read, update, disable, history)
- **Backend handler**: `apps/api/src/transport/routes/org-culture.ts` (mirrors `channel-tasks.ts` / `channel-goals.ts` pattern), wired in `apps/api/src/transport/server.ts`

**Channel Culture** — new tab in the channel header
- **Route**: channel view is `/workspace?channelId=...` (already exists, see [apps/web/src/app/workspace/page.tsx](apps/web/src/app/workspace/page.tsx))
- **Tab registration**: extend `CHANNEL_TABS` in [apps/web/src/features/workspace/components/channel-view.tsx](apps/web/src/features/workspace/components/channel-view.tsx) — add `{ id: "culture", label: "Culture" }` between `Tasks` and `Files`
- **New component**: `apps/web/src/features/workspace/components/channel-culture-tab.tsx` — same editor component as Workspace Culture, scoped to one channel id
- **New API routes**: `apps/web/src/app/api/channels/[id]/culture/route.ts` (list + create); `apps/web/src/app/api/channels/[id]/culture/[name]/route.ts` (read, update, disable, history)
- **Backend handler**: `apps/api/src/transport/routes/channel-culture.ts` — same shape as the new org route, scoped by channelId

**Agent procedures view** — section on the agent's profile page
- **Route**: `/profile` for the current human user; agent profiles surface inside the workspace sidebar (see [apps/web/src/features/workspace/components/sidebar/](apps/web/src/features/workspace/components/sidebar))
- For v1: a read-only "Procedures" section on the human's `/profile` page showing procedures the *agents the human manages* have self-written — keeps it simple. Per-agent profile cards (a click-through from the sidebar's Agents list) can come later.
- **Reuses**: the same list component the cross-scope `procedure.list` tool returns; no editor UI needed because writes go through `self.procedure.*` tools, not the UI

**Shared editor component** lives at `apps/web/src/features/settings/shared/culture-editor.tsx` (new) — used by both Workspace Culture and Channel Culture tabs. Markdown body editor, frontmatter form fields, version history pane, "enforced LAW" toggle (Workspace tab only).

### Starter packs (ships day-one with channel scope)

Empty Channel Culture is a blank-page problem. Ship three starter packs:

- **Incident response** — pages stay open until RCA posted; on-call paged automatically; postmortem doc required.
- **Design review** — never approve without dev specs check; design tokens cited; Figma + screenshots both required.
- **Customer escalation** — every reply tagged with severity; no chitchat; status update every 30 min until resolved.

Packs are markdown files in the repo at `apps/web/assets/culture-packs/<name>.md`. The Channel Culture tab's empty state shows a pack picker that imports each entry into `ai/memory-bank/channels/<channel-id>/procedures/`.

## Provenance + observability

Every procedure write appends to `procedure_revisions`. The UI shows a per-procedure history pane.

`procedures_applied` is **mandatory** on every turn in the trajectory log (Bet 5). When the wake-time aggregator loads procedures, it records the list of `(scope, name, version)` tuples surfaced for that wake. The run-detail UI renders them. A per-channel weekly digest ("norms applied 47×, ignored 2×") gives admins a trust signal.

Without observability, norms feel like fairy dust. With it, an admin can answer "why did Layla do X" by reading the procedures-applied trail.

## What we are explicitly NOT building

- **Role as a primary scope.** `team.config.role.instructions` already half-covers it; the other half is procedures that would be near-duplicates of agent-scope. Revisit as a *template* (a role assignment seeds the new member's agent procedures) only if usage demands it.
- **`applies_when` triggers** (`wake_reasons`, `channel_kinds`). Premature optimisation. Admins will not author trigger conditions; they will write prose. Filter at runtime if anything, not at assembly. Every wake-reason transition would also be a cache bust.
- **A separate compaction loop for procedures.** They live in the cache-stable prefix; they don't grow on the message log, so they don't need it.
- **An LLM step that "suggests procedures" to admins.** Tempting, but the value is that humans wrote them. LLM-suggested procedures have no provenance.
- **Override-by-specificity** (channel > org). Additive is simpler and matches how teams actually operate. Specificity is communicated by `enforced: true` only.
- **Procedures in the FTS recall index.** Procedures are loaded at wake-time by direct path read; they should never appear in `channel.recall(scope: 'files')` results.
- **Per-procedure usage analytics** beyond the `procedures_applied` log. Trajectory log captures what's needed; build a dashboard only when usage tells you to.

## Migration of existing agent procedures

No migration. The existing `ai/memory-bank/agents/<id>/procedures/<slug>.md` files become the **agent scope** of the new system unchanged. Add the additional frontmatter fields (`updated_by`, `version`) as optional with sensible defaults on read. Backfill `procedure_revisions` with `version=1` rows on first run-touch — or skip backfill entirely and let history start from now (cheaper, fine for v1).

## Ship order (dependency order, no timings)

1. **Substrate refactor.** Extract the existing procedure file reader/writer into a single helper that takes a `scope` parameter. Today's `self.procedure.*` tools become thin wrappers that pass `scope: 'agent'`. New folders get created lazily on first write.

2. **Cache-stability lint extension.** The existing test now asserts `(agent, channel, wakeReason)` hash invariance, two wakes on the same triple hash-identical, two wakes on different channels intentionally hash-different. Write-time whitespace normalisation lands here.

3. **`procedure.list` / `procedure.view` cross-scope reads.** Replace the agent-only listing in `loadProceduresForSystemPrompt` with a three-scope aggregator. Token-budget enforcer ships here. Sort by `name`.

4. **FTS exclusion.** Workspace-files indexer skips procedure paths. Verify no leak via `channel.recall`.

5. **Filesystem path-prefix guard.** `write`/`edit`/`multiedit`/`shell` reject agent writes outside `ai/memory-bank/agents/<self>/`.

6. **`procedure_revisions` table + repo methods + migration.**

7. **Channel scope + Channel Culture tab + 3 starter packs.** This is the demoable wedge. Lead with this rather than org. Empty-state shows the pack picker.

8. **`procedures_applied` telemetry.** Wake-time aggregator records the list of `(scope, name, version)` tuples; run-detail UI renders them.

9. **Org scope + Workspace Culture tab.** Same component as Channel Culture, mounted under Settings → Organization. Reuses the same editor.

10. **`enforced: true` LAW flag.** Org-only. Renders at top of Zone 1 as `LAW (do not violate): <body>`. Cap at 2-3 per org enforced in the UI.

Channel-first ordering is deliberate — it's the product wedge. Once a customer has used Channel Culture, Workspace Culture is an obvious extension and the second build pays for itself.

## Killer demo

> *"Watch — I open `#incident-response`, click the Culture tab, paste the SRE starter pack. Now I @mention Layla with 'prod is down.' Without me retyping anything, she opens a postmortem doc, pages on-call, refuses to close the channel until an RCA is posted, AND every other agent that joins this channel will inherit the same behaviour."*

That lands the product idea in one breath: **channels enforce themselves, even on agents that joined yesterday.** Org procedures alone cannot produce a demo this visceral — "be polite" doesn't generate observable behaviour in 30 seconds.

## Risks

1. **Culture overload.** Hard cap (5-7 org + 5-7 channel + 3-5 agent) plus a quarterly "audit your culture entries" reminder in the admin UI. Without the cap, admins keep adding until quality degrades.
2. **Stale procedures contradicting current state.** Provenance (version + updated_at) + a "last updated N days ago" warning in the UI for anything older than 90 days.
3. **Token-budget bug.** A test in the cache-stability lint asserts total procedures bytes ≤ 2KB on every simulated wake.
4. **Cross-channel procedure leakage.** FTS exclusion prevents one vector; the wake-time aggregator picks `<current channel only>`; both layers required.
5. **Filesystem race on simultaneous edits.** Two admins editing the same channel norm race at FS level. Acceptable v1; the `procedure_revisions` row sequence makes the conflict diagnosable. Add row-level optimistic locking if it becomes a real problem.
6. **Composition freeze on contradictory layers.** Mitigated by the prelude line at the top of the procedures section ("pick the more specific scope and continue"). Watch the trajectory log for `channel.pass(reason: 'needs-clarification')` spikes — that's the signal.
7. **Agent uses `write` or `shell` to clobber an upper-scope file.** Mitigated by the filesystem path-prefix guard. Lint test asserts the guard rejects agent writes to `ai/memory-bank/{org,channels}/**`.

## Success criteria

- A new org has 3-5 starter Workspace Culture entries from a template applied on first login.
- A new channel can be created with a Channel Culture starter pack (incident-response, design-review, customer-escalation).
- An admin edits a Channel Culture entry and the next agent wake in that channel applies it.
- The cache-stable prefix stays under 2KB of total procedure bytes per wake.
- The trajectory log's `procedures_applied` field is non-empty on ≥ 95% of completed runs in channels with Channel Culture set.
- *Outcome bet*: 30 days after launch, channels with at least one active Channel Culture entry have ≥ 40% higher weekly active rate than channels without.
