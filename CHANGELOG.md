# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.6] - 2026-05-28

## [0.0.5] - 2026-05-28

## [0.0.4] - 2026-05-28

## [0.0.3] - 2026-05-28

## [0.0.3] - 2026-05-28

## [0.0.2] - 2026-05-28
### Added
- **Echo-loop kill** — new `channel.ack` silent terminator that satisfies the mandatory-reply contract without producing a wake-able channel message; vacuous-ack auto-mention suppression in `ConversationService.sendMessage`; per-pair mention back-pressure (`(org, thread, from, to)` window, 3 wakes / 90s) demotes runaway pairs to `channel-read`.
- **Mirror-loop runtime guard** (Bet 1.5) — `packages/orchestrator/src/services/mirror-guard.ts` exports `detectMirrorChain` (Jaccard ≥ 0.75 across 3 consecutive agent messages), `isVacuousAck`, `isMirrorFragileModel`, `shouldSuppressForMirror`. Wired into `channel.reply` / `channel.post` / `channel.dm` via `conversations.tryMirrorSuppress`. Provider-aware anti-mirror prompt line injected for `gemini-*-flash` only.
- **Durable commitment lifecycle** (Bet 4) — `packages/orchestrator/src/services/commitment-service.ts` extracts forward-looking commitments ("I'll draft X") from published agent messages, auto-promotes the channel into a `task_sessions` row, and parks a `todos` row with new fields (`channel_id`, `source_message_id`, `deliverable_summary`, `due_at`, `last_progress_at`). 60s sweeper re-wakes idle owners with `wakeReason: 'self-followup'` and posts a deadline-letter system message when `due_at` elapses.
- **Channel goals UI rail** (Bet 2) — `GET /api/channels/:id/open-goals` route + Next.js proxy + `ChannelGoalsStrip` React component rendering open commitments inline in the channel header. Pure projection of `task_sessions` + `todos` joined by `channel_id`; no LLM call, no per-channel orchestrator agent.
- **Read-only filesystem default-on** (Bet 1) — `ALWAYS_AVAILABLE_AGENT_TOOLS` now includes `view`, `ls`, `glob`, `grep`, `channel.ack`. `policy.ts` accepts baseline tools regardless of `role.tools`; empty `role.workspaceScopes` falls back to `['.']` for read actions (writes stay strict).
- **Role-class writability** — team-config v4 migration fills empty `role.tools: []` arrays with class-appropriate write tools (engineer/qa/pm/designer/analyst/reviewer); writer-class roles get `workspaceScopes: ['.']`. `shell`, `download`, and `filesystem` (raw) stay strict opt-in.
- **System prompt: action-protocol framing** — `Tools NOT available to you in this org:` line tells the model how to ROUTE missing-capability requests instead of inventing apologies. Wake-run scaffold replaces inline catchphrases ("noted / I will await") with function-first terminator definitions (`channel.ack` = no new info, `channel.pass` = not addressed, `channel.reply` = substantive content).

