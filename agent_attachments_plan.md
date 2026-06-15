# Agent-generated attachments — PR plan

A small, focused PR that lets agents post screenshots, generated files, and other binary artifacts into the chat. Builds entirely on the existing user-attachment infrastructure (storage, frontend rendering, multimodal `toModelMessages`) — no parallel systems.

## 1. The scenario this unblocks

> _"@Layla use Playwright to take screenshots of the new flow, then send them to the PM."_

Today, Layla calls Playwright's screenshot tool, gets back a base64 image in the tool result, and has nowhere good to put it. Pasting base64 as text doesn't render and blows the next agent's context window. Describing the screenshot in words loses the visual evidence.

After this PR, Layla calls the screenshot tool → the daemon auto-captures the image from the tool result → Layla calls `channel.reply` referencing the captured artifact by tool-call id → message posts to channel with the image attached, `@PM` tagged. PM's next spawn loads the image as a multimodal `ImagePart` via the existing `toModelMessages` path — PM literally sees the screenshot.

## 2. What exists today vs. what's missing

A pre-implementation audit of the conversation + channel tool surface revealed the substrate is half there:

| Layer | Today |
|---|---|
| `message_attachments` table + storage path under `.ujima-dev-home/attachments/` | ✅ Built for user uploads |
| Frontend `AttachmentGrid` renders the message_attachments rows | ✅ |
| `toModelMessages` packs `image` rows as `ImagePart`, `document` rows as `FilePart` into the LLM payload | ✅ |
| `ConversationService.sendMessage` accepts `attachmentIds: string[]` | ✅ |
| `ConversationService.sendDirectMessage` accepts `attachmentIds: string[]` | ✅ |
| `ConversationService.replyToMessage` accepts `attachmentIds` | ❌ Bug — param dropped silently |
| `channel.reply`, `channel.post`, `channel.dm` agent tools | ❌ Body-only; no attachments param at all |
| Agent-callable way to create an attachment row | ❌ Web UI multipart upload is the only producer today |
| Bridge from workspace file (`workspace_root/foo.png`) to attachment row | ❌ Doesn't exist |

What agents do today when they write a file: they post a string in the message body — _"I wrote the screenshot to `workspace/screenshots/login-flow.png` — take a look."_ The user has to navigate manually. PM agents reading the channel don't see the image; their multimodal model input has no `ImagePart` for it.

So the PR has three things to wire end-to-end:

1. Fix the silent `replyToMessage` attachmentIds drop (small bug).
2. Add the `attachments` param to the three channel tools.
3. Add an agent-callable path that turns either a captured tool result OR a workspace file into an attachment row.

Two reasons this is still a self-contained PR (not a Phase-2 dependency):

1. **No new trust boundary.** Posting a message to a channel is already a thing agents do. Adding an attachments-bearing variant doesn't open a new trust boundary the way attaching MCPs or executing shell commands does.
2. **No parallel infrastructure.** The frontend rendering, LLM transit, and DB schema all already exist for user uploads. The new path joins the existing one at a single column (`attachment_id`), not at a new table or rendering pipeline.

## 3. Design

### 3.1 Storage substrate

New table `agent_attachments` — distinct from `message_attachments` so the lifecycle is independent.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `aatt_<uuid>` |
| `organization_id` | TEXT | scoping |
| `run_id` | TEXT | which agent run produced this |
| `member_id` | TEXT | which agent (audit attribution) |
| `source_tool_call_id` | TEXT | the tool call whose result was captured |
| `source_server_id` | TEXT NULL | which MCP, when known |
| `source_tool_name` | TEXT NULL | which tool on that MCP |
| `category` | TEXT | `image`, `document`, `audio`, `video`, `archive`, `other` |
| `mime_type` | TEXT | sniffed from the bytes |
| `filename` | TEXT | agent-supplied or auto-named |
| `storage_path` | TEXT | relative to `.ujima-dev-home/attachments/agent-generated/` |
| `byte_size` | INTEGER | quota accounting |
| `created_at` | TEXT | ISO timestamp |
| `pinned_to_message_id` | TEXT NULL | set when referenced by a posted message; pinned rows survive cleanup |

Storage path convention: `agent-generated/<orgId>/<runId>/<uuid>.<ext>`. Writes through `Bun.file` per [packages/shared/CLAUDE.md](packages/shared/CLAUDE.md).

