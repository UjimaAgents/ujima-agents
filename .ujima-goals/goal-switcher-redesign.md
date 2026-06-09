# Goal Switcher — Kanban Redesign

**Status:** Planning
**Owner:** Carter Jordan
**Priority:** High (fixes a usability blocker)

## Problem

The kanban board (`ChannelGoalsBoard`) shows **all tasks from all goals** in one flat view. If you have 3 goals with 15 tasks each, you see 45 cards in a single kanban. There's no way to isolate one goal's workflow. You confirmed this is "terrible" and asked for a redo from first principles.

## Decisions (from Q&A)

| Decision | Choice |
|---|---|
| Pattern | Goal switcher dropdown → one goal at a time in the kanban |
| Placement | **Top of board, above kanban columns** — compact, no layout shift |
| First load | **Auto-select the most recently updated goal** — immediately useful |
| Dropdown item info | Goal title + task count (`completions / total`) |

## What's Changing

### 1. Task counts — client-side computation (no backend changes)

The frontend already receives all goals and tasks from `fetchGoalBoard`. We compute per-goal counts in a `useMemo`:

```ts
const goalTaskCounts = useMemo(() => {
  const counts: Record<string, {total: number; completed: number}> = {};
  for (const goal of goals) {
    const goalTasks = tasks.filter(t => t.goalId === goal.id);
    counts[goal.id] = {
      total: goalTasks.length,
      completed: goalTasks.filter(t => t.status === 'completed').length,
    };
  }
  return counts;
}, [goals, tasks]);
```

This avoids any schema changes or daemon work.

### 2. Component: `ChannelGoalsBoard`

#### State additions

```ts
const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
```

- Initialized to the most recently updated goal's id on first load (derived from `goals` array, sorted by `updatedAt`).
- Persisted in `localStorage` per `channelId` so it survives refresh: `key = "selectedGoalId:{channelId}"`.

#### Render: Goal dropdown (above kanban)

A styled `<select>` or custom dropdown at the top of the board area, above the column grid:

```
┌─────────────────────────────────────────────┐
│  [ Sprint 3 (4/6)          ▾  ]   + New Goal │
│  ├─ Sprint 3 (4/6)                          │
│  ├─ Bug Bash (8/12)                         │
│  ├─ Q2 Milestone (1/5)                      │
│  └─ Infrastructure Audit (0/3)              │
├─────────────────────────────────────────────┤
│  To Do    │  Blocked  │  In Progress │  Done │
│  ...      │  ...      │  ...         │  ...  │
└─────────────────────────────────────────────┘
```

**Dropdown items format:** `{title} ({completedCount}/{totalCount})`

- Uses `taskSummary` from the API.
- If a goal has 0 tasks, show `(0/0)` in muted style.
- Sorted by `updatedAt` descending (most recent first).

**"+ New Goal" button** next to the dropdown — opens the existing create-goal flow. This isn't new UI, just a more accessible surface for it.

#### Task filtering

The kanban renders `tasks.filter(t => t.goalId === selectedGoalId)` instead of all tasks.

The `columnTasks` memo already groups by status — just filter first:

```ts
const filteredTasks = useMemo(
  () => tasks.filter(t => t.goalId === selectedGoalId),
  [tasks, selectedGoalId]
);
const columnTasks = useMemo(() => groupByStatus(filteredTasks), [filteredTasks]);
```

#### Question filtering

Pending questions are filtered to the selected goal:

```ts
const pendingQuestions = questions.filter(
  q => q.status === "pending" && (q.goalId === selectedGoalId || !q.goalId)
);
```

Questions without a `goalId` (channel-level questions) always show regardless of selected goal. Goal-scoped questions only show when that goal is active.

#### Empty state (goal with no tasks)

If the selected goal has zero tasks, show a centered empty state:
> "This goal has no tasks yet. [Implement plan →]" (reusing the existing `handleImplement` flow)

#### What doesn't change

- Drag-and-drop, status updates, nudge countdowns, handover prompts, question cards — all stay identical.
- The `fetchGoalBoard` function signature stays the same (it already returns all goals and tasks).
- No new API routes needed — only an enrichment to the existing goals list response.

### 3. Edge cases

| Scenario | Behavior |
|---|---|
| Auto-select when goals list loads | Pick max `updatedAt`. On first visit ever, auto-select the most recent goal. |
| Goal gets archived/deleted mid-session | On refresh, if `selectedGoalId` no longer exists, fall back to most recent remaining goal. |
| User switches channel | `selectedGoalId` is keyed by `channelId` in localStorage — they're independent. |
| Only 1 goal exists | Dropdown still shows, single item auto-selected. Dropdown is harmless — user sees the goal name and task count. |
| 0 goals exist | Empty state: no dropdown, prompt to create a goal. |

## Files Changed

| File | Change |
|---|---|
| `apps/web/src/features/workspace/components/channel-goals-board.tsx` | Add goal switcher dropdown, task filtering, question filtering, localStorage persistence |
| *(No backend changes required — all counts computed client-side)* |

## Completion

✅ All changes implemented and verified.

### Files changed
- `apps/web/src/features/workspace/components/channel-goals-board.tsx` — full rewrite of header/s election/filtering

### What was built
1. **GoalSwitcherDropdown** — native `<select>` styled to match UI, sorted by recency, shows `title (completed/total)`, "Implement" button appears next to dropdown when a planning goal is selected
2. **Derived goal selection** (`activeGoalId`) — fallback chain: user's explicit pick → localStorage → most recently updated goal. No setState-in-effect violations.
3. **"All Goals" dropdown option** — shows all tasks across every goal when selected; user intent tracked with ref to prevent localStorage fallback overriding the choice
3. **Task filtering** — kanban only shows tasks for the active goal
4. **Question filtering** — goal-scoped questions only show when that goal is active; channel-level questions always show
5. **localStorage persistence** — survives refresh, per-channel key
6. **Empty states** — "No goals yet" (goals.length === 0) and "No tasks" with Implement button (goal with 0 tasks)
7. **Status indicator** — colored dot + status label + task count below the dropdown

### Verified
- TypeScript: 0 errors
- ESLint: 0 errors, 0 warnings
- Tests: 31/31 passed across 5 test files
- Drag-and-drop, status updates, question cards, nudge countdowns all unchanged

**Total estimated effort:** ~1 session of focused work. The changes are scoped narrowly — no new APIs, no new component imports, just filtering and a dropdown.
