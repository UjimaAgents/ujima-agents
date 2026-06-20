# Ujima Heartbeat + Self-Improvement v1

## Goal
Ship a v1 automation system using the existing Schedules shape:
- **Heartbeat**: schedule-like agent wake with silent-by-default behavior
- **Self-improvement**: post-turn / heartbeat-triggered review that writes durable memory and procedures

## Locked Decisions
- Reuse the current Schedules model and UI shape; add Heartbeats and Self-improvement as tabs under the same Automation area.
- Heartbeat runs use a normal agent run with `wakeReason=heartbeat`.
- Heartbeat stays silent unless the agent has a real update.
- Self-improvement can write only through existing `memory.*` and `self.procedure.*` tools.
- No silent fallback for a missing review model.
- **Data model**: Add a `type` column (`'schedule' | 'heartbeat' | 'self_improvement'`) to the existing `scheduled_jobs` table. The scheduler branches on type.

## Files Changed

### Backend Schema + Persistence
- `packages/context-store/src/db.ts` — Migration `053_heartbeat_type` (type column) + `054_self_improvement_reviews` (new table)
- `packages/shared/src/org-schemas.ts` — Added `ScheduledJobTypeSchema`, `SelfImprovementReviewSchema`, type field on existing schemas
- `packages/shared/src/socket-events.ts` — Added `'heartbeat'` to WakeReasonSchema; added `jobType` to ScheduledJobExecutedEventSchema
- `packages/runtime-core/src/repositories/scheduled-jobs.ts` — Updated row mapping and upsert for type column
- `packages/runtime-core/src/repositories/self-improvement-reviews.ts` — New repo (CRUD for reviews)
- `packages/runtime-core/src/repositories/organization.ts` — Added reviews cleanup on org delete
- `packages/runtime-core/src/repositories/index.ts` — Wired new repo methods into Repository class

### Scheduler + Runtime
- `packages/orchestrator/src/services/scheduler.ts` — executeJob branches on type; heartbeats post with scheduleMode metadata
- `packages/orchestrator/src/services/heartbeat-prompt.ts` — New: heartbeat/self-improvement system prompt suffixes
- `packages/orchestrator/src/services/spirit-run-detail.ts` — Wired heartbeat prompts into composeSystemPromptSuffix
- `packages/orchestrator/src/services/spirit-service-base.ts` — Content prefix detection for heartbeat/self-improvement modes

### API Routes
- `apps/api/src/transport/routes/heartbeats.ts` — New: full CRUD for heartbeat jobs
- `apps/api/src/transport/routes/self-improvement.ts` — New: review list/get routes
- `apps/api/src/transport/server.ts` — Registered both route sets

### API Schemas
- `packages/api-schema/src/self-improvement.ts` — New: review response schemas
- `packages/api-schema/src/index.ts` — Added self-improvement export

### Settings UI
- `apps/web/src/features/settings/organization/components/heartbeats-tab.tsx` — New: heartbeat management UI
- `apps/web/src/features/settings/organization/components/self-improvement-tab.tsx` — New: review history UI
- `apps/web/src/features/settings/organization/components/organization-settings.tsx` — Added tabs to sidebar + rendering

## Status
- ✅ Backend schema + persistence — **Done**
- ✅ Scheduler/heartbeat runtime flow — **Done**
- ✅ Self-improvement review flow (API + UI) — **Done**
- ✅ Settings UI tabs — **Done**
- 🔄 Tests — **Delegated to Jerry Sloan**

## Completion
- All implementation tasks complete
- Tests delegated to Jerry Sloan via DM
- Waiting on test completion to close the goal
