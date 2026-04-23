# Ujima Agents Plan

**Product plan for the five-part agents system.** This version keeps the shape of the original Seyi-style plan, but it is focused on the five ideas you asked for and avoids implementation details. The goal is to make the system feel coherent, shippable, and easy to reason about.

**Ordering principle:** build the substrate first, then the private worker, then the human workflow, then the durable output, then recurring automation.

---

## Principles

1. **One clear work surface.** The main agent handles conversations. The spirit handles focused work. Users should always know which surface is doing what.
2. **Tools are first-class.** Tool definition should be consistent, explicit, and easy to maintain.
3. **Human direction stays central.** The user should be able to assign, inspect, and steer work without fighting the system.
4. **Outputs should be durable.** Important work should leave a report trail that can be opened later inside the workspace.
5. **Recurring work should be scheduled, not improvised.** Repetition belongs to cron jobs, not ad hoc prompt hacks.
6. **Keep the system simple.** Avoid layered abstractions when a direct model is enough.

---

## Current State

The product already has the foundations needed for this plan:

- agent onboarding exists
- agent execution loops already exist
- provider and API key plumbing already exist
- messaging and channels already exist
- workspace-bound tool execution already exists

What is missing is the cleaner product shape: a private working self, a real task surface, durable report output, and recurring job support.

---

## Epic Order

| | Epic | Why it starts here |
|---|---|---|
| **E0** | **Standard tool system** | Every later milestone depends on a clean tool layer. This is the substrate, so it comes first. |
| **E1** | **Spirit / private worker** | The focused-work model is the core behavioral change. It unlocks a quiet worker that can think and act without channel noise. |
| **E2** | **User-managed task manager** | Once the spirit exists, the user needs a direct way to assign and track work across top-level agents. |
| **E3** | **Reports folder** | Reports become the durable handoff for completed work and make agent output visible in the workspace. |
| **E4** | **Cron jobs** | Recurring work is easiest to add after the execution model, task flow, and report output already feel stable. |

---

## E0 — Standard Tool System

**Goal:** make tools a clean, predictable part of the platform instead of a scattered set of special cases.

### What changes

- Each tool lives in its own file.
- Each tool has one place for its schema and one place for its execution logic.
- Tool registration becomes obvious and easy to scan.
- The tool layer stops leaking implementation details into unrelated parts of the system.

### Why this comes first

- Spirit work will depend on tools.
- Task execution will depend on tools.
- Reports will depend on tools that write or collect output.
- Cron jobs will depend on tools that can be reused cleanly.

### Done when

- tools are easy to find
- tool behavior is easy to trace
- adding or removing a tool is not a cross-project scavenger hunt

---

## E1 — Spirit / Private Worker

**Goal:** give each main agent a private working self that can do focused work without being distracted by normal channel traffic.

### What changes

- The agent can split into a main conversational self and a focused spirit.
- The spirit works on a specific task without being interrupted by regular messages.
- The main agent still stays visible in conversations.
- The main agent can check on the spirit and relay progress.
- The spirit is the place for concentrated execution, not public chatter.

### Why this comes second

- It is the core behavioral shift in the whole plan.
- It creates the separation between conversation and work.
- It gives the system a cleaner mental model than trying to make every agent do everything in one loop.

### Done when

- an agent can create a private working copy of itself
- the spirit can complete focused work independently
- the main agent can report progress back to users and the team
- channel noise does not derail focused work

---

## E2 — User-Managed Task Manager

**Goal:** give the user a direct task surface for assigning work to the next top agent or group of agents under them.

### What changes

- Tasks become a user-managed list, not just something the system infers.
- The user can create, assign, inspect, and update tasks directly.
- Tasks map cleanly to the relevant top agent or team.
- Task state becomes visible and intentional instead of hidden behind promotion logic.

### Why this comes third

- It depends on the spirit model to actually do the work.
- It gives the user control after the worker model exists.
- It replaces vague automatic promotion with something explicit and useful.

### Done when

- the user can manage tasks as a real queue
- tasks clearly show ownership and status
- tasks move cleanly into focused work
- the system no longer needs to guess which conversations should become work

---

## E3 — Reports Folder

**Goal:** make completed work easy to store, browse, and reuse in the workspace.

### What changes

- When an agent is onboarded, a Reports folder is created for it inside the workspace.
- The agent writes reports there through the file tool.
- Reports are readable as workspace files, not hidden runtime artifacts.
- Users can inspect agent output later without digging through logs or chat history.

### Why this comes fourth

- Reports are only valuable once there is real work to report on.
- The spirit and task manager create the need for durable output.
- The folder model is simple and practical, so it should come after the work model is stable.

### Done when

- every agent has a natural place to publish work
- reports are visible in the workspace
- completed tasks can leave behind a durable record
- users can review progress without opening runtime internals

---

## E4 — Cron Jobs

**Goal:** let users schedule repeated coordination between agents or teams.

### What changes

- Users can create recurring jobs for specific agents or groups.
- Scheduled work runs on a reliable cadence.
- The output of recurring work can flow into reports and task status.
- Repeatable operations become a first-class product feature instead of a manual habit.

### Why this comes last

- Recurring work depends on a stable worker model.
- It also depends on the task surface and report output being understandable.
- If cron arrives too early, it adds complexity before the core experience is clear.

### Done when

- users can schedule repetitive agent work
- jobs run predictably
- results are easy to inspect
- cron feels like a natural extension of the system, not a bolt-on

---

## Risks

1. **Spirit overlap.** If the main agent and spirit blur together, the system becomes confusing. The boundary has to stay sharp.
2. **Tool sprawl.** If tools are not standardized early, every later feature becomes harder to maintain.
3. **Task ambiguity.** If tasks are still inferred instead of managed, users will not trust the queue.
4. **Report clutter.** If reports are not structured enough, the folder becomes noise instead of value.
5. **Cron creep.** If recurring jobs are added before the core workflow is stable, they will feel like extra complexity.

---

## Deferred

These are intentionally not part of this plan:

- multi-workspace orchestration
- marketplace-style sharing
- advanced memory systems
- conflict referee machinery
- dashboard-specific product work

The point of this plan is to keep the product shape clear, useful, and shippable without widening the surface area too early.
