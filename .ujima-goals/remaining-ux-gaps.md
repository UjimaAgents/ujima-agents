# Remaining UX Gaps

**Status:** Planning — awaiting Cole's input on backend dependencies

## Verified Already Done
- Real-time delivery flow (SSE from Socket.IO daemon, wired in `use-conversation-sync.ts`)

## Frontend-Only (No Backend Dependencies)
1. **Mobile responsiveness** — no breakpoints, no responsive layouts
2. **Keyboard navigation** — no focus management, no shortcuts
3. **Dark mode** — no theme toggle or dark mode CSS
4. **Accessibility / ARIA** — missing labels, focus indicators, screen reader support

## Need Backend Support
5. **File upload UX** — no upload endpoint or storage setup exists
6. **Notification preferences** — UI shell exists, no push infrastructure or WebSocket events

## Next Steps
- Waiting on Cole's response about backend roadmap (upload, notifications)
- Then re-prioritize and start execution

## Decisions
- Corrected assumption: real-time delivery is already wired, not new work
