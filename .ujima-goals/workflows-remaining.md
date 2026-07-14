# Workflows — remaining work & ideas

Status of the SOP workflow engine. Phases 1–8 shipped and verified (engine,
tools, live execution, visual editor, run view, sweeper). Phase 2 (channel
scoping + in-channel tab + Run button) shipped. This tracks what's left.

## Phase 2 — remaining

- [x] **Dedicated run thread per run.** Each run executes in its own thread
  (`wf-run-<id>`) inside the origin channel, with the workflow's agents added as
  members. Fixes "the agent isn't in the channel" + keeps the run out of the
  main conversation. (effects: prepareRunThread)
- [x] **In-channel run card.** A "▶ Workflow started → open run" card is posted
  to the origin channel. (effect: postRunCard)
- [x] **Approver can be another agent.** Approval nodes can name an
  `approverAgentId`; that agent reviews the upstream output and resolves the gate
  via `workflow.transition`. Editor exposes an "Approver" dropdown.

### Follow-ups on the above
- [x] Surface the dedicated run thread's messages in the run view — a
  "Conversation" panel below Steps shows the run-thread messages.
- [x] Card updates on completion — a ✅/⛔ card posts to the origin channel when
  a run finishes (postRunUpdate).

### Experience polish (live testing round 2)
- [x] **"Open run" opens an in-channel drawer**, not a full-page nav. Clicking a
  run card slides over a `WorkflowRunDrawer` (steps + artifacts + conversation +
  gate controls) with an "open full view ↗" escape hatch to the canvas page.
  (`workflow-run-drawer.tsx`, `use-workflow-run.ts`, `workflow-run-side-panel.tsx`;
  wired via `onOpenWorkflowRun` prop on `ChatMessage` + drawer mounted in
  `channel-view`.)
- [x] **View a step's artifact from the run.** Each step with an output file has a
  View toggle that fetches + shows the file content inline (truncated at 256 KB).
  Backed by `GET /api/workflow-runs/:id/artifact?path=` — scoped hard to the run's
  own node output paths (traversal / foreign paths → 403).
- [x] **Approvals flow through the real MCP approval queue.** Workflow gates
  surface in the same "Approval N of M" card + floating "N pending" pill as MCP
  approvals — not a separate inline chat card. Sourced live from run/node-run
  state via `GET /api/workflow-approvals` (a poll hook, `useWorkflowApprovalsPoll`,
  feeds them into the shared approval store; guarded mutators keep the MCP sync
  from clobbering them). The `ApprovalCard` renders a binary Approve/Reject variant
  (`workflowScope`); resolving routes to the workflow transition endpoint instead
  of `/api/approvals`. Because the list is derived from real state, resolved gates
  drop off on the next poll (no stale-on-reload problem) — and the MCP
  `ApprovalService` is untouched (zero regression risk to connector approvals).

### Fixed from live testing
- [x] **Run card is now a real clickable card.** The card link used to render as
  raw markdown (`[open run →](/workflows/runs/…)`) — system messages render their
  body as a bold *label*, and `sanitizeUrl` strips relative URLs, so the link was
  dead. Now the card rides on `metadata.workflowRunMarker` (shared schema →
  `postRunCard`/`postRunUpdate`), mapped in `use-conversation-sync` and rendered
  as a compact, phase-colored, clickable row in `chat-message.tsx` that navigates
  to the run view (mirrors the `delegateMarker` pattern).
- [x] **Sweeper no longer floods the channel.** Reminder interval 15m → 30m, and
  a run goes quiet after `maxReminders` (3) — the run view still shows it. Stuck
  test runs are marked terminal instead of reminding forever.

## Editor / UX polish

- [x] Agent field is a dropdown of the org's agents (name + role).
- [x] Tool field is a dropdown from the tool catalog.
- [x] Per-node-type help text in the inspector.
- [x] Compact nodes + capped fit-view zoom.
- [ ] **Skill dropdown.** No org-skills listing endpoint yet — skill sub-nodes
  are still free-text. Add a skills catalog (installed skills) and make it a
  dropdown like agents/tools.
- [ ] **Prompt token autocomplete.** Suggest `{{nodes.<id>.output}}` etc. from
  the actual upstream nodes while editing an agent prompt.
- [ ] **Palette drag-to-canvas.** Nodes are added by click today; support real
  drag-and-drop placement.
- [ ] **Read-only vs edit** affordance for org-wide workflows opened from a
  channel (avoid accidental edits to shared definitions).

## Engine / correctness

- [ ] **Boot recovery** — call `recoverInFlight` on startup (the sweeper covers
  it on the first tick; make it explicit on boot too).
- [ ] **Branching / conditional edges** (schema-reserved) — route on a node's
  json output.
- [ ] **Loops / retries with backoff** beyond manual retry.
- [ ] **Expression language** for richer templating (currently a fixed token
  set).
- [ ] **Parallel-branch + approval interaction** — an approval currently pauses
  the whole run; make it gate only its own downstream branch.

## Notes for whoever picks this up

- Engine is decoupled from execution via `WorkflowEffects` (spawnAgentNode,
  raiseApproval, startGoal, statOutput, notifyInitiator, getRunStatus). The live
  adapter is `workflow-effects-live.ts`; the composition root wires it in
  `services/index.ts`.
- Agents used in agent nodes must have workspace write scope. The OSINT roles
  have empty scopes and can't write files — use QA/PM/engineer roles.
