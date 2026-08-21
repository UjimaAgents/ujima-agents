# Workspace UI/UX Review — 2026-08-21

Full-surface review of the workspace frontend (`apps/web/src/features/workspace/`), covering the chat thread, tasks/activity/channel surfaces, and app shell/navigation. Three areas per finding: what to **improve**, what to **remove/unify** (visual repetition), and what interactions to **add**. Paths relative to `apps/web/src/features/workspace/` unless noted.

## A. High-impact UX problems

1. **Messages can't be text-selected** — every message row has `cursor-pointer select-none` (`components/chat/chat-message.tsx:271`) but no `onClick`; copying is right-click-menu-only (`components/message-actions.tsx:67-74`). Fake affordance + broken selection.
2. **Expand/collapse state resets on scroll** — expansion lives in local state inside virtualized rows; opened "Show more" panels snap shut while scrolling long threads (`chat/expandable-output.tsx:15`, `channel-view.tsx:924-954`).
3. **Browser Back leaves the app** — all navigation uses `router.replace`; a hand-rolled in-app history stack compensates (`workspace-shell.tsx:196-207, 286-318`) and has stale-closure bugs. Swap to `router.push`.
4. **Open tabs are lost on reload/share** — tab working set lives only in `useState`, never persisted or URL-synced (`workspace-shell.tsx:166-187`).
5. **No responsive layout at all** — zero breakpoints in shell/sidebar/tab bar; fixed-percentage sidebar always visible; unusable on mobile.
6. **Unsaved-changes: no guards anywhere** — AgentEditorModal discards large drafts on Cancel/backdrop/Escape silently (`sidebar/agent-editor-modal.tsx:57, 190-197`); no `beforeunload` anywhere in `apps/web`.
7. **Esc wipes composer draft** — with slash menu open, Escape clears the entire editor instead of closing the menu (`chat/chat-input.tsx:1489-1494`).
8. **Reply undiscoverable & mouse-only** — reply via context menu or invisible drag-right gesture; keyboard users have no path (`chat/chat-message.tsx:134-160`).
9. **Approval flow friction** — resolving requires reaching the bottom rail; 4-button grid stacks vertically on mobile pushing composer off-screen; "Reject" is first DOM button; "Always allow" has no confirmation (`chat/approval-card.tsx:389-415`).
10. **Board status information loss** — blocked/failed/cancelled fold into "Pending"; cards show no status pill at all; cancelled tasks vanish entirely with no toggle (`tasks/goal-task-board.tsx:38-46, 54-56, 194-197`).
11. **Drag-and-drop is mouse-only** — native HTML5 DnD on task board; no keyboard/touch alternative, no ARIA drop targets (`tasks/goal-task-board.tsx:188-190, 526-530`).
12. **Broken "Assigned" filter** — keeps any task with any assignee, never compares to current user (`tasks/workspace-tasks-view.tsx:270-274`).
13. **Inconsistent completion handover** — same action = blocking `window.prompt` in workspace view vs styled Modal in channel view (`tasks/workspace-tasks-view.tsx:216` vs `channel-goals-board.tsx:409-447`).
14. **Activity feed dead-end** — flat wall capped at 100 rows silently discarded, no day grouping/type filter/load-more, rows not clickable despite `task_id` present, relative timestamps go stale (`channel-view.tsx:83, 867`, `activity-row.tsx:13, 28`).
15. **Command palette breaks its promise** — placeholder says "channels, agents, messages…" but messages/files result types are defined yet never produced (`command-palette.tsx:30-35, 121`, `workspace-shell.tsx:682-705`).
16. **Font-size control buried + dead component** — shipped control hidden two levels deep in kebab menu; `FontSizeControl` exported but mounted nowhere; `SIZE_OPTIONS` duplicated in both files (`chat/collapsible-header-actions.tsx:74-105`, `chat/font-size-control.tsx:16-96`).
17. **Workspace switcher hard-reloads** — `window.location.href` on every switch, loses SPA state (`switch-workspace.ts:9-11, 23`).
18. **Misleading search empty state** — sidebar filter miss renders "No channels yet / Add channel" when items exist but query failed (`workspace-sidebar.tsx:559-564, 600-605`).

## B. Visual repetition → unify or remove

