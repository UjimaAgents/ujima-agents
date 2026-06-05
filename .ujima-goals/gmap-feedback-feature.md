# GMap Feedback Feature

**Status:** planning
**Created:** 2026-06-04
**Owner:** Carter Jordan

## Goal

Add a feedback mechanism to the GMap sidebar so users can rate and comment on their experience. The feedback form appears via a sidebar toggle button (always accessible), and also auto-popups once per day when an agent has been working for more than 2 minutes. Feedback is stored in SQLite and viewable via an API and a Settings UI page.

## Fields

| Field | Required? | Notes |
|---|---|---|
| 5-star rating | Always | Clickable stars, 1-5 |
| Feedback text | Optional | Free-text |
| Email | Conditional | Required only when feedback text is filled |

## Triggers

1. **Manual:** Small toggle button in the sidebar bottom dock row (near user profile / workspace switcher)
2. **Auto-popup:** Once per day, when an agent has been in `"working"` state for > 2 minutes. Uses localStorage (`feedback-auto-shown-YYYY-MM-DD`) to enforce once-per-day.

## Design constraints

- Reuse existing `Modal` component (`@/components/ui/modal`)
- Reuse existing form field components (`@/components/ui/form-fields`)
- Follow sidebar styling patterns (zinc slate, violet accent)
- Star rating: custom component using lucide-react `Star` icon

## Delivery

- **DB migration** in `packages/context-store/src/db.ts` — new `029_feedback` migration creates `feedback` table
- **Repository** in `packages/runtime-core/src/repositories/feedback.ts` — `saveFeedback` / `listFeedback`
- **POST `/api/feedback`** — public (no auth), inserts feedback row
- **GET `/api/feedback`** — authenticated, returns feedback list (JSON)
- **Settings UI tab** — new "Feedback" tab in Organization Settings showing a table of entries

---

## Tasks

| # | Task | Owner | Depends on |
|---|---|---|---|
| 1 | Add `029_feedback` migration (feedback table) | Carter Jordan | — |
| 2 | Build StarRating component | Carter Jordan | — |
| 3 | Build FeedbackModal component (stars, text, email, conditional validation) | Carter Jordan | Task 2 |
| 4 | Add feedback toggle button to sidebar bottom dock | Carter Jordan | — |
| 5 | Implement auto-popup logic (2-min timer, localStorage once-per-day guard) | Carter Jordan | Task 3 |
| 6 | Create feedback repository (saveFeedback, listFeedback) + wire into Repository class | Carter Jordan | Task 1 |
| 7 | Create POST /api/feedback route (no auth, inserts feedback) | Carter Jordan | Task 6 |
| 8 | Create GET /api/feedback route (authed, returns JSON list) | Carter Jordan | Task 6 |
| 9 | Build Feedback tab in Organization Settings UI (table view) | Carter Jordan | Task 8 |
| 10 | Wire integration + manual smoke test | Carter Jordan | Tasks 3, 4, 5, 7, 8, 9 |
| 11 | Code review | Jerry Sloan | Task 10 |

## Decisions

- **DB storage (SQLite) over email:** Zero external dependencies, zero API keys, zero cost. Viewable via API + Settings UI. Chosen 2026-06-04.
- **Both API + Settings UI for viewing:** GET route for programmatic access, Feedback tab for in-app viewing. Chosen 2026-06-04.
- **localStorage for once-per-day guard:** No server-side state needed. Resets daily. Chosen 2026-06-04.
- **Sidebar bottom dock placement:** Subtle, always accessible, near user profile area. Chosen 2026-06-04.
- **No auth on POST:** Feedback submission should be frictionless. GET requires auth (only org members view). Chosen 2026-06-04.