The lifecycle:
1. Tool result is auto-captured → row created with `pinned_to_message_id=NULL`.
2. Agent calls `channel.reply` referencing the capture → row updated with `pinned_to_message_id`, AND a parallel `message_attachments` row is created so the existing frontend + `toModelMessages` paths see the file the same way they see a user upload.
3. Unpinned rows older than N hours (default 4) get cleaned up by an LRU job — Playwright snapshot dumps that the agent never sent to anyone shouldn't sit on disk forever.

### 3.2 Tool-result auto-capture (the hybrid model)

When a tool result returns from an MCP invocation, a post-processing pass inspects the payload for capturable artifacts. Three signals determine whether to capture:

| Signal source | Behavior |
|---|---|
| Mime detection succeeds AND registry entry says nothing | Capture. Covers custom org MCPs + non-curated entries — the safe default. |
| Registry entry has `capturesAttachments: ['image']` (or `['document']`, etc.) | Capture aggressively. For known image-generators (Playwright, Figma, charting MCPs) where mime detection on raw bytes can be ambiguous. |
| Registry entry has `capturesAttachments: 'never'` | Skip even if mime detection succeeds. For MCPs that produce structured data the agent should reason about directly, not stuff into the file store. |
| No registry match AND mime detection fails | Skip. Don't false-positive on raw text dumps. |

So the registry hint is a **modifier**, not the gate. Default is mime detection; the hint widens for trusted image-generators and narrows for trusted non-image MCPs.

`RegistryEntry` gains an optional field:

```typescript
capturesAttachments?: Array<'image' | 'document' | 'audio' | 'video'> | 'never';
```

For PR scope, we add hints to **Playwright** (`['image']`) and **fetch** (`'never'` — its output is meant for the agent to read, not store) only. Other entries get the mime-detection default.

The capture writes to the agent_attachments store and surfaces a `attachment_refs` array in the tool result's structured output:

```typescript
{
  ok: true,
  output: { /* the original tool result */ },
  // PR-attach: NEW field — refs to anything the daemon captured
  attachment_refs: [
    { ref: 'tc_call123:0', category: 'image', filename: 'screenshot-1.png', byteSize: 184321 }
  ]
}
```

The agent reads this and knows it can pass `'tc_call123:0'` to `channel.reply`'s `attachments` param.

### 3.3 channel.reply / post / dm extension

The three channel-tool variants gain an optional `attachments` parameter, with four `refType`s covering the real source-of-bytes cases an agent actually faces:

```typescript
attachments?: Array<{
  refType: 'tool_call' | 'base64' | 'workspace_path' | 'workspace_glob';
  value: string;
  filename?: string;
  mimeType?: string;
}>;
```

| refType | Source | Used for | Bounds |
|---|---|---|---|
| `tool_call` | Auto-captured tool result | Playwright screenshots, charting MCP output | Already in agent_attachments store; no rewrite |
| `base64` | Inline bytes | Programmatically-built tiny artifacts | 1 MB hard cap; rejects rather than truncates |
| `workspace_path` | A single file under `workspace_root` | Agent-written CSV exports, log dumps, single screenshots | 10 MB per file; path-escape guarded |
| `workspace_glob` | A glob pattern under `workspace_root` | Bulk — "send all screenshots in `workspace/screenshots/`" | Max 10 matched files; combined 20 MB cap; mime sniffed per file |

`workspace_path` and `workspace_glob` close the gap the user-flagged: today an agent writes `workspace/screenshots/login.png` via shell or Filesystem MCP, then has no way to surface the file in chat beyond pasting the path as text. With these refTypes, the agent says `attachments: [{ refType: 'workspace_path', value: 'screenshots/login.png' }]` and the file appears in the channel.

Important detail on the workspace refTypes: **files are COPIED into the agent_attachments store** at attach time, not referenced in place. That's a deliberate choice — chat messages are immutable, workspace files are not. If the agent later overwrites or deletes `workspace/screenshots/login.png`, the message attachment is unaffected. Costs a write but is the only durable design.