19. **~250 duplicated lines between two task surfaces** — fetchGoalBoard, goal switcher, counts, refresh effects, action handlers copy-pasted between `channel-goals-board.tsx` and `tasks/workspace-tasks-view.tsx`. Extract one `useGoalBoard(channelId?)` hook.
20. **Five hand-rolled tool-pane headers** — TerminalPane, BackgroundShellJobPane, FilesystemToolPane, GrepToolPane, WebSearchToolPane each re-implement header chrome over the same panel bg (`chat/*-pane.tsx`). One `ToolPaneHeader`.
21. **Four card-shell languages in one thread** — zinc CardShell, violet TERMINAL_PANEL, always-dark artifact card, semantic border-foreground panes. Pick one system (`chat/goal-task-cards.tsx:61-76`, `chat/terminal-chrome.ts:15-16`, `chat/chat-message.tsx:604`, `chat/aggregated-run-panel.tsx:446+`).
22. **7+ status-badge implementations with contradictory colors** — failed = amber in chat cards vs red in run panels vs error in primitives; cancelled = amber/zinc/grey depending on screen. One canonical `StatusPill` needed (`chat/goal-task-cards.tsx:27-45`, `chat/aggregated-run-panel.tsx:303-327`, `chat/primitives.tsx:39-83`, `tasks/goal-task-board.tsx:482-489`).
23. **Six skeleton files are one component** — only count/widths differ; approvals tab even loads MemberListSkeleton for its own list. One parametric `<ListSkeleton>`; delete dead ApprovalListSkeleton/SidebarSkeleton (`*skeleton*.tsx`, `channel-view.tsx:1044`).
24. **Identical modal footer trio ×3** — Cancel/primary button pair copy-pasted across create-channel/create-agent/agent-editor modals; plus two competing field-label systems and copy-pasted error paragraphs. Extract ModalFooter/button variants.
25. **Copy-paste siblings** — ExpandableRow/Chevron twins (`chat/aggregated-run-panel.tsx:31-36, 678-704` ≡ `chat/skill-read-pane.tsx:45-78`); dashed marker rows written twice (`chat/chat-message.tsx:202-260`); AvatarStack ×3 (`primitives.tsx:106-132`, `typing-indicator.tsx:43-61`, `approval-card.tsx:310-316`).
26. **Three different jump-to-latest pills & four stop buttons** — inconsistent pill styles/icons; Stop rendered 4 ways (`channel-view.tsx:1093-1105, 1110-1119`, `reasoning-trace-panel.tsx:315-357`, `chat-input.tsx:1623-1656`, `background-shell-job-pane.tsx:157-171`).
27. **Duplicate token formatters & timestamp conventions** — formatTokens vs formatTokenCount diverge; hour12 forced regardless of locale; invalid dates render as "now" (`lib/format-timestamp.ts:5, 9-13`).

## C. Missing interactions to add

28. **Message hover toolbar** — copy/reply/pin as visible hover actions replacing right-click-only access; pin/bookmark data field already exists but no UI reads/writes it (`chat-message.tsx:51`).
29. **Keyboard shortcuts beyond ⌘K** — ⌘1-⌘9 tab jump, ⌘W close tab, Escape closes menus/popovers (currently outside-click only), focus-composer hotkey, approve/reject hotkeys.
30. **Message/thread capabilities** — search within conversation, retry/regenerate failed turns, edit sent message, export thread, reactions; live streaming token ticker.
31. **Task management depth** — create/delete/archive tasks, due dates, priority/labels, bulk select/move, undo after drag-drop, sort control, assignee filter fix; link board cards → their channel/run (currently one-way from chat cards).
32. **Channel tasks tab has zero search/filter** — GoalTaskBoard accepts `searchQuery` but ChannelGoalsBoard never passes it (`channel-goals-board.tsx` vs `goal-task-board.tsx:329`).
33. **Palette/tab ergonomics** — make palette results match promise (messages/files), tab context menu, middle-click close, close-others, drag-to-reorder tabs, decouple "+" button from palette.
34. **Notification controls** — approval sound plays unconditionally via Web Audio, no mute/pref (`workspace-shell.tsx:645-651`); no per-channel notification prefs; unread treatment badge-only (no bold/read-state styling, no @mention differentiation).
35. **BackgroundShellJobPane auto-scroll fights reading** — unconditional scroll on every chunk, no near-bottom check; 700ms poll never pauses when tab hidden.

## D. Accessibility / guidelines violations

36. **div-onClick & semantics** — tab-bar tabs are divs without role/tabIndex (`workspace-tab-bar.tsx:78-80`); click-away overlays as bare divs (`../components/ui/modal.tsx:34-37`, `channel-members-tab.tsx:313`, `terminal-drawer.tsx:25-28`); message rows not keyboard-focusable.
37. **Icon-only buttons without aria-label** — details toggle (`chat-header.tsx:91-97`), drawer close (`terminal-drawer.tsx:49-55`), complete-toggle Circle/CheckCircle (`goal-task-board.tsx:444-458`), trash delete (`workspace-sidebar.tsx:486-500`), back/forward/close tab buttons (`workspace-tab-bar.tsx:53-70`).
38. **Focus states nearly absent** — ~3 styled focus states across entire chat surface; tabs, approval buttons, composer icon buttons, modals have none; Modal lacks focus trap / `role="dialog"` / `aria-modal` (`../components/ui/modal.tsx:15-58`).
39. **Missing aria-live regions** — streaming agent messages, approval arrivals, composer errors never announced (`chat-input.tsx:1204-1208`).
40. **Misc guideline violations** — `transition-all` at ~12 sites instead of explicit properties; perpetual `animate-pulse`/`animate-ping` without motion-safe guards (`terminal-drawer.tsx:38`, `details-sidebar.tsx:111`, etc.); IME composition bug — Enter-to-send ignores `isComposing`, fires sends during CJK input (`chat-input.tsx:1526-1529`); hardcoded date formats vs `Intl.*`; non-tabular numerals on live counters/countdowns; incomplete tablist ARIA (`chat-tabs.tsx:50-83`); unlabeled contentEditable composer (`chat-input.tsx:1399-1404`).

## Top 5 by leverage

1. Restore text selection + add hover toolbar on messages (#1, #28)
2. Swap to `router.push`, delete hand-rolled history stack (#3), persist open tabs (#4)
3. Extract `useGoalBoard` hook + parametric skeleton + one canonical StatusPill (#19, #23, #22)
4. Fix virtualization-killed expand state (#2) + Esc-in-composer (#7)
5. Modal primitive upgrade: focus trap, dirty guard, shared footer (#6, #24, #38)

## Method

Code-level review of ~40 workspace components across three passes (chat surface; tasks/activity/channel surfaces; shell/navigation/sidebar) checked against the Vercel Web Interface Guidelines. Line numbers reflect working tree at time of writing.
