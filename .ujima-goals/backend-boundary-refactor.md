# Backend Boundary Refactor

## Goal
Extract clear module boundaries from the current backend monolith services. Each of the five hotspots identified by Precious gets split into focused units with explicit contracts, reducing coupling and making the runtime semantics testable in isolation.

## Hotspots

| File | Lines | Problem |
|------|-------|---------|
| `services/index.ts` | 1,863 | `createApiServices` god object wires everything |
| `services/conversation.ts` | 1,927 | Publish, mentions, wake, realtime, compaction, throttling, alerts |
| `services/spirit-agent-run.ts` | 1,249 | Model selection, prompts, MCP routing, tool palette, run state |
| `services/tool-service-impl.ts` | 1,149 | Execution, approval, shell, attachments, audit, MCP |
| `repositories/index.ts` | 1,089 | One Repository class importing every table |

## Progress

### Phase 1 — Split ConversationService ✅
- Extracted `MessageWriter`, `MentionResolver`, `WakeDispatcher`, `conversation-types.ts`
- conversation.ts: 1,927 → 1,392 lines

### Phase 2 — Split SpiritServiceAgentRun ✅
- Extracted `ToolPaletteBuilder` (174 lines)
- Extracted `RunStatePersister` (142 lines)
- spirit-agent-run.ts: 1,249 → 1,178 lines

### Phase 3 — Repository Port Interfaces ✅
- Defined `ChannelStore`, `MessageStore`, `MemberStore`, `RunStore` port interfaces
- Wired Repository class to implement all 4 ports
- Added 4 `Pick<ApiRepository, ...>` type aliases in repository-reader.ts
- Migrated `RunStatePersister` from ApiRepository → RunStore & MemberStore ports

### Phase 4 — Domain Module Extraction 🟡

**Extracted domains:**

| Domain | File | Lines | Dependencies |
|--------|------|-------|-------------|
| Auth | `auth-domain.ts` | 82 | repo, teamStore, workspaces, archiveRoot |
| Scheduler | `scheduler-domain.ts` | 75 | repo, teamStore, realtime, conversations, spirits, tools, ai, goals |
| Notifications | `notifications-domain.ts` | 15 | repo |
| Admin | `admin-domain.ts` | 40 | repo, teamStore, approvals, conversations, spirits |

**Still inline in `createApiServices` (~810 lines remaining):**
- Runtime core: ConversationService, ToolServiceImpl, AiService, ApprovalService, SpiritService, GoalSystemService, ActiveSpiritRegistry, ChannelRetentionService
- Cross-domain callback wiring: handleMessagePublished, attachment approval resolver, run completed hook, wakeMember
- Attachment capture closure, connector audit writer, MCP tool resolver wiring

## Decisions
- Domain modules accept explicit narrow input interfaces — no closures or late-binding
- Cross-domain callback wiring stays in createApiServices (it IS the composition layer)
- No behavior changes — all 217 existing tests pass after each extraction

## Remaining
- The runtime core (ConversationService ↔ ToolService ↔ AiService ↔ SpiritService) has heavy circular deps that make extraction non-trivial. Each service needs the others to construct: ConversationService needs summarizeConversation (uses AiService/SpiritService), SpiritService needs tools/ai/conversations, AiService needs tools/spirits (for MCP resolvers). This would require a phase of interface-first refactoring or lazy-injection.