### Fixed
- **Commitment-sweeper stall (channel-9ufz1jk3 follow-up)** — three compounding gaps closed in a single bundle so a self-followup wake can no longer disappear without surfacing:
  - **Commitment dedup at extract.** `CommitmentService.onAgentMessagePublished` now consults `findOpenChannelCommitmentForMember(orgId, channelId, memberId, sinceIso)` before inserting. A near-identical restatement within `dedupWindowMs` (default 5 min) rolls `last_progress_at`/`source_message_id` forward on the existing row instead of spawning a parallel todo. Past-tense completions bypass dedup so delivered artifacts always land as their own `completed` row on the goals rail.
  - **Empty-wake counter + early escalation.** New `empty_wake_count` column on `todos` (migration `024_todos_empty_wake_count`). `SpiritService.setRunCompletedHook` lets `CommitmentService.onRunCompleted` map each finished self-followup run back to its todo via `source_message_id`; publishing terminators (`channel.reply` / `channel.post` / `channel.dm` / `channel.handoff` / `message`) reset the counter, acknowledged terminators (`channel.pass` / `channel.ack`) leave it alone, everything else (NULL, `self.note`-only, `view`-only) increments. After `maxEmptyWakes` (default 3) consecutive empties the service short-circuits `due_at` to "now" so the deadline-letter fires on the next `sweepExpired` tick — no more 24h of silent cycling.
  - **Self-followup publish-contract scaffold.** When `wakeReason === 'self-followup'` the wake-run prompt now opens with: *"You are waking on a commitment you made earlier in this channel. Before you stop, do one of: (a) call channel.post/channel.reply with concrete progress; (b) call channel.pass with a real reason; (c) call supervisor.todo.update. self.note alone is NOT a valid termination."* The mandatory-reply contract stays OFF for self-followup (so `channel.pass` and `self.note` remain in the palette) but the scaffold tells the model that ending the turn with only inner-monologue tools is the failure mode that surfaces as `member.empty_wake`.
  - **Delivery-resolves-commitment for path-bearing and inline deliveries.** Previously when an agent posted "I have drafted the BRD and saved it to ai/memory-bank/brd.md", the path-bearing completion extractor created a NEW completed row but left the original "I will draft the BRD" commitment open — the rail showed both. Now both branches first look up an open commitment for `(channel, member)` and flip it to `completed`, upgrading its `deliverableSummary` to the artifact path when present. New `looksLikeInChannelDelivery` predicate ("I have compiled…", "Here is the X…", "Below is the Y…") also closes matching open commitments even when the agent pastes the deliverable inline with no file path (≥0.3 deliverable-token overlap required to avoid false positives on unrelated substantive posts).
  - **Self-followup token budget bump (1200 → 4096).** Multi-section deliverables (task lists, BRDs, PRDs) routinely exceeded the per-turn cap when pasted inline, producing markdown cut off mid-bullet. The bump matches the scaffold update that nudges agents to `write` long artifacts to a file first; the higher cap is a safety net for when the model ignores that nudge.
  - **Scaffold update — prefer file writes for long deliverables.** Self-followup scaffold now appends: *"For ANY deliverable longer than ~10 lines (task lists, BRDs, PRDs, specs, multi-section docs): use the `write` tool to save the artifact to a file in the workspace FIRST, then post a short channel.post that says 'Delivered — see `<path>`'. Pasting long markdown inline gets truncated at the token cap and the reader sees a half-written document."*
- New `SocketEventNames.memberEmptyWake` event (`member.empty_wake`) carries `{ memberId, todoId, emptyWakeCount, escalated }` so the UI can surface the stall in real time and so audit consumers can count empties per `(channel, member)` pair.
- **Wake-run MCP role detection** — `AiService.generateRunReply` was hardcoding `role: 'worker'`; now resolves the actual `SpiritRole` via `getSpiritByRunId` so supervisor-scoped MCP attachments aren't silently dropped.
- **Self-DM idempotency on first send** — `resolveDirectMessageThreadId` checks `recipientId === 'self'` before `parentMessageId`, and the dedupe/access preflight skips when the thread doesn't exist yet (DMs lazily create on first send).
- **Provider fallback short-circuit** — `SpiritService.advanceRun` no longer fails a run when the preferred provider's key is missing; the runtime fallback in `resolveSpiritModel` walks every configured provider with a key.
- **Provider-aware `member.model` on fallback** — when `resolveSpiritModel` falls back to a different provider, `member.model` (which is provider-specific to the original) is ignored, falling through to the provider's `defaultModel`.
- **Terminator overwrite on mirror-suppress** — `advanceRun` now preserves the silent terminator (`channel.ack` / `channel.pass`) that mid-run side-effects wrote onto the run row, instead of clobbering it with the model's original publishing toolcall.
- **Supervisor ack-loophole** — `runSupervisorAlertTurn.publishedViaTool` now excludes `channel.ack`; a supervisor that acks a mention emits `member.must_reply_failed` so the human sees the missing reply.
- **`channel.handoff` runId metadata** — handoff messages now carry `metadata.runId` so run-detail views associate the message with its originating run.
- **MCP test endpoint HTTP status** — `POST /settings/mcps/:id/test` returns `502` (with full diagnostic `TestMcpResponse` body) when the upstream MCP runtime fails, instead of a misleading `200 OK { ok: false }`.
- **`isVacuousAck` over-suppressed substantive bodies** — "Got it, here's the file at /tmp/spec.pdf" was being treated as vacuous, dropping the auto-re-mention and sending the counterparty a soft `channel-read` wake. Residue check now allows action verbs (sending, drafting, deploying, …) and path/numeric tokens to mark the body substantive.
- **`pairMentionWindows` unbounded growth** — per-pair mention back-pressure map never evicted empty keys; now sweeps expired entries when map size crosses 1024.
- **`isSensitiveWorkspacePath` expanded** — covers `credentials.json`, `service-account.json`, `secrets.yaml`, `*.tfvars`, `*.kubeconfig`, `*.pgpass`, `*.htpasswd`, `*.keystore`, `*.jks`, `*.gpg`, `id_rsa*` (and its DSA/ECDSA/Ed25519 siblings), `.gcloud` / `.azure` / `.docker` / `.kube` / `.codex` directories. Read-only default-on was previously surfacing these to agents under workspace-root scope.
- **Past-tense completion extraction** — `commitment-service.ts` adds `extractCompletion(body)`: agents that announce delivered work past-tense ("I have drafted the BRD and saved it to `ai/memory-bank/site-setup.md`") now land as `completed` todos with the artifact path. The goals rail surfaces these (last 24h) with a green ✓ badge so humans see what was actually produced, not just what was promised.
- **Cross-cutting terminator preservation** — same silent-terminator preservation that landed in `SpiritService.run()` now also mirrors into `SpiritService.advanceRun`; mid-run mirror-suppression (`channel.ack`) won't be clobbered by the model's original publishing toolcall on either path.

