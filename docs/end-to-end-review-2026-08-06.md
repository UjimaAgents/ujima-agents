# Ujima Agents — End-to-End Review (2026-08-06)

Scope: onboarding, agent chat, summarization/compaction, Codex & Claude provider integrations, tool calling & approvals, efficiency/UX. Each finding lists `file:line`, quoted evidence, failure scenario, and severity. All paths are relative to the repo root (`/Users/mac/Documents/Work/Ujima_Agents`).

---

## A. Tool calling & approvals (highest stakes)

### 1. HIGH — Approval scope canonicalization drops arguments: a "one-time" approval authorizes arbitrary subsequent calls
Files:
- `packages/shared/src/approval-scope.ts:556-582` — `canonicalizeApprovalScope`
- `packages/orchestrator/src/services/spirit-direct-run.ts:60-61` — `resumeAfterApproval`
- `packages/orchestrator/src/services/tool-approval-gate.ts:15-30` — `isToolApprovalSatisfied` + `consumeApprovedRun`

Evidence:
```ts
// approval-scope.ts:574-581 — MCP canonical scope drops args entirely
const connector = parseConnectorScope(scope);
if (connector) {
  return buildConnectorScope({
    serverId: connector.serverId,
    serverDisplayName: '',
    toolName: connector.toolName,
    argsPreview: '',            // <-- args are display-only; canonical scope has NO args
  });
}
```
```ts
// approval-scope.ts:566-572 — filesystem scope keeps path but drops content,
// and write/edit/multiedit ALL collapse to the same canonical scope
const filesystem = parseFilesystemScope(scope) ?? parseWorkspaceWriteScope(scope);
if (filesystem) {
  return `filesystem:${JSON.stringify({ action: filesystem.action, resourcePath: normalizeApprovalPath(filesystem.resourcePath) })}`;
}
```
```ts
// spirit-direct-run.ts:60-61 — the canonical scope is registered for the whole run
if (allowRun) {
  this.tools.allowRun(organizationId, runId, approvalScope);
}
```

Why it's a bug: `resumeAfterApproval` registers the **canonicalized** scope (args stripped) as a run-level grant. `isToolApprovalSatisfied` then matches future invocations against it (`consumeApprovedRun`). Concrete failure: a human approves one benign call of an MCP tool (e.g. `bash.exec(command: "ls")` on a shell MCP server, or `filesystem.write_file(path: X, content: "notes")`); for the rest of that run a **different** invocation of the same tool with arbitrary args/content (`rm -rf …`) passes the gate without any approval because the scopes compare equal. The write path is worse: approving a write to `X` also covers an **edit** of `X` with a different old/new string, and vice versa. Shell scopes keep `command`+`args` (line 559-563), so only MCP/filesystem are affected.

Severity: HIGH (security — approval bypass).

### 2. HIGH — Pending-approval dedupe groups different-args calls under one approval; approval resolution replays every grouped step
Files:
- `packages/orchestrator/src/services/approval.ts:172-190` — `requestApproval` dedupe
- `packages/orchestrator/src/services/spirit-service-base.ts:319-380` — `replayApprovedToolSteps`

Evidence:
```ts
// approval.ts:173-189 — matches pending approvals by canonical scope
const existing = requestedScope
  ? this.repo.listPendingApprovals(input.organizationId)
      .find((approval) => approval.runId === input.runId && matchingApprovalScope(approval, requestedScope))
  : undefined;
if (existing) {
  if (!existing.toolCallId) { /* stamp first toolCallId */ return updated; }
  return existing;             // <-- second call (possibly different args) reuses first approval
}
```

Why it's a bug: while approval for call #1 (`bash.exec("ls")`) is pending, a second call to the same tool with different args (`bash.exec("rm -rf …")`) matches the same canonical scope and reuses the same approval row — no second card, no new `toolCallId` recording. The approval card shows only call #1's args. On resolution, the replay path executes every run step grouped under that approval, so the never-shown second call executes on the human's single approval. Root cause is the same coarse canonicalization as Finding 1; both should be fixed together (keep args in the canonical form for matching/dedupe).

Severity: HIGH (security — grouped execution on one consent).

### 3. MEDIUM-HIGH — No timeout on MCP `callTool`: a hung MCP server hangs the run indefinitely (watchdog can't trip)
Files:
- `packages/mcp-client/src/connection.ts` (call path)
- `packages/orchestrator/src/services/spirit-agent-run.ts:566` — `abortSignal: abortController.signal`
- `packages/agent-runtime/src/watchdog.ts`

Evidence (spirit-agent-run.ts passes the run abort into `streamText`, but MCP invocation is a plain await that never receives it):
```ts
abortSignal: abortController.signal,
```

