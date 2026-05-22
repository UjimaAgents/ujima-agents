# UX Critique: Ujima Web Frontend

**Status:** Completed
**Date:** 2026-05-22
**Reviewer:** Ethan Parker (Frontend Engineer)

---

## Goal

Conduct an extensive UX critique of the Ujima web frontend (`apps/web`), identifying areas where the user experience is suboptimal, inconsistent, or broken. Deliver a documented artifact that the team can prioritize and action.

---

## Findings

### 1. Onboarding Flow

**1a. Hardcoded `min-w-[1024px]` on the onboarding layout**
- Forces horizontal scroll on any viewport under 1024px.
- Makes onboarding unusable on smaller screens.
- Odd choice for self-hosted software that might be opened on various machines.

**1b. The "team" step has 5 nested tabs (Agents, Channels, Org Chart, Policies, Providers) but the user cycles linearly via Next/Back.**
- No global progress indicator showing "3 of 5 team tabs complete".
- `activeTeamTab` persisted to localStorage — refresh mid-way lands you on a tab without context, triggering validation errors.
- Feels like a sub-wizard within a wizard with no escape hatch.

**1c. `/clear` slash command triggers a confirmation pattern that imperatively rewrites the textarea.**
- Typing `/clear` replaces your actual input with a confirmation overlay.
- If you start typing `/clear` by accident, you get a destructive action prompt.
- False positive risk is real and jarring.

**1d. Onboarding role deletion uses `window.confirm()` — a native browser dialog.**
- The rest of the app uses custom modals.
- This inconsistency breaks the polished feel.

---

### 2. Workspace Layout & Sidebar

**2a. "Show 10 more" pagination for channels/agents**
- Each click reveals only 10 more items. No "Show all" option.
- Expand-in-place causes re-renders and scroll position jumps.
- A virtualized list with search would be far better.

**2b. Sidebar search input is purely decorative**
- `placeholder="Search"` with a `Cmd+K` badge, but no `onChange` handler or search logic wired.
- Looks functional, does nothing. Misleading.

**2c. Sidebar resize handle lacks visible affordance**
- `GripVertical` icon only appears on hover over a 4px-wide divider.
- Users who don't know to hover won't discover the resize feature.
- No resize cursor shown by default.

**2d. Workspace switcher chevron always visible but does nothing for single-org setups**
- Chevron renders regardless, but the dropdown only shows when `organizations.length > 1`.
- For single-org users, the chevron is a dead UI element.

---

### 3. Chat Area (Channel View)

**3a. Virtualizer estimate fixed at `132px` for all message rows**
- Short and long messages allocated the same estimated height.
- Causes visible "jumpiness" during scrolling as the virtualizer remeasures.
- Overscan of 8 helps but doesn't eliminate the jank.
- Could use a content-aware estimator (text length * factor + base).

**3b. Chat tabs lack keyboard navigation**
- No arrow key, Home/End support for Conversation/Members/Approvals/Files/Activity tabs.
- Active indicator is a bottom border, nothing else changes.
- Tab order via Tab key is not clearly scoped.

**3c. Messages component re-mounts when channel changes**
- `key={channelId}` on parent wrapper causes full remount.
- Scroll position, loaded history, and UI state reset unconditionally.
- Transition animations or cached state would make switches smoother.

**3d. Code blocks lack a "copy" button**
- Long code snippets require manual selection + copy.
- Standard UX pattern: floating copy icon on hover.

**3e. Message timestamps use relative format without absolute tooltip**
- "2 hours ago" shown as text. No tooltip reveals exact timestamp.
- Users can't tell if a message from yesterday was 2pm or 10pm.

**3f. Slash commands have no discoverability**
- Slash menu only appears after typing `/`.
- New users don't know what commands exist until they try one.
- If command doesn't match, entire `/something` is sent as a message.
- No inline help panel or command palette to browse available commands.

