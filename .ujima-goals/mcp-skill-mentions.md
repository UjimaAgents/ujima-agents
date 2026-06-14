# MCP & Skill @-Mention Support

**Status:** Implementation Complete — Pending Build Verification  
**Owner:** Carter Jordan  
**Started:** 2026-06-14  

## Goal

Add `@mcp:name` and `@skill:name` references to the unified `@`-mention system alongside existing `@file:path` / `@folder:path`. Covers the suggestion menu, insertion, parsing, and rendered chip display in messages.

## Progress

### ✅ Phase 1: Shared Types & Patterns

- **ASSET_REF_PATTERN** in `packages/shared/src/mentions.ts` — updated to `/@(file|folder|mcp|skill):.../g`
- **MentionSuggestion.kind** in `chat-input.tsx` — added `'mcp' | 'skill'` union
- **WorkspaceAssetHit** in `chat-input.tsx` — added `'mcp' | 'skill'` to kind
- **assetKindHint()** — handles `mcp:` and `skill:` prefixes
- **assetSearchQuery()** — strips `mcp:` and `skill:` prefixes

### ✅ Phase 2: Backend API Endpoints

- **`GET /workspaces/mcps`** in `apps/api/src/transport/routes/workspaces.ts` — returns `{ kind: 'mcp', name, id, detail }` from `mcpRegistry.list(orgId)`
- **`GET /workspaces/skills`** in `apps/api/src/transport/routes/workspaces.ts` — returns `{ kind: 'skill', name: skillName, id, detail: pluginName }` from `repo.listOrganizationSkillInstalls(orgId)`

### ✅ Phase 3: Frontend — Suggestion Loading & Menu

- **loadMcpSuggestions()** and **loadSkillSuggestions()** — fetch from API, cache with 60s TTL
- **Wired into mention useEffect** — fetches MCPs and Skills alongside workspace assets
- **groupedMentionSuggestions** — includes `mcps` and `skills` arrays with filtering
- **mentionMenuSections** — "MCPs" and "Skills" sections added
- **insertMention()** — handles `kind === 'mcp'` and `kind === 'skill'`
- **SVG icons** — arrow-right icon for MCP (emerald), zap icon for Skill (purple)

### ✅ Phase 4: Rendering — Chip Display

- **highlightFileReferences** in `markdown.tsx` — extended with mcp (emerald arrow) and skill (purple zap) SVG icons
- **`data-asset-ref` attribute** added alongside `data-file-ref` for all asset kinds
- **Click handler** — works generically with `data-file-ref` attribute, no changes needed

### 🔲 Phase 5: Verification

- [ ] Verify TypeScript compilation
- [ ] Manual smoke test (restart servers, test menu + chips)

## Changed Files

| File | Changes |
|------|---------|
| `packages/shared/src/mentions.ts` | ASSET_REF_PATTERN: added `mcp\|skill` |
| `apps/api/src/transport/routes/workspaces.ts` | Added `/workspaces/mcps` and `/workspaces/skills` endpoints; updated search query prefix strip |
| `apps/web/src/features/workspace/components/chat/chat-input.tsx` | Types, helpers, loaders, useEffect, grouping, sections, icons, insertMention |
| `apps/web/src/features/workspace/components/markdown.tsx` | highlightFileReferences extended with mcp/skill icons and data-asset-ref |

## Syntax

- **@mcp:server-name** — references an MCP server by name
- **@skill:skill-name** — references a skill by its skillName

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
| 12 | Update exports, imports, verify build | 🔲 |
| 13 | Manual smoke test (server restart + UI check) | 🔲 |