Why it's a bug: MCP tool calls are awaited with no per-call timeout. A server that hangs mid-call (common with Playwright/interactive MCP servers waiting on input) blocks `result.fullStream` indefinitely. The watchdog only trips when the agent's heartbeat stops; the heartbeat keeps firing while the process is alive, so a hung tool never trips it. The run only recovers via manual cancel. Compare: shell tools have a 30s sync timeout — MCP tools have none.

Severity: MEDIUM-HIGH (liveness/cost).

### 4. MEDIUM — `generateRunReply` runs with `maxIterations: Number.MAX_SAFE_INTEGER` — tool-error loops burn unbounded tokens
File: `packages/orchestrator/src/services/spirit-agent-run.ts:372`
Evidence:
```ts
maxIterations: Number.MAX_SAFE_INTEGER,
```
Why it's a bug: the agent loop's `stopWhen` terminates on a step with final text or a run-terminating tool. If the model repeatedly calls non-terminating tools (e.g. a tool returning errors it keeps retrying, or an MCP tool that errors), there is no hard step cap — the loop only ends when the context window overflows (then fails with `ContextLengthExceededError`). Each iteration costs a full model round trip. The legacy path (`packages/agent-runtime/src/shell.ts`) correctly caps at `DEFAULT_MAX_ITERATIONS = 12`; the spirit path has no equivalent.

Severity: MEDIUM (cost/liveness).

### 5. MEDIUM — `classifyApiError` only recognizes `AI_APICallError`; provider wrappers create bare `Error`s so compaction-and-retry never fires for Claude Code
Files:
- `packages/agent-core/src/loop.ts:156-191` — `classifyApiError` (guard: `if (e.name !== 'AI_APICallError') return null;`)
- `packages/llm/src/claude-code-sdk.ts:354-368` — `doGenerate` wraps errors as `new Error("Claude Code SDK error: …")`

Evidence:
```ts
// claude-code-sdk.ts:354-357
} catch (error) {
  throw new Error(`Claude Code SDK error: ${error instanceof Error ? error.message : String(error)}`);
}
```
Why it's a bug: a context-length failure from the Claude Code CLI is re-wrapped into a bare `Error`, which `classifyApiError` never classifies as `ContextLengthExceededError` (name check fails). The auto-compaction-and-retry hook in `runAgentLoopWithRetry` (`packages/orchestrator/src/services/agent-loop.ts`) never fires — long conversations on `anthropic-claude-code` fail hard instead of compacting. The `doStream` error part (claude-code-sdk.ts:390-395) has the same issue.

Severity: MEDIUM (reliability for long context on the Claude Code provider).

### 6. MEDIUM — Role `workspaceScopes` are not enforced by the path resolver (`enforceRoleScopes: false`); scope enforcement relies entirely on approval-gating
File: `packages/orchestrator/src/services/workspace-root.ts:157-161`
Evidence:
```ts
return createPathResolver({
  root: organization.workspace.root,
  scopePaths: workspaceMember.roleScopePaths,
  enforceRoleScopes: false,   // <-- role scopes are stored but never enforced here
});
```
Why it's a bug: the boundary resolver only enforces the workspace root, never the per-role `workspaceScopes`. Role-scope enforcement then depends on `policy.ts` (`checkToolPolicy`, lines ~249-269), which only *approval-gates* writes outside scope (`requiresApproval: true`) and skips the check entirely for reads. The shared `createRoleScopedPathResolver` in `packages/shared/src/path-resolver.ts` exists but is unused. Net effect: an agent whose role is scoped to `apps/web` can still *read* (and, with an approval, *write*) anywhere in the workspace root — the scoping UI implies a hard boundary that the runtime does not enforce.

Severity: MEDIUM (security semantics — scope UI overstates enforcement).

### 7. MEDIUM — Onboarding's claude-code provider is a guaranteed dead end: UI says complete with no key input; daemon rejects with "Missing provider keys"
Files:
- `packages/orchestrator/src/services/team.ts:67-82` — `validateProviderKeys` (exempts only `ollama` + `chatgpt` auth modes)
- `apps/web/src/features/onboarding/api-contract.ts:38-47` — treats `anthropic-claude-code` as complete with no key
- `apps/web/src/features/onboarding/components/activation-onboarding-form.tsx:60-61`

Evidence:
```ts
// team.ts:75-81 — 'claude-code' auth mode is NOT exempted
if (providerAuthMode(team, role.provider) === 'chatgpt') continue;
if (!providerKeys[role.provider] && !missingProviders.includes(role.provider)) {
  missingProviders.push(role.provider);
}
```
Why it's a bug: `providerAuthMode('anthropic-claude-code')` returns `'claude-code'` (team.ts:33), which is not `'chatgpt'` and not `'ollama'`, so onboarding throws `Missing provider keys: anthropic-claude-code` (onboarding.ts:193-195). The UI never offers an API-key input for this mode (provider-credential-field.tsx renders a local-login status instead) and marks the step complete. Every onboarding run with the Claude Code provider fails at the final submit with no way to fix it in the UI. (Onboarding is also part of finding list — this one is provider+onboarding crossover; see also B7.)

