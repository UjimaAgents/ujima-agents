# Local changes summary

**Generated:** 2026-05-09 (branch `web`, uncommitted working tree + untracked files)  
**Purpose:** Single reference.

---

## Scope

This document consolidates **all modifications in this working tree** (tracked diffs + new files) across web UI, packages, orchestrator, VS Code extension, and tooling.

---

## 1. Web — Reasoning trace (Message details)

| File | Notes |
|------|--------|
| `apps/web/src/features/workspace/reasoning-trace.ts` | **New.** Builds trace from `activity` + `runs`: runs, tool call/result pairing, approvals, human-readable channel/thread message titles; avoids duplicating full chat bodies on completed runs where applicable. |
| `apps/web/src/features/workspace/components/reasoning-trace-panel.tsx` | **New.** Scrollable timeline, empty state, optional auto-scroll while runs are active. |
| `apps/web/src/features/workspace/components/channel-view.tsx` | Wires trace builder + panel into **Reasoning trace** tab; per-tab placeholder content for Changes/Metadata; auto-scroll when trace tab open and runs active. |
| `apps/web/src/features/workspace/components/chat/details-sidebar.tsx` | `TraceStepData.status` includes **`failed`**; styling/icons for failed steps. |

---

## 2. Web — Runs tab & blocked-tool visibility

| File | Notes |
|------|--------|
| `apps/web/src/features/workspace/components/channel-view.tsx` | Maps **`tool_result`** errors to **`runId` → blocked reason** for display. |
| `apps/web/src/features/workspace/components/run-card.tsx` | Optional **`blockedReason`** prop — surfaces policy/error text on the card. |

---

## 3. Web — Agent editor (Tools UX)

| File | Notes |
|------|--------|
| `apps/web/src/features/workspace/components/workspace-sidebar.tsx` | **Tools:** discoverable names from presets + team roles + draft; **chip toggles** + existing CSV field; deduped sorted lists. |

---

## 4. Web — Onboarding & workspace root (Windows)

| File | Notes |
|------|--------|
| `apps/web/src/features/onboarding/components/onboarding-form.tsx` | **Browse** for workspace root (POST to API), loading/error UI; manual path still supported. |
| `apps/web/src/app/api/onboarding/pick-workspace-root/route.ts` | **New.** Windows-only: PowerShell `FolderBrowserDialog` → JSON `{ path }` or `{ cancelled: true }`. |
| `apps/web/src/features/onboarding/api-contract.ts` | Provider entries include **`kind: provider.name`** in built request payload. |

---

## 5. Web — Conversation SSE stream

| File | Notes |
|------|--------|
| `apps/web/src/app/api/conversations/stream/route.ts` | Thread verify: apply verified channel/member scope only when **`verifyResponse.ok`**; avoids hard 403 when verify response is not OK (behavior change — review before release). |

---

## 6. Shared — Schemas & model catalog

| File | Notes |
|------|--------|
| `packages/shared/src/org-schemas.ts` | **`Message.reasoningContent`** optional — persisted model reasoning / API echo. |
| `packages/shared/src/model-catalog.ts` | DeepSeek options: **`deepseek-chat-v2`** (v2-friendly label), **`deepseek-chat` (latest)**, **`deepseek-reasoner`**. |

---

## 7. LLM package (`packages/llm`)

| File | Notes |
|------|--------|
| `packages/llm/src/select.ts` | DeepSeek via **`createOpenAI`** + **`DEEPSEEK_BASE_URL`**, not `@ai-sdk/deepseek`; **`normalizeDeepSeekModelId`**. Removed **`withDefaultReasoning`** from OpenAI-compatible proxies (OpenRouter, Ollama, DeepSeek, xAI, Mistral, Kimi, Zhipu, OpenAI-Codex) to avoid forcing thinking/reasoning modes that require echoed **`reasoning_content`** without DB replay. Native adapters keep reasoning middleware where appropriate (see file comments). |

---

## 8. Orchestrator — Reasoning persistence & model messages

| File | Notes |
|------|--------|
| `packages/orchestrator/src/utils/extract-reasoning.ts` | **New.** **`extractReasoningChunk`** from AI SDK-style results (`reasoningText`, `reasoning`, `steps`). |
| `packages/orchestrator/src/services/run.ts` | Attach **`reasoningContent`** to agent message after **`generateRunReply`** when present. |
| `packages/orchestrator/src/services/spirit.ts` | Persist **`reasoningContent`** per spirit step message when present. |
| `packages/orchestrator/src/utils/to-model-messages.ts` | Assistant messages with reasoning → **`content`** array with **`reasoning`** + **`text`** parts for next-turn API compatibility. |

---

## 9. Orchestrator — Shell tool

| File | Notes |
|------|--------|
| `packages/orchestrator/src/tools/shell.ts` | **`spawn`**: **`shell: true`** only on **Windows** (cmd builtins); Unix/macOS use direct spawn so POSIX **`sh`/`cat`** in tests still resolve. **`windowsHide`** on Windows. |

---

## 10. Orchestrator — Dashboard overrides

| File | Notes |
|------|--------|
| `packages/orchestrator/src/services/dashboard-team-overrides.ts` | Sanitize role **`channels`** to names that exist on the team before merging overrides. |

---

## 11. VS Code extension

| File | Notes |
|------|--------|
| `apps/vscode-extension/src/vscode-lm-provider.ts` | **`isModelUnsupported`** matches **`unsupported model version`** for LM candidate fallback. |
| `apps/vscode-extension/ujima.vsix` | **Removed from version control**; rebuild locally (`package` script). Ignored via `*.vsix` in `.gitignore`. |
| `apps/vscode-extension/.stage/` | Ignored via **`.gitignore`** (`**/.stage/`); do not commit. |

---

## 12. Repo tooling / generated

| File | Notes |
|------|--------|
| `package.json` | **`dev`**: `turbo run dev --concurrency=100` (was `--parallel`). |
| `bun.lock` | Lockfile updates. |
| `apps/web/next-env.d.ts` | References **`.next/dev/types/routes.d.ts`** for Next dev types. |

---