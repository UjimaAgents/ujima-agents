# Asset Tagging Feature — Plan

## Goal
Let users and agents reference workspace files and folders via `@` syntax in the composer input (UI) and in README-style markdown documents rendered in the chat. References should resolve to clickable links that open/preview the file.

## Current State (researched)
- **`@`-mentions for members** already exist: `findMentionTrigger()` in `chat-input.tsx` detects `@`, shows a member suggestion popup, and `highlightMentions()` in `markdown.tsx` renders them with a `<span>` class. The server-side `scanMentionsInContent()` in `shared/src/mentions.ts` resolves mentions to member IDs.
- **Artifact files** are tracked via `WorkspaceFileSchema` (org-schemas.ts) and stored in DB FTS index. `artifact-file-card.ts` emits `card.artifact.file` cards.
- **No file tree/explorer** exists in the sidebar yet. No asset autocomplete or `@file` syntax in markdown.

## Scope

### Phase 1 — File Tree & API (Backend)
1. **Add `WorkspaceFileNodeSchema`** to `packages/shared/src/org-schemas.ts` — a recursive tree node type (file/folder, name, path, children[])
2. **Add `GET /api/workspace/tree` endpoint** — returns the workspace file tree (respecting workspace boundary, filtering sensitive files)
3. **Add `GET /api/workspace/search` endpoint** — full-text search across workspace files by name/path
4. **Wire into bootstrap** — include the file tree in the bootstrap response so the UI has it immediately

### Phase 2 — Composer Unified `@` Menu (UI)
5. **Replace the existing member-only mention popup with a unified `@` menu** — when the user types `@`, a single menu shows categorized suggestions:
   - **Members section** — existing member name suggestions (agents, humans)
   - **Files section** — workspace files matching the typed query
   - **Folders section** — workspace folders matching the typed query
   - Each section has a header label and icon
6. **Extend `MentionSuggestion` type** to include `kind: 'member' | 'file' | 'folder'` and relevant metadata (path, icon, kind badge)
7. **Add `@`-trigger detection** — detect `@` followed by any text. Reuse `findMentionTrigger()` but expand the detection to allow path characters (`/`, `.`, `-`, `_`). 
8. **Fetch suggestions** from two sources simultaneously:
   - Channel members (existing, for `member` kind)
   - Workspace search endpoint (new, for `file`/`folder` kind) — called when the query looks like a file path or after a brief delay
9. **Render the menu** with:
   - Section headers ("Members", "Files", "Folders")
   - File/folder icons and truncated path for asset suggestions
   - Keyboard navigation (`↑`/`↓`, `Enter` to select)
10. **Insert the reference on select** based on kind:
    - `member` → `@DisplayName` (existing behavior)
    - `file` → `@file:relative/path.ts`
    - `folder` → `@folder:relative/path/`

### Phase 3 — Markdown Rendering (UI)
10. **Extend `renderMarkdown()` and `highlightMentions()`** in `markdown.tsx` to detect `@file:path` and `@folder:path` patterns and render them as clickable file badges/links
11. **Add `AssetFileChip` component** — a small inline badge showing the filename with an icon and a click handler to open/preview the file
12. **Wire click handler** to open the file in a side panel or trigger a file preview

### Phase 4 — Agent-Side README References
13. **Add a tool or syntax** for agents to reference files in their markdown artifacts — this could be the same `@file:path` syntax that the markdown renderer already handles
14. **Ensure artifact file cards** (`artifact-file-card.ts`) scan agent-written markdown for asset references and link them properly on render

### Phase 5 — Server-Side Resolution
15. **Extend `scanMentionsInContent()`** or create `scanAssetReferencesInContent()` to resolve `@file:path` tokens for notifications/permissions
16. **Add file path validation** — reject references outside the workspace boundary or to sensitive files

## Key Design Decisions

### Reference Syntax
**Decision: Option A — `@file:relative/path.ts`** (confirmed by owner).

The explicit `@file:` / `@folder:` prefix makes asset references unambiguous to parse and keeps them easily distinguishable from member name `@`-mentions. The renderer regex can target `@file:` and `@folder:` directly without heuristics.

### File Tree API
The workspace file tree should be:
- Lazy-loaded (not serialized into bootstrap for large workspaces)
- Filtered by the same `isSensitiveWorkspacePath()` logic
- Cached client-side with a TTL or refresh mechanism

### Search Endpoint
- Returns files matching a name/path fragment
- Limited to workspace-scoped paths
- Supports the autocomplete use case (fast prefix/partial matches)

## Task Breakdown

| # | Task | Owner | Depends On |
|---|------|-------|------------|
| 1 | Add `WorkspaceFileNodeSchema` type to shared/org-schemas.ts | Backend | — |
| 2 | Add `GET /api/workspace/tree` endpoint (lazy file tree) | Backend | 1 |
| 3 | Add `GET /api/workspace/search` endpoint (name/path search) | Backend | 1 |
| 4 | Create `useWorkspaceFileTree` hook and `useWorkspaceFileSearch` hook | Frontend | 2, 3 |
| 5 | Extend composer `@`-mention to support file/folder suggestions | Frontend | 4 |
| 6 | Add file asset rendering in markdown.tsx (`@file:` and `@folder:` badges) | Frontend | — |
| 7 | Add `AssetFileChip` inline component with click-to-preview | Frontend | — |
| 8 | Add file path validation & resolution in mentions.ts (server-side) | Backend | — |
| 9 | Wire artifact file cards to render asset references | Backend | 6 |
| 10 | Test: composer autocomplete for files | QA | 5 |
| 11 | Test: markdown rendering of file references | QA | 6 |
| 12 | Test: workspace boundary enforcement | QA | 8 |

## Decisions (confirmed)
- **Reference syntax**: `@file:relative/path.ts` and `@folder:relative/path/` — explicit prefix, unambiguous.
- **File tree**: Full recursive tree, lazy-loaded via `GET /api/workspace/tree`, cached client-side with TTL/refresh.
- **Click behavior**: Opens file in a side preview panel.
- **Large workspaces**: No blocking concern — same pattern as VS Code file tree performance.