Severity: HIGH for the claude-code onboarding path.

---

## B. Onboarding

### 8. HIGH — Onboarding API is unauthenticated: anonymous org creation, unbounded idempotency cache, host-filesystem path oracle
Files:
- `apps/web/src/app/api/onboarding/route.ts:14-39` — proxy with no auth/session check, no "already onboarded" guard
- `apps/api/src/transport/routes/onboarding.ts:15, 54-57, 90-92` — `completedAttempts` unbounded `Map` (no TTL/eviction) storing full responses incl. `sessionToken`; no one-time guard on `onboard`

Evidence:
```ts
const completedAttempts = new Map<string, OnboardingResponse>();
...
if (req.body.attemptId && completedAttempts.has(req.body.attemptId)) {
  return completedAttempts.get(req.body.attemptId);
}
```
Why it's a bug: any caller reaching the web app can POST unlimited onboarding requests (attacker-chosen org + owner credentials), each cached forever (memory growth; session tokens retained indefinitely). Daemon error strings are forwarded verbatim (e.g. `workspace root "/Users/x" does not exist on disk`), making it a host-path-existence oracle. Local desktop blast radius is localhost; the `VERCEL` branch in `pick-workspace-root/route.ts:9` shows hosted deployments are contemplated, where this becomes remote org-creation/DoS.

Severity: HIGH (hosted) / MEDIUM (local).

### 9. MEDIUM — Refresh wipes provider API keys but restores a later step; the review step has zero validation and Continue ignores stepper locks
Files:
- `apps/web/src/features/onboarding/onboarding-experience.tsx:249-266` (persistence blanks `apiKey`), `:187` (`activeStep` restored verbatim)
- `apps/web/src/features/onboarding/components/activation-onboarding-form.tsx:63-68` (only the `agent` step validates; review returns `null` always), `:89-94` (`continueFlow` never checks step accessibility)

Evidence:
```ts
// onboarding-experience.tsx:254-265
draft: {
  ...session.draft,
  ownerPassword: "",
  ownerPasswordConfirmation: "",
  providers: session.draft.providers.map((provider) => ({ ...provider, apiKey: "" })),
},
```
Why it's a bug: refresh on the agent/review step restores a later step while the provider step is now incomplete — stepper shows it locked, but the active step's Continue/“Create workspace” is enabled (accessibility is only checked on step *clicks*). The review step has no validation at all, so the user submits and only then sees `Missing provider keys: openai` from the daemon with no hint that the key was wiped.

Severity: MEDIUM.

### 10. MEDIUM — Lost success response = permanent "workspace already exists" dead end (`attemptId` regenerated per mount defeats the daemon cache)
Files:
- `apps/web/src/features/onboarding/onboarding-experience.tsx:246` — `useState(() => crypto.randomUUID())`
- `apps/web/src/server/ujima-daemon.ts:11-15` — 60s web→daemon fetch timeout
- `packages/orchestrator/src/services/onboarding.ts:161-167` — existing-org guard

Why it's a bug: the daemon caches success by `attemptId`, but the client generates a fresh id on every mount. If the browser's fetch is lost after the daemon created the org (timeout, tab close), the retry fails permanently with "A workspace with the project folder … already exists." and the user is stuck in onboarding with no "your org was created — sign in here" affordance. Bonus: `crypto.randomUUID()` is undefined on non-secure origins (plain `http://192.168.x.x` LAN access), which crashes the whole page at render.

Severity: MEDIUM (stuck-state) / MEDIUM (crash on LAN HTTP).

### 11. MEDIUM — `pick-workspace-root`: unauthenticated host-dialog trigger; real `osascript` errors silently reported as "cancelled"
File: `apps/web/src/app/api/onboarding/pick-workspace-root/route.ts:8-35, 121-147`
Evidence:
```ts
if (!text) {
  resolve({ cancelled: true });   // stdout empty => "cancelled", even when osascript failed on stderr
  return;
}
```
Why it's a bug: the endpoint is unauthenticated and spawns native dialogs (`osascript`/`powershell.exe`/`zenity`/`kdialog`) on the host — any page that can POST to the web app can pop dialogs at will (no origin check, no rate limit). On macOS, a genuine failure (e.g. automation permission denied, error −1743) goes to stderr only, so the client silently does nothing — "Browse" appears broken with no error.

Severity: MEDIUM.

### 12. LOW-MEDIUM — Unknown provider names silently normalize to `openrouter`, key gets attached to the wrong provider
File: `apps/web/src/features/onboarding/api-contract.ts:32-36`
Evidence:
```ts
return PROVIDER_NAME_MAP[normalized] ?? "openrouter";
```
Why it's a bug: an unrecognized provider token (future catalog entry, hand-edited draft) is silently remapped to OpenRouter and its key validated against the wrong provider — confusing runtime failure with no warning.