### Tests
- Added `mirror-guard.test.ts` (33 cases): `isMirrorFragileModel` matching, `isVacuousAck` positive + substantive-rejection regressions, `detectMirrorChain` short-window / empty-body / pair-mirror / substantive-content cases, `shouldSuppressForMirror` end-to-end.
- Extended `commitment-service.test.ts` to **44 cases** (was 30): adds runtime-behaviour coverage for the post-stall fixes — `onAgentMessagePublished` dedup (single insert + restatement updates existing + per-member isolation + past-tense bypass + path-bearing completion closes matching open), and `onRunCompleted` empty-wake handling (reset on publishing terminator, untouched on `channel.pass`, increment on NULL terminator, `due_at` short-circuit on threshold hit, no-op on non-self-followup wake reasons), plus 4 in-channel delivery cases (resolves open commitment on past-tense inline, on "Here is the X" shape, token-overlap floor rejects unrelated content, length floor rejects 1-line "I have done it" vacuous claims).
- Total suite: **283 passing** in `@ujima/orchestrator` (was 269); 755+ across the monorepo (excluding the two test-less packages `@ujima/webview` and `ujima-vscode-extension`).

### Changed
- **Schema migrations** — `022_todos_commitment_fields` adds commitment columns + two indexes; `023_todos_idle_progress_index` adds the partial covering index for the idle sweeper hot path; `024_todos_empty_wake_count` adds the empty-wake counter used by the early-escalation path.
- **`TodoSchema`** adds `emptyWakeCount` (non-negative integer, default 0). Reset by publishing terminators on self-followup wakes; incremented by NULL/`self.note`-only terminators; short-circuits `due_at` after `maxEmptyWakes`.
- **`TodoStatus` enum** adds `expired` and `blocked`.
- **`WakeReason` enum** adds `self-followup` (scheduler-originated wake; mandatory-reply contract is NOT active for this reason).
- **`SocketEventNames`** adds `agentAck`, `mirrorSuppressed`, `echoSuppressed`, `commitmentCreated`, `commitmentUpdated`, `commitmentExpired`, `memberEmptyWake`.
- **`team.config` version bumped to 4** — auto-fills empty `role.tools: []` by role class on next daemon restart; users who deliberately want a narrower surface can edit via settings UI after migration.

### Operational notes
- Sweeper safety: 60s tick uses `claimIdleCommitment` (atomic `UPDATE` keyed on prior `last_progress_at`) so two overlapping sweeps or a daemon restart mid-sweep don't double-wake the same row. `apiServices.stop()` is `Promise<void>` and awaits any in-flight sweep before resolving — daemon shutdown should call it BEFORE closing the DB handle.
- Single-daemon assumption today: there is no leader lease (`sweeper_leases` table). If running multiple daemons against the same DB, expect duplicate deadline-letters until the lease is added.

### Initial setup
- Initial setup and scaffolding for Ujima Agents monorepo.
- Defined `packages/shared`, `packages/ujima`, and core CLI package outlines.
- Established Phase 1 plan and documentation.
- Integrated `SKILL.md` standard for the Agent Skills Library.
- Standardized open-source repository files (LICENSE, Issue/PR templates, Badges).
