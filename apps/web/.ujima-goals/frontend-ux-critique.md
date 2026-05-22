# UX Critique: Ujima Web Frontend

**Status:** In Progress
**Date:** 2026-05-22
**Reviewer:** Ethan Parker (Frontend Engineer)

---

## Goal

Conduct an extensive UX critique of the Ujima web frontend (`apps/web`), identifying areas where the user experience is suboptimal, inconsistent, or broken. Then **fix all high-priority issues**.

---

## High Priority Tasks

| Task | Owner | Status |
|------|-------|--------|
| **HP-1: Wire sidebar search** | Ethan Parker | Pending |
| **HP-2: Keyboard nav on chat tabs** | Ethan Parker | Pending |
| **HP-3: Virtualizer dynamic height** | Ethan Parker | Pending |
| **HP-4: Responsive layout** | Ethan Parker | Pending |

---

### HP-1: Sidebar Search Does Nothing

**File:** `workspace-sidebar.tsx`

**Problem:** The search input at the top of the sidebar had `placeholder="Search"` and a Cmd+K badge, but no `onChange` handler or filtering logic. It looked functional but did nothing.

**Fix Plan:**
- Add `searchQuery` state
- Wire `onChange` to update the query
- Filter `visibleChannels` and `agentMembers` using case-insensitive match on name

---

### HP-2: No Keyboard Navigation on Chat Tabs

**File:** `chat-tabs.tsx`

**Problem:** The tab bar only supports mouse clicks. No arrow key navigation, no Home/End, no proper aria roles.

**Fix Plan:**
- Add `role="tablist"` on the container
- Add `role="tab"` and `aria-selected` on each button
- Add `onKeyDown` handler with Left/Right arrow keys, Home, End

---

### HP-3: Virtualizer Uses Fixed Height Estimation

**File:** `channel-view.tsx`

**Problem:** The virtualizer uses `estimateSize: () => 132` for all messages. Short messages get 132px allocated, long code blocks get compressed, causing scroll jumpiness.

**Fix Plan:**
- Replace fixed estimate with dynamic function based on content length
- Base height + text contribution + code block premium
- Clamp between min and max

---

### HP-4: No Responsive Layout

**Files:** `workspace-shell.tsx`, workspace page

**Problem:** Entire workspace layout assumes desktop viewport. Sidebar, channel list, and message area use absolute/fixed layouts with no breakpoint handling.

**Fix Plan:**
- Add sidebar collapse state
- Add hamburger toggle for mobile
- Add responsive breakpoint logic