Severity: LOW-MEDIUM.

---

## C. Agent chat

### 13. HIGH — Sent message lands in the wrong conversation when the user switches channels while the POST is in flight
Files:
- `apps/web/src/features/workspace/use-conversation-sync.ts:406-441` — `sendMessage` ack path has no conversation-key guard and the fetch is not abortable
- `apps/web/src/features/workspace/workspace-store.ts:742-766` — `receiveMessage` merges into the global `messages` array with no thread scoping

Evidence:
```ts
// workspace-store.ts:742-743
receiveMessage: (tempId, message, toMessage, toActivity) =>
  set((state) => {
    const nextMessage = toMessage(message);
```
Why it's a bug: the store holds one feed; `resetConversationFeed` wipes it on switch. If the user sends in channel A and clicks channel B before the ack, A's message merges into B's timeline (rendered by `channel-view.tsx:1145` without a threadId filter) and A's activity event lands in B's activity tab. The message also re-appears in A via history — user sees their message in the wrong channel and a spurious bubble in B until reload. The failure is invisible and data-integrity-affecting.

Severity: HIGH.

### 14. MEDIUM-HIGH — Stale `stream:` placeholder bubble never pruned on reconnect/history reload (ghost duplicate with truncated content)
Files:
- `apps/web/src/features/workspace/workspace-store.ts:248-253, 731-739` — `pruneStreamingMessage` is only applied in `receiveMessage`, never in `hydrateMessages`

Evidence:
```ts
function pruneStreamingMessage(current, incoming) {
  if (incoming.kind !== "agent" || incoming.pending || !incoming.streamRunId) return current;
  const streamPlaceholderId = `stream:${rid}:${incoming.senderId}`;
  return current.filter((message) => message.id !== streamPlaceholderId);
}
```
Why it's a bug: on SSE reconnect the client re-runs `loadConversationState` → `hydrateMessages(history, …)`. If the run completed while the stream was down, history holds the final message but the partial `stream:` bubble stays forever beside it (duplicate content, truncated text) until the user leaves the conversation.

Severity: MEDIUM-HIGH.

### 15. MEDIUM — Rapid identical messages: one server echo removes BOTH pending bubbles (invisible failure for the second send)
File: `apps/web/src/features/workspace/workspace-store.ts:751-755`
Evidence:
```ts
: state.messages.filter(
    (item) => !(item.pending && item.name === nextMessage.name && item.content === nextMessage.content),
  );
```
Why it's a bug: two identical short messages sent quickly both create pending bubbles; the first echo's fallback (no tempId path for agent messages) removes both. If the second send then fails, `removeMessage(tempId)` removes nothing — no in-timeline trace of the failed message.

Severity: MEDIUM.

### 16. MEDIUM — Composer draft + attachments + replyTo destroyed on conversation switch (no draft persistence)
File: `apps/web/src/features/workspace/components/workspace-shell.tsx:559-560` (`key={...}` remount), `apps/web/src/features/workspace/components/chat/chat-input.tsx:536` (`useState("")`)
Why it's a bug: every conversation switch unmounts `ChannelView`, destroying the in-progress message, queued attachments, and reply target. No `sessionStorage` draft persistence exists. Classic chat UX data loss.

Severity: MEDIUM.

### 17. MEDIUM — In-flight attachment upload orphaned on unmount; file stored server-side but dropped from UI
File: `apps/web/src/features/workspace/components/chat/chat-input.tsx:653-667, 841-907`
Evidence: unmount cleanup only revokes preview URLs; the `AbortController`s in `uploadControllersRef` are never aborted, and post-upload state updates run on an unmounted component.
Why it's a bug: on conversation switch/network loss, the upload completes on the daemon, the UI shows nothing, and the user's intended attachment is silently dropped.

Severity: MEDIUM.

### 18. MEDIUM — `fetch("/api/messages")` rejection leaves a forever-"Sending…" bubble; manual retry can duplicate the message server-side
File: `apps/web/src/features/workspace/use-conversation-sync.ts:406-433`
Evidence: `removeMessage(tempId)` runs only on `!response.ok` or parse failure — a network-level rejection skips it. The retry path allocates a new `clientMessageId` (line 384) unless `options.clientMessageId` is passed, which no UI path does, defeating the daemon's dedupe index.
Why it's a bug: permanently stuck "Sending…" bubble; if the original POST actually committed server-side (timeout after commit), the retry creates a duplicate message.

Severity: MEDIUM.

