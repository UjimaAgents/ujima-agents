# UX Critique: Ujima Web Frontend

**Goal:** Identify and document all suboptimal UX patterns in the Ujima web frontend codebase.

**Status:** Completed

**Owner:** Ethan Parker (Frontend Engineer)

---

## 1. Onboarding Flow

### 1a. Hardcoded `min-w-[1024px]` layout
Forces horizontal scrollbar on viewports under 1024px. The stepper + form could stack/compress instead.

**Severity:** High — Blocks use on smaller screens.
**Fix:** Use responsive stacking or a min-width that matches actual content needs.

### 1b. Nested wizard-within-wizard for "team" step
Team step has 5 tabs (Agents, Channels, Org Chart, Policies, Providers) cycled linearly via Next/Back with per-tab validation. No global progress indicator. `activeTeamTab` persisted to localStorage — refresh mid-way lands on an arbitrary tab.

**Severity:** Medium — Confusing, context loss on refresh.
**Fix:** Add mini-progress indicator inside the team step. Allow non-linear access once a tab is complete.

### 1c. Slash commands use dangerous exact-match pattern
`/clear` rewrites textarea content and triggers a confirmation overlay. Typing `/clear` accidentally hijacks the input.

**Severity:** Medium — Destructive action on false positive.
**Fix:** Require space or enter after command, or use an autocomplete dropdown.

### 1d. Native `window.confirm()` for deletion
Role deletion uses browser-native confirm dialog. Rest of the app uses custom modals.

**Severity:** Low-Medium — Inconsistent.
**Fix:** Replace with the existing `ConfirmModal` component.

---

## 2. Workspace Layout & Sidebar

### 2a. "Show 10 more" pagination, no "Show All"
Channels/agents paginate 10 at a time via a small non-obvious text button. Each click re-renders and causes layout shift.

**Severity:** Medium — Friction for large teams.
**Fix:** Add "Show all" shortcut or virtualized scrolling.

### 2b. Search input is decorative / non-functional
`<SearchInput>` with placeholder "Search" and `⌘K` badge — no onChange handler wired to filtering. Does nothing.

**Severity:** High — Misleading, wastes prime UI slot.
**Fix:** Wire real search/filter or remove the control.

### 2c. Resize handle has poor discoverability
~4px drag handle with `GripVertical` icon only on hover. No cursor change in default state.

**Severity:** Low — Feature hidden.
**Fix:** Show faint grip icon at all times or widen the hit area.

### 2d. Workspace switcher chevron useless for single-org
Chevron always visible. If only one org exists, clicking does nothing (menu doesn't render).

**Severity:** Low — Misleading affordance.
**Fix:** Conditionally hide the chevron.

---

## 3. Chat Area (Channel View)

### 3a. Virtualizer uses fixed estimated row height (132px)
All messages estimated at 132px — short messages get padded space, long code blocks compressed until measured. Scroll jumpiness.

**Severity:** Medium — Visible jank.
**Fix:** Dynamic estimator based on message type/content.

### 3b. Chat tabs lack keyboard navigation
No arrow key support, no Home/End. Users must tab through each button individually.

**Severity:** Low-Medium — Accessibility gap.
**Fix:** Add arrow key handling with roving tabindex (ARIA tab pattern).

### 3c. Message composer has unclear send mechanism
Enter = send, Shift+Enter = newline — not indicated anywhere. Accidental sends.

**Severity:** Medium — Accidental sends.
**Fix:** Add helper text or a visible send button.

### 3d. Message actions only appear on hover
Edit/delete/copy buttons hidden until hover. Unusable on touch devices.

**Severity:** High — Broken on mobile/touch.
**Fix:** Persistent three-dot menu on every message, or touch detection fallback.

### 3e. Slash command menu vanishes on textarea blur
Dropdown disappears on blur before click registers on options outside the textarea boundary.

**Severity:** Low — Frustrating edge case.
**Fix:** Use onMouseDown for option selection or add debounce on blur.