**3g. Empty channel state is plain text**
- "No messages in this channel" with no illustration or CTA.
- No suggestion on how to start (e.g., "Send the first message" or invite prompt).

---

### 4. Theme & Visual Consistency

**4a. Theme context loads `base.theme` from API but with no loading skeleton**
- On slow connections, the app flashes with default (likely light) theme, then switches to dark if configured.
- No theme loading state — jarring flash.

**4b. Font scale appears inconsistent across components**
- Message body, sidebar items, and tab labels use different font sizes and weights in different components.
- No centralized typography system visible — inline `text-sm`, `text-xs`, `font-medium` scattered.

**4c. Color palette tokens are used inconsistently**
- Some elements use `bg-primary`, some use hardcoded `bg-blue-600`, others use `bg-[#customHex]`.
- This makes future theming or dark mode tuning harder and creates visual drift.

---

### 5. Modals & Overlays

**5a. Multiple modal patterns exist**
- Some use a custom `Modal` component, others use ShadCN-style dialog, some use raw `div` overlays.
- Dismiss behavior is inconsistent: some modals close on Escape, some on backdrop click, some require explicit Cancel/Close button.

**5b. Confirmation dialogs vary in placement and styling**
- `/clear` uses a confirmation panel inline in the chat area (not a modal).
- Delete actions use a centered modal.
- This inconsistency is confusing — inline confirmation doesn't feel like a real "are you sure?" moment.

---

### 6. Error States & Feedback

**6a. No global error boundary visible**
- If a React component crashes, there's no fallback UI — likely a white screen.
- No "Something went wrong" or "Reload" button.

**6b. API error handling in forms rarely shows inline field errors**
- Form submission errors appear as a generic toast or not at all.
- No per-field error messages under inputs.

**6c. Loading states are inconsistent**
- Some async actions show spinners, some show nothing, some show skeleton placeholders.
- No standard pattern for "loading" vs "empty" vs "error" states.

---

### 7. Responsive & Mobile

**7a. The entire chat layout assumes desktop viewport**
- Sidebar, channel list, and message area are positioned with absolute/fixed layouts.
- No breakpoint handling for tablet or mobile.
- Drag-to-resize sidebar doesn't make sense on touch devices.

**7b. No mobile navigation pattern**
- No hamburger menu, no bottom tab bar, no swipe gestures.
- The app is effectively desktop-only, which limits adoption.

---

## Recommendations Summary

| Priority | Issue | Suggested Fix |
|----------|-------|--------------|
| High | Sidebar search does nothing | Wire `onChange` to filter channel/agent list |
| High | No keyboard nav on chat tabs | Add arrow key handlers + aria roles |
| High | Virtualizer jank | Use dynamic height estimation |
| High | No responsive layout | Add breakpoints, mobile nav |
| Medium | Inconsistent modal patterns | Audit and standardize to one modal system |
| Medium | No error boundary | Wrap app in React error boundary |
| Medium | Code blocks need copy button | Add copy-on-hover to code blocks |
| Medium | Onboarding layout locked at 1024px | Remove min-width, add responsive stacking |
| Low | Dead chevron for single-org users | Conditional render based on org count |
| Low | Resize handle affordance | Show grip icon always, not just on hover |
| Low | Native confirm() dialog | Replace with custom modal |
| Low | Slash command discoverability | Add `/` menu trigger button or help panel |
| Low | Message timestamp tooltips | Add `title` attribute with absolute time |

---

## Files Referenced

- `apps/web/app/(onboarding)/**` — Onboarding wizard
- `apps/web/components/chat/**` — Message list, virtualizer, input
- `apps/web/components/sidebar/**` — Channel list, search, resize handle
- `apps/web/components/ui/**` — Modal, dialog, button components
- `apps/web/providers/**` — Theme, auth, bootstrap providers
- `apps/web/hooks/**` — Custom hooks for chat, sidebar, etc.