### 19. MEDIUM-LOW — Notifications stream errors swallowed; unread counts go stale silently after a daemon blip
Files: `apps/web/src/features/workspace/components/workspace-shell.tsx:398-423`, `apps/web/src/app/api/notifications/stream/route.ts:45-55`
Evidence: `if (envelope.type === "error") return;` — dropped with no user surface; the one-shot long-poll never resumes after reconnect.
Why it's a bug: unread badges freeze at stale values and the user is never told.

Severity: MEDIUM-LOW.

---

## D. Summarization / compaction

### 20. HIGH — Every published message triggers a full-thread paginated scan, synchronously, in the publish hot path (O(n²) over a thread's life)
Files:
- `packages/orchestrator/src/services/conversation.ts:408-419, 442-456` — `scheduleConversationCompaction` runs inline in `publishMessage` for every message
- `packages/orchestrator/src/services/conversation-compact.ts:113-129, 466-479` — `conversationNeedsCompaction` → `listAllThreadMessages` paginates the entire thread (200/page)

Evidence:
```ts
// conversation-compact.ts:46 — the cheap SQL fast path is declared…
countUncompactedMessageChars?(organizationId: string, threadId: string): number;
```
`countUncompactedMessageChars` is implemented (`packages/runtime-core/src/repositories/messages.ts:309-325` as a single `SUM(LENGTH(content))` query) but has **zero call sites**. When compaction does run, `compactConversationIfNeeded` re-reads the thread up to 3-4 more times (`conversationNeedsCompaction` + `listUncompactedConversationMessages` + `compactConversationPass`).

Why it's a bug: O(n) SQL + JSON decoding per message published, O(n²) total per thread; a long-running chat slows to a crawl well before compaction triggers. This is the "efficiency" complaint made concrete.

Severity: HIGH (performance).

### 21. HIGH — Summarization timeout/failure: nothing is marked `compactedInto`, the LLM call isn't aborted, and every subsequent message re-summarizes the same content (retry storm)
Files:
- `packages/orchestrator/src/services/conversation.ts:462-469` (guard released in `.finally`), `:1400-1408` (`withTimeout` uses `Promise.race` with **no AbortController**)
- `packages/orchestrator/src/services/conversation-compact.ts:425-434` (`compactedInto` stamped only after the LLM resolves)

Evidence:
```ts
}).catch((error) => {
  console.error('conversation: AI compaction failed', …);
}).finally(() => {
  this.compactingThreads.delete(key);   // next message starts a SECOND pass on identical content
});
```
Why it's a bug: on LLM failure/timeout (default 180s), no source is marked `compactedInto`; the guard is released while the orphaned LLM call still runs; the next published message launches another full-thread read + a fresh summary of the same batch. A persistently failing summarizer means "summarization runs repeatedly" on every message with zero backoff.

Severity: HIGH.

### 22. HIGH — Self-note compaction is un-guarded: concurrent duplicate compactions + blocking full-channel scan per self-note write
File: `packages/orchestrator/src/services/conversation.ts:408-415`, `packages/orchestrator/src/services/conversation-compact.ts:58-77`
Evidence:
```ts
if (channel?.kind === 'self') {
  compactSelfNotesIfNeeded(…);   // no compactingThreads guard, no await, no catch
}
```
Why it's a bug: self channels never consult the `compactingThreads` set (the only dedupe guard lives in `scheduleConversationCompaction`). An agent posting several self-notes while the channel exceeds 500 rows starts concurrent compactions of the *same* oldest batch → duplicate `[[SELF_NOTE_SUMMARY_V1]]` rows and N different `compactedInto` stamps on the same sources; every duplicate summary then qualifies as an `activeSummary` and gets re-summarized next pass. Each self-note also blocks the write hot path on a full-channel pagination. `SELF_NOTE_RECENT_RAW_COUNT = 15` (conversation-compact.ts:22) is dead code — the intended "keep recent raw notes" tail is never implemented.

Severity: HIGH.

### 23. HIGH — Summary-of-summary drift: 280/1200/300+300-char truncations destroy context across compaction hops
File: `packages/orchestrator/src/services/conversation-summary.ts:389-432, 451-453`
Evidence:
```ts
function oneLine(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 280);
}
// compactionSummaryExcerpt: lines.slice(0, 1_200)
// compactValue: `${normalized.slice(0, 300)} … ${normalized.slice(-300)}`
```
Why it's a bug: every normal message is cut to 280 chars; a prior summary row is re-transcribed via `compactionSummaryExcerpt` (≤1200 chars) — a 100-note self-note summary (~28k chars) loses >95% in one hop. Across repeated compactions, exact paths, decisions and checkpoints are silently destroyed — the "summarization drops content" symptom.

Severity: HIGH (data loss in agent context).

