# Token Display in Agent Messages

**Status**: ✅ Completed

**Goal**: Show input/output token counts on each agent message bubble in the chat UI, flowing from the AI SDK response through to the frontend.

## Changes Made

### 1. Schema — `MessageSchema` (packages/shared/src/org-schemas.ts)
- Added `inputTokens: z.number().int().min(0).optional()`
- Added `outputTokens: z.number().int().min(0).optional()`

### 2. ChatMessageData type (apps/web/src/features/workspace/components/chat/chat-message.tsx)
- Added `inputTokens?: number` and `outputTokens?: number`

### Already Wired (pre-existing):
- **Backend** (`spirit-agent-run.ts`): Extracts usage tokens early, attaches them to the last step's message via `saveAndEmitAgentMessage`, which passes them through to `MessageSchema.parse()`
- **Frontend bridge** (`use-conversation-sync.ts`): `messageToChatMessage()` passes `inputTokens`/`outputTokens` from the `Message` type to `ChatMessageData`
- **UI** (`chat-message.tsx`): Renders `⎆ 1.2k in · 3.8k out` footer on agent messages with `formatTokens()` helper

## Data Flow

```
AI SDK (streamText)
  ↓ returns { usage: { inputTokens, outputTokens } }
agent-loop.ts → spirit-agent-run.ts
  ↓ extracts usage early, attaches to last step message
MessageSchema.parse() → messages table
  ↓ inputTokens, outputTokens on the message row
Socket → messageToChatMessage()
  ↓ copies fields to ChatMessageData
ChatMessage component
  ↓ renders "⎆ 1.2k in · 3.8k out" on agent bubbles
```
