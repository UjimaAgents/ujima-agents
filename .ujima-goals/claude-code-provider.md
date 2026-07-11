# Claude + Claude Code Provider Support

**Status**: Core implementation complete  
**Owner**: Carter Jordan (Engineering Manager)

## Architecture Decision

**Use `@anthropic-ai/claude-agent-sdk` npm package** (same pattern as t3code). The SDK exposes a `query()` function wrapping Claude Code's native protocol.

## Architecture (mirroring OpenAI/Codex)

| Concept | OpenAI Path | Anthropic Path (new) |
|---|---|---|
| API Key Provider | `openai` | `anthropic` (already exists) |
| Subscription Provider | `openai-codex` | `anthropic-claude-code` |
| Internal Auth Mode | `chatgpt` | `claude-code` |
| UI Toggle Label | "API Key" / "Codex (ChatGPT)" | "API Key" / "Claude Code" |
| Auth Storage | `~/.codex/auth.json` | `~/.claude/` directory |
| Auth CLI | `codex login` | `claude auth login` |
| Protocol Layer | `codex-responses.ts` | `claude-code-sdk.ts` via `@anthropic-ai/claude-agent-sdk` query() |

## Files Modified/Created (24 files)

### Shared Package
- ✅ `packages/shared/src/provider-kinds.ts` — Added `"anthropic-claude-code"` to PROVIDER_KINDS and `"claude-code"` to PROVIDER_AUTH_MODES
- ✅ `packages/shared/src/model-catalog.ts` — Added model entries (fable-5, opus-4-8, opus-4-7, sonnet-4-6, haiku-4-5) and default model
- ✅ `packages/shared/src/reasoning-catalog.ts` — Added reasoning efforts array

### LLM Package
- ✅ `packages/llm/package.json` — Added `@anthropic-ai/claude-agent-sdk@^0.3.206` dependency
- ✅ **NEW** `packages/llm/src/claude-code-sdk.ts` — Protocol layer wrapping `query()` from claude-agent-sdk
- ✅ `packages/llm/src/select.ts` — Added `anthropic-claude-code` branch

### Orchestrator Package
- ✅ **NEW** `packages/orchestrator/src/utils/claude-code-auth.ts` — Auth helper for Claude Code credentials
- ✅ `packages/orchestrator/src/services/settings.ts` — Updated `testProvider()` for `claude-code` auth mode
- ✅ `packages/orchestrator/src/services/team.ts` — Updated `providerAuthMode()` and `listProviderStatuses()`
- ✅ `packages/orchestrator/src/utils/to-model-messages.ts` — Added anthropic→claude-code fallback

### API Server
- ✅ `apps/api/src/transport/routes/oauth.ts` — Added `/auth/anthropic/claude-code/status` and `/auth/anthropic/claude-code/login` routes

### Web App
- ✅ `apps/web/src/features/providers/catalog.ts` — Added `ProviderAuthModeUI`, `isAnthropicProvider()`, `isClaudeCodeProvider()`, `isSubscriptionProvider()`, updated resolve functions
- ✅ `apps/web/src/features/providers/constants.ts` — Added `ANTHROPIC_CLAUDE_CODE_TOKEN` and login path
- ✅ `apps/web/src/features/providers/provider-credential-field.tsx` — Added Claude Code connection detection UI
- ✅ `apps/web/src/features/onboarding/components/activation-onboarding-form.tsx` — Added `claudeCodeConnected` state
- ✅ `apps/web/src/features/onboarding/api-contract.ts` — Updated validation and auth mode for Claude Code
- ✅ `apps/web/src/features/settings/organization/components/providers/provider-form-modal.tsx` — Added Claude Code mode handling
- ✅ `apps/web/src/features/settings/organization/components/providers-tab.tsx` — Updated saveProvider for claude-code auth
- ✅ `apps/web/src/features/workspace/components/chat/agent-chat-header-controls.tsx` — Added Claude Code provider label and fallback

## Build Status
- ✅ `packages/shared` — 0 TypeScript errors
- ✅ `packages/llm` — 0 TypeScript errors
- ✅ `packages/orchestrator` — 0 TypeScript errors
- ✅ `apps/api` — 0 TypeScript errors
- ✅ `apps/web` — 0 TypeScript errors

## Remaining Work
- [ ] Runtime testing: Verify Claude Code SDK works at runtime (requires `claude auth login`)
- [ ] End-to-end testing with actual Claude Code subscription
- [ ] Code review by Jerry Sloan
- [ ] Onboarding flow testing with Claude Code authentication