### 24. MEDIUM — `mergeFacts` unions bullet lists with no cap and feeds the whole accumulated JSON back as `previousSummary` (unbounded growth)
File: `packages/orchestrator/src/services/conversation-summary.ts:200-212, 236-248`
Evidence:
```ts
function mergeFacts(prev, next) {
  function union(a, b) { return [...new Set([...a, ...b])]; }  // no re-cap
```
Why it's a bug: a 10-chunk thread produces up to 60+ bullets in `previousSummary`, inserted verbatim into every later chunk's prompt; next compaction pass re-inserts the whole blob. Prompts grow without bound across repeated compactions.

Severity: MEDIUM.

### 25. MEDIUM — Auto-compaction runs exactly ONE 100-message pass per trigger while `clear` loops to completion; large threads drain one batch per message
Files: `packages/orchestrator/src/services/conversation-compact.ts:79-111, 247-263`
Evidence:
```ts
return mode === 'summarize'
  ? compactConversationPass(ctx, input)        // one pass, ≤100 messages
  : compactConversationUntilDone(ctx, input);  // loops (≤512 passes)
```
Why it's a bug: a 2,000-message thread over threshold compacts only 100 messages per trigger, and since `conversationNeedsCompaction` stays true, it drains one batch per published message — repeated summarization pass after pass on the same thread. A user-initiated `summarize` on a large thread is silently partial while `clear` wipes everything: asymmetric, undocumented.

Severity: MEDIUM.

### 26. MEDIUM — Token estimation ignores stamped `inputTokens`/`outputTokens` and excludes summary rows, so the "actual token" fast path never exists and the estimate systematically undercounts the prompt
Files: `packages/orchestrator/src/services/conversation-compact.ts:119-129, 131-157`, `packages/runtime-core/src/repositories/token-usage.ts:17-29`
Evidence:
```ts
// conversation-compact.ts:124-126 — comment promises stamped tokens…
// "Use actual token counts when available (stamped by persistMessageTokens)"
// …but the loop below only ever uses estimateTokensForValue (charLength/4).
```
Why it's a bug: `persistMessageTokens` stamps `message.inputTokens/outputTokens`, but `estimatePromptReplayTokens` never reads them; and `conversationNeedsCompaction` excludes compaction summary rows from the count even though those rows are in the prompt. Over repeated compactions the estimate says "under 0.7×window" while the real prompt is already over budget.

Severity: MEDIUM.

---

## E. Codex & Claude integrations

### 27. HIGH — `testProvider` reports success without any real API call ("Key present" = connected)
File: `packages/orchestrator/src/services/settings.ts:384-393`
Evidence:
```ts
const key = this.repo.getProviderCredential(organizationId, providerKey);
if (!key || key.trim() === '') { … }
return { provider: providerKey, ok: true, message: 'Key present' };
```
Why it's a bug: the "Test" button (and `/settings/providers/:name/test` route) reports "Connected" purely because a string is stored. A revoked/typo'd/wrong-account key passes; users proceed believing the provider works and the first run 401s.

Severity: HIGH (UX misdirection).

### 28. HIGH — "Claude Code connected" is decided by existence of `~/.claude/` directory, not credentials
File: `packages/orchestrator/src/utils/claude-code-auth.ts:17-25` (also duplicated in `apps/api/src/transport/routes/oauth.ts:175-182` and `settings.ts:376-382`)
Evidence:
```ts
export function hasClaudeCodeLogin(): boolean {
  const claudeDir = resolveClaudeHome();
  return existsSync(claudeDir);   // ANY ~/.claude, even after `claude auth logout`
}
```
Why it's a bug: `~/.claude/` exists on virtually every machine that ever installed Claude Code; `mkdir -p ~/.claude` alone passes. Status endpoints, provider test, and onboarding all report "connected"; `resolveAnthropicAccessToken` then returns the `'claude-code-session'` marker (claude-code-auth.ts:32-33) and the SDK subprocess fails auth at runtime. Never verifies `credentials.json` or the OAuth token.

Severity: HIGH.

### 29. MEDIUM-HIGH — Codex: a stored `~/.codex/auth.json` token silently replaces the operator-configured bearer
File: `packages/llm/src/codex-responses.ts:57-80`
Evidence:
```ts
return async (request, init) => {
  const refreshed = await maybeRefreshStoredToken();
  if (refreshed) {
    bearer = refreshed.accessToken;   // replaces explicitly configured token
    …
  }
```
Why it's a bug: if the machine's codex CLI is logged in as account B, every request authenticates as B regardless of the operator's configured token (and 401s also swap in the stored token, lines 71-78). `refreshStoredTokenOnce` also rewrites the user's CLI `auth.json` from inside the app. Billing/ACL goes to the wrong account; the configured key is silently discarded.

Severity: MEDIUM-HIGH.