`workspace_glob` upper bounds matter for safety: an agent that does `attachments: [{ refType: 'workspace_glob', value: '**/*' }]` shouldn't dump the entire workspace into a channel. The 10-file / 20MB cap stops that. Anything over either limit fails the tool call with a clear error so the agent narrows the pattern.

The tool body resolves each ref:
* `tool_call` → look up the existing `agent_attachments` row, pin it.
* `base64` → decode, sniff mime, write to `agent_attachments` store.
* `workspace_path` → resolve relative to `workspace_root`, reject `..` segments and absolute paths, copy to agent_attachments store.
* `workspace_glob` → expand under `workspace_root`, apply caps, copy each matched file.

After resolution, each attachment gets a parallel `message_attachments` row, and the message is posted via the existing `sendMessage` / `replyToMessage` / `sendDirectMessage` path (with the `replyToMessage` bug fix from §2 above).

From there, the existing pipeline takes over: `AttachmentGrid` renders the images, the next agent that gets the message sees them as `ImagePart` in `toModelMessages`.

### 3.4 Audit + quota

* **Audit event** `agent_attachment_created` emitted on every capture (not just every send). Operators can grep their audit log for "what files did Layla generate this week," independent of which got posted to channels.
* **Quota** — per-org `agent_attachment_quota_bytes` setting, default 1 GB. Accumulation tracked via `byte_size` sum across all rows. When a new capture would push the org over quota, the LRU cleanup job runs synchronously to free space; if it can't, the capture is dropped (the tool result still reaches the agent — the daemon just doesn't store the bytes, and the `attachment_refs` array is empty).
* **Cleanup job** — runs hourly under PR 9's `SchedulerService`. Deletes unpinned `agent_attachments` rows older than 4 hours (configurable). Pinned rows are never auto-deleted; they survive as long as the parent message survives.

## 4. What's NOT in this PR

* **Permission gate by size/mime.** Mentioned in the design conversation but deferred. Start permissive; add gating once we have data on what agents actually generate. The audit event makes this measurable.
* **Provenance chip in `AttachmentGrid`** ("Generated by Layla via playwright.snapshot 12s ago"). Nice-to-have UX polish; the data is in `agent_attachments` either way and can light up in a follow-up.
* **LLM image output.** This PR is about tool results being captured INTO the attachment system, not about the LLM itself emitting image bytes. Different scope, different SDK surface, different testing concerns.
* **Bulk per-message cap above 10 attachments.** The 10-file `workspace_glob` cap doubles as the per-message cap. Lift it when there's a real use case; agents that need 50+ files should batch into multiple messages.
* **Cross-message reference** — "attach this image that was sent in message 5 earlier." Separate concern; less common; raises permission questions about re-sharing content the agent didn't generate. Out of scope.
* **Symlinks instead of copies** for workspace_path / workspace_glob. Saves disk but breaks message immutability — a workspace file rewritten after attach would silently change what the message shows. The copy cost is the right tradeoff.
* **Globs outside `workspace_root`** (e.g. globbing into `.ujima-dev-home/attachments/`). Explicitly rejected. Globs are sandboxed to the workspace.
* **Re-attaching a user-uploaded file** the agent sees in an earlier message. Agents see those as `ImagePart` / `FilePart` already; they don't need a re-attach path to forward the same bytes to a different message.

## 5. Sequenced sections

Six sections, fits in one PR (~600 lines net, comfortably under the 2000 cap).

| Section | What | Lines |
|---|---|---|
| **A** | `agent_attachments` schema (migration) + repo methods | 90 |
| **B** | Tool-result auto-capture: mime sniffing, registry-hint check, file write, `attachment_refs` injection into the tool result | 150 |
| **C** | `channel.reply` / `channel.post` / `channel.dm` `attachments` param: four refTypes, pin-to-message, parallel `message_attachments` write. Includes the `replyToMessage` attachmentIds-drop fix. | 170 |
| **D** | Workspace path resolution: relative→absolute, path-escape guards, glob expansion with caps, copy-into-store | 90 |
| **E** | Audit event + LRU cleanup job + quota check | 60 |
| **F** | Tests: round-trip via stubbed Playwright result, hybrid capture decisions, workspace_path + workspace_glob bounds, quota enforcement, message multimodal transit, `replyToMessage` attachmentIds regression | 100 |

## 6. Implementation order within the PR

