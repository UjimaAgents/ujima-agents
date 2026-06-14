# MCP, Skill, Task & Culture @-Mention Support

**Status:** Implementation Complete — All Phases Done  
**Owner:** Carter Jordan  
**Started:** 2026-06-14  

## Goal

Add `@mcp:`, `@skill:`, `@task:`, and `@culture:` references to the unified `@`-mention system alongside existing `@file:path` / `@folder:path`. Covers the suggestion menu, insertion, parsing, and rendered chip display in messages. Also removed skills from the `/command` slash menu (they now use `@skill:` instead).

## Progress

### ✅ Phase 1: Shared Types & Patterns

- **ASSET_REF_PATTERN** in `packages/shared/src/mentions.ts` — updated to `/@(file|folder|mcp|skill|task|culture):.../g`
- **MentionSuggestion.kind** in `chat-input.tsx` — extended to `'member' | 'file' | 'folder' | 'mcp' | 'skill' | 'task' | 'culture'`
- **WorkspaceAssetHit** in `chat-input.tsx` — extended with optional `id` and `detail` fields
- **assetKindHint()** — handles all 6 prefix hints (file, folder, mcp, skill, task, culture)
- **assetSearchQuery()** — strips all 6 prefixes

### ✅ Phase 2: Backend API Endpoints

- **`GET /workspaces/mcps`** — returns `{ kind, name, id, detail }` from `mcpRegistry.list(orgId)`
- **`GET /workspaces/skills`** — returns `{ kind, name, id, detail }` from `repo.listOrganizationSkillInstalls(orgId)`
- **`GET /workspaces/tasks`** — returns `{ kind, name, id, detail: goalTitle }` from `repo.listGoalTasksByOrganization(orgId)`
- **`GET /workspaces/culture`** — returns `{ kind, name, id, detail }` from `listProceduresByScope(workspaceRoot, 'org', '')`
- Added `listGoalTasksByOrganization` DB function and `ApiRepository` interface method

### ✅ Phase 3: Frontend — Suggestion Loading & Menu

- **loadMcpSuggestions(), loadSkillSuggestions(), loadTaskSuggestions(), loadCultureSuggestions()** — fetch from API, cache with 60s TTL
- **Wired into mention useEffect** — all 4 loaders fire alongside workspace assets when mention trigger is active
- **groupedMentionSuggestions** — includes `mcps`, `skills`, `tasks`, `culture` arrays with filtering by name/detail
- **mentionMenuSections** — Members → MCPs → Skills → Tasks → Culture → Folders → Files
- **insertMention()** — handles all 6 asset kinds with correct `@kind:name` syntax
- **SVG icons** — MCP (emerald arrow), Skill (purple zap), Task (rose checklist), Culture (sky book)

### ✅ Phase 4: Rendering — Chip Display

- **highlightFileReferences** in `markdown.tsx` — extended with SVG icons for all 6 asset kinds
- **`data-asset-ref` attribute** added alongside `data-file-ref` for all asset kinds
- **Click handler** — works generically via `data-file-ref`, no changes needed

### ✅ Phase 5: Skills Removed from /command Slash Menu

- **Removed** `SlashSkillCommand` interface, `toSlashSkillCommands()` function
- **Removed** `skillCommands` prop from `ChatInputComponent` + all wiring
- **Removed** `kind === "skill"` branch from `runSlashCommand`
- **Removed** `skillCommands` computation and prop in `channel-view.tsx`
- **Cleaned up** exports from `chat/index.ts`
- Skills now only accessible via `@skill:name` mention system

### ✅ Phase 6: Verification

- TypeScript compilation passes for API and Web (zero errors)
- Backend packages built (runtime-core, orchestrator)

## Changed Files

| File | Changes |
|------|---------|
| `packages/shared/src/mentions.ts` | ASSET_REF_PATTERN: `mcp\|skill\|task\|culture` |
| `packages/runtime-core/src/repositories/goals.ts` | Added `listGoalTasksByOrganization()` |
| `packages/runtime-core/src/repositories/index.ts` | Wired through `Repository` class |
| `packages/orchestrator/src/services/repository-reader.ts` | Added to `ApiRepository` interface |
| `apps/api/src/transport/routes/workspaces.ts` | 4 new endpoints + search prefix strip updated |
| `apps/web/src/.../chat/chat-input.tsx` | Types, helpers, 4 loaders, useEffect, grouping, sections, icons, insertMention cases |
| `apps/web/src/.../markdown.tsx` | All 6 asset kind icons in chip rendering |
| `apps/web/src/.../channel-view.tsx` | Removed `skillCommands` prop and computation |
| `apps/web/src/.../chat/index.ts` | Removed skill slash-command exports |
| `apps/web/src/.../chat/chat-input.tsx` | Removed `toSlashSkillCommands`, `SlashSkillCommand`, `skillCommands` prop, skill branch from `runSlashCommand` |

## Syntax

| Prefix | Example | Detail shown | Icon |
|--------|---------|-------------|------|
| `@file:` | `@file:src/index.ts` | File path | Blue file |
| `@folder:` | `@folder:src` | Folder path | Amber folder |
| `@mcp:` | `@mcp:filesystem` | Server name | Emerald arrow |
| `@skill:` | `@skill:summarize` | Plugin name | Purple zap |
| `@task:` | `@task:Implement auth` | Parent goal name | Rose checklist |
| `@culture:` | `@culture:code-review` | Procedure description | Sky book |

## Task Board

| # | Task | Status |
|---|------|--------|
| 1 | Extend ASSET_REF_PATTERN + mention types | ✅ |
| 2 | Extend asset helper functions (kindHint, searchQuery) | ✅ |
| 3 | Add GET /workspaces/mcps API endpoint | ✅ |
| 4 | Add GET /workspaces/skills API endpoint | ✅ |
| 5 | Add MCP+Skill suggestion loaders in chat-input | ✅ |
| 6 | Wire into mention trigger useEffect | ✅ |
| 7 | Extend groupedMentionSuggestions + menu sections | ✅ |
| 8 | Extend insertMention() for mcp/skill | ✅ |
| 9 | Add SVG icons for MCP/Skill in suggestion list | ✅ |
| 10 | Extend highlightFileReferences for mcp/skill chips | ✅ |
| 11 | Update data attributes + click handler for new refs | ✅ |
| 12 | Add task + culture suggestion loaders, sections, icons, insertion | ✅ |
| 13 | Remove skills from /command slash menu | ✅ |
| 14 | Verify TypeScript compilation | ✅ |