### 30. MEDIUM — Update-provider form cannot switch auth mode (regression from 57bce038) and silently resets to `apikey` on provider change
Files: `apps/web/src/features/settings/organization/components/providers/provider-form-modal.tsx:146, 94-101`
Evidence:
```tsx
onAuthModeChange={isUpdate ? undefined : handleAuthModeChange}
…
setAuthMode("apikey");   // unconditional on provider change
```
Why it's a bug: in update mode the toggle is disabled — a saved OpenAI/Anthropic provider can't switch between API key / Codex / Claude Code without delete-and-re-add, which looks editable but isn't. The add flow silently discards a previously selected auth mode when switching providers.

Severity: LOW-MEDIUM.

### 31. MEDIUM — Claude Code SDK sets `HOME` from `CLAUDE_CODE_HOME` for spawned CLI (env hijack for child processes)
File: `packages/llm/src/claude-code-sdk.ts:252-260`
Evidence:
```ts
if (configuredHome) {
  env.CLAUDE_CONFIG_DIR = configuredHome;
  env.HOME = dirname(configuredHome);   // rewrites HOME for the CLI and ALL children
}
```
Why it's a bug: with `CLAUDE_CODE_HOME=/var/lib/ujima/claude`, spawned `claude` subprocess children (git, ssh, credential helpers) resolve `$HOME/.ssh`, `$HOME/.config` etc. under the wrong directory — breaking known_hosts, agent sockets, and loading unexpected configs.

Severity: MEDIUM.

### 32. MEDIUM-LOW — Model defaults/catalogs are stale and silently rewritten
Files: `packages/llm/src/select.ts:257-266` (`normalizeDeepSeekModelId` rewrites `deepseek-chat`/`deepseek-reasoner` → `deepseek-v4-flash`), `packages/shared/src/model-catalog.ts:122-135` (OpenRouter default `openai/gpt-4o` absent from its own options list)
Why it's a bug: users' chosen model is silently swapped to a different (cheaper) model, or the default auto-filled model is retired/absent from the catalog the same UI lists — first run fails or runs on the wrong model with no warning.

Severity: MEDIUM-LOW.

---

## F. Efficiency / UX (backend + frontend)

### 33. MEDIUM-HIGH — Workflow-run detail endpoint: ~3N DB queries per run + loads every run step only to keep the last 60; polled every 2.5s
Files: `apps/api/src/transport/routes/workflows.ts:257-292` (`getRun`, `getMember`, `listRunSteps` per node; `.slice(-60)`), `apps/web/src/features/workflows/use-workflow-run.ts:41-46` (2.5s interval, no in-flight guard, interval re-armed on every `detail` change)
Why it's a bug: a 12-node run with hundreds of steps means thousands of rows parsed per request, repeated ~24×/minute while active; overlapping fetches when responses exceed 2.5s.

Severity: MEDIUM-HIGH.

### 34. MEDIUM — Shell job panes poll every 700ms with no `document.hidden` guard (unbounded body, ~85 req/min from a hidden tab)
File: `apps/web/src/features/workspace/components/chat/background-shell-job-pane.tsx:15, 64-89`
Why it's a bug: the main use case is leaving the tab in the background while a job runs; every other poller in the codebase gates on visibility (use-workflow-approvals.ts:99, channel-view.tsx:111) — this one doesn't.

Severity: MEDIUM.

### 35. MEDIUM — MCP tab: one full tool-schema request per server just to render an "N tools" badge; failures silently swallowed (`catch {}`)
File: `apps/web/src/features/settings/organization/components/mcps-tab.tsx:131-156, 187-202`
Why it's a bug: opening the tab fires N `/api/settings/mcps/:id/tools` requests (full schemas over the wire); failures leave a permanently empty tools column with no hint.

Severity: MEDIUM-LOW.

### 36. MEDIUM — Workflow approval banner swallows failures: approving a blocking gate that fails looks identical to success
File: `apps/web/src/features/workflows/workflow-run-approval-banner.tsx:33-43`
Evidence:
```ts
} catch {
  // leave it; the poll will refresh
}
```
Why it's a bug: if the approval POST fails, the button stops spinning and the operator reasonably believes the gate was approved while the run stays stuck.

Severity: MEDIUM.

### 37. MEDIUM — MCP server deletion has no confirmation (unlike every other destructive action in the app)
File: `apps/web/src/features/settings/organization/components/mcps-tab.tsx:204-221`
Why it's a bug: deletes org-wide server config (agents using it 404 on their next MCP call) on a single click; workflows-list and notifications-tab both confirm before destructive actions.

Severity: MEDIUM-LOW.

### 38. LOW — Whole-board 1-second tickers re-render entire subtrees (`setNow(Date.now())`)
Files: `apps/web/src/features/workspace/components/channel-goals-board.tsx:76-79`, `…/reasoning-trace-panel.tsx:96`
Why it's a bug: every goal card / trace tree re-renders each second regardless of change.

Severity: LOW.

---