Build the storage substrate first (A), then auto-capture (B), then the channel-tool extension (C), then workspace path resolution (D). Each section is independently testable before the next layer lands.

Smoke tests once D ships:

**Tool-result auto-capture path** (validates A + B + C):
1. Manually call the Playwright MCP via curl with a screenshot tool.
2. Confirm the tool result has `attachment_refs` with the captured image.
3. Issue a `channel.reply` with `attachments: [{ refType: 'tool_call', value: <ref> }]` via the daemon API.
4. Confirm the message appears in the channel with the image rendered.
5. Spawn an agent on that channel; confirm its multimodal model input contains the image as `ImagePart`.

**Workspace path path** (validates D):
1. Drop a screenshot at `${workspace_root}/screenshots/test.png` via shell.
2. Issue a `channel.reply` with `attachments: [{ refType: 'workspace_path', value: 'screenshots/test.png' }]`.
3. Confirm the file was copied into agent_attachments (not just referenced) — overwrite the workspace file, the message still shows the original.
4. Issue a `channel.reply` with `attachments: [{ refType: 'workspace_glob', value: 'screenshots/*.png' }]`. Confirm all matched files attach (within caps).
5. Issue a `channel.reply` with a glob that matches > 10 files. Confirm the tool call fails cleanly with the cap-exceeded error.
6. Issue a `channel.reply` with `value: '../etc/passwd'`. Confirm path-escape rejection.

## 7. Open decisions

Lockable at implementation time:

1. **Auto-capture mime fallback** — when mime sniffing fails on a `Buffer` payload but the tool result has a `mimeType` field nearby, trust the field? Probably yes; tools that bother to declare mime are signaling intent.
2. **Cleanup TTL** — 4 hours vs 24 hours for unpinned rows. 4 hours covers a single agent task end-to-end; 24 hours covers the case where an operator wants to grep "what did Layla generate yesterday." Recommend 4 hours initially; revisit from disk-usage data.
3. **Per-attachment size cap** — 10 MB per file. Anything bigger is probably a code/data export that wants a different home (S3 ref, etc.).
4. **Quota overflow behavior** — drop the capture vs reject the tool call. Recommend drop-the-capture so the agent's run keeps moving and the operator sees the audit signal in the data layer.

## 8. Cross-references

* The user-attachment substrate this extends: [apps/web/src/app/api/attachments/](apps/web/src/app/api/attachments/), [apps/web/src/features/workspace/components/chat/attachment-grid.tsx](apps/web/src/features/workspace/components/chat/attachment-grid.tsx)
* The LLM multimodal pipeline this rides: [packages/orchestrator/src/utils/to-model-messages.ts](packages/orchestrator/src/utils/to-model-messages.ts) (`ImagePart` / `FilePart` packing)
* The MCP tool-result shape this hooks: [packages/orchestrator/src/tools/connector-meta-tools.ts](packages/orchestrator/src/tools/connector-meta-tools.ts) (invoke_connector_tool's result envelope)
* The channel tools that get the `attachments` param: [packages/orchestrator/src/tools/channel.ts](packages/orchestrator/src/tools/channel.ts) (`channelReplyTool`, `channelPostTool`, `channelDmTool`)
* The conversation-service surface attachments thread through: [packages/orchestrator/src/services/conversation.ts](packages/orchestrator/src/services/conversation.ts) — `sendMessage` and `sendDirectMessage` already accept `attachmentIds`; `replyToMessage` needs the small fix to forward it
* The workspace root resolver: [packages/orchestrator/src/services/workspace-root.ts](packages/orchestrator/src/services/workspace-root.ts) — `requireOrganizationWorkspaceRoot` plus the path-escape detection in [packages/orchestrator/src/services/policy.ts](packages/orchestrator/src/services/policy.ts) (`isPathInsideRoot`)
* The registry entries that gain the optional `capturesAttachments` hint: [packages/mcp-client/src/registry.ts](packages/mcp-client/src/registry.ts) (`RegistryEntry`)
* The scheduler the cleanup job runs under: [packages/orchestrator/src/services/scheduler.ts](packages/orchestrator/src/services/scheduler.ts) (PR 9's substrate)
* The audit emitter the new event extends: [packages/orchestrator/src/services/connector-audit.ts](packages/orchestrator/src/services/connector-audit.ts)