## G. DRY / spaghetti opportunities ("do more with dramatically less")

1. **HIGH leverage — Route-handler boilerplate duplicated across ~63 of 95 API route files.** The shared `proxyDaemonRoute` (`apps/web/src/app/server/proxy-daemon-route.ts:22-56`) exists but only ~28 routes use it; the other 63 inline the same `daemonFetch` + `parseApiError` + `upstreamUnavailable` try/catch (~700-1,200 lines). Add `proxyRoute(path, init, fallback)` and rewrite all handlers to one-liners.
2. **HIGH — Client fetch/error boilerplate repeated 53+ times** across settings/workspace components; `settingsFetch`/`settingsFetchVoid` (`apps/web/src/features/settings/shared/settings-api.ts:14-36`) is used by only 14 files while 77 inline `fetch(` calls remain. Promote to a shared `jsonFetch` in `@/lib/client-api` (~250-400 lines).
3. **HIGH — Tool-pane dispatch chain copy-pasted in 5 renderers** (`details-sidebar.tsx:34-99`, `chat-message.tsx:294-345`, `aggregated-run-panel.tsx:855-889`, `approval-card.tsx:335+`, `onboarding/components/tool-call-panel.tsx:26-53`). Extract one `ToolStepPanes({step})` component (~80-150 lines).
4. **HIGH — Message-marker constants/predicates implemented 3×** — `conversation-summary.ts:5-19` + `conversation-compact.ts:481-483` (`isMessageWithAnyMarker`) + `chat-message.tsx:25-32, 444-445` re-declares the same markers. Move to `packages/shared/src/messages.ts`; eliminates marker-drift risk (this review found marker drift consequences in Findings 22/25).
5. **HIGH — Polling `useEffect` skeleton near-verbatim in 4+ hooks** (`use-workflow-approvals.ts:93-129`, `workflow-runs-indicator.tsx:22-49`, `use-workflow-run.ts:41-46`, `background-shell-job-pane.tsx:60-107`). One `usePolling(loader, ms, {pauseWhenHidden})` hook; also fixes Finding 34 by defaulting the visibility guard on.
6. **MEDIUM — Settings tab scaffolding copied across 8 tabs** (`heartbeats`, `schedules`, `notifications`, `self-improvement`, `workspaces`, `agents`, `providers`, `mcps`): same `[items/loading/error]` + mount-guard + `toggleStatus/deleteItem` + `SettingsListRow` shell (~200-300 lines).
7. **MEDIUM — Giant files with mixed responsibilities**: `reasoning-trace.ts` (1818), `chat-input.tsx` (1680), `channel-view.tsx` (1456), `use-conversation-sync.ts` (965), `workspace-store.ts` (921), `aggregated-run-panel.tsx` (911), `mcps-tab.tsx` (629); packages: `services/index.ts` (2095 — barrel + 3 real services: split `wake-events.ts`, `agent-delegate.ts`, `api-services.ts`), `conversation.ts` (1408), `mcp-registry.ts` (1294), `tool-service-impl.ts` (1137).
8. **MEDIUM — Inline agent/member mutations in `workspace-shell.tsx:234-341` bypass the existing `workspace-api.ts`/`settings-api.ts`**; same shape in `workspace-sidebar.tsx:324/346/403` and `channel-members-tab.tsx:103-156`.
9. **MEDIUM — `workspace-store.ts:756-765` `receiveMessage` has two literally identical branches** — dead code masking the intent behind Finding 13.
10. **LOW — copy-to-clipboard micro-pattern repeated 6×** (chat-message.tsx:583, provider-credential-field.tsx:194, install-command.tsx:16, terminal-pane.tsx:44, message-actions.tsx:41, +1) → `useCopyText()` hook; `formatDate` hand-written in 5 files while `lib/format-timestamp.ts` exists.

---

## Suggested fix order (highest leverage first)

1. **Approval-scope canonicalization** (F1+F2): keep args/content in canonical scopes for matching; one approval = one call. Highest security impact.
2. **Onboarding**: exempt `claude-code` properly (or require real credential check), auth + one-time + eviction guards on onboarding API, gate `continueFlow`/`navigateStep` on `accessibleSteps`, add provider-key presence check to the review step.
3. **Chat send race** (F13): scope `receiveMessage`/store feed by conversation key or abort/guard the send ack on switch.
4. **Summarization**: wire the dead `countUncompactedMessageChars` pre-check, add per-thread serialization + AbortController + backoff on failure (F20-F22), keep raw tail notes, cap `mergeFacts`.
5. **Provider honesty** (F27/F28): real test calls; check `credentials.json`/token, not directory existence.
6. **DRY wave 1**: shared `proxyRoute` + `jsonFetch` + `ToolStepPanes` + shared markers + `usePolling` — mechanical, ~1,500-2,000 lines removed.
