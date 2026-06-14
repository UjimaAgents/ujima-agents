# Fix 4 Critical Bugs

**Goal:** Fix four user-reported bugs in the Ujima system: Windows update command, onboarding channel membership, self-delegation, and tool enablement on onboarding.

**Status:** planning

---

## Bug 1 — Update command fails on Windows

**Root cause:** `packages/cli/src/main.ts:539` and `:607` use `spawn('npm', ...)` without `shell: true`. On Windows, `npm` resolves to `npm.cmd` — a batch wrapper that requires `cmd.exe` to process. Without `shell: true`, Node.js `CreateProcess` cannot invoke `cmd.exe` for batch processing, causing `ENOENT` or permission errors.

Additionally, the error message on line 625-628 tells the user to run `sudo npm install -g` — `sudo` doesn't exist on Windows.

**Files:**
- `packages/cli/src/main.ts:539` — `runNpmGlobalInstall`
- `packages/cli/src/main.ts:607` — `cmdUpdate`
- `packages/cli/src/main.ts:625-628` — error message referencing `sudo`

**Fix:** Add `shell: true` when `process.platform === 'win32'` in both spawn calls. Fix the error message to use platform-appropriate instructions.

---

## Bug 2 — Onboarding channels don't include human users

**Root cause:** Two-stage drop.

**Stage 1 — Web UI (`apps/web/src/features/onboarding/api-contract.ts:124-130`):**
```typescript
channels: draft.channels.map((channel) => ({
  ...
  memberIds: [],  // ← always empty
})),
```
The onboarding form does not populate `memberIds` — the human owner is left out.

**Stage 2 — Orchestrator (`packages/orchestrator/src/services/member-channels.ts:105-107`):**
```typescript
if (member.kind !== AGENT_KIND) {
  return;  // ← human owner never added
}
```
`addMemberToDefaultChannels` explicitly skips non-agent members.

**Result:** After onboarding, the `general` channel has agents (from role-based resolution at `onboarding.ts:268-279`) but the human owner is nowhere.

**Files:**
- `apps/web/src/features/onboarding/api-contract.ts:124-130`
- `packages/orchestrator/src/services/member-channels.ts:105-107`

**Fix:** In `addMemberToDefaultChannels`, relax the `AGENT_KIND` guard to also include human members (or specifically the owner). Alternatively, ensure the web UI includes the owner in `memberIds`.

---

## Bug 3 — Self-delegation should be disabled

**Root cause:** `agent.delegate` allows an agent to delegate to itself (`to` matches its own ID/name). This creates a parallel run in a self-DM, which Precious says is "terrible."

**File:** `packages/orchestrator/src/services/index.ts:589-610` — `runAgentDelegateTurn`

**Fix:** Add a check after resolving the target agent: if `target.id === input.fromMemberId`, throw an error like `'Cannot delegate to yourself. Delegate to another agent.'`.

---

## Bug 4 — Agents don't get all tools on onboarding

**Root cause:** `resolveToolAllowlist` (`spirit-agent-run.ts:636-648`) merges `role.tools` + `ALWAYS_AVAILABLE_AGENT_TOOLS`. Write tools (`filesystem`, `write`, `edit`, `multiedit`, `shell`) are NOT in `ALWAYS_AVAILABLE_AGENT_TOOLS` — they must be declared in the role's `tools` config.

If the role (from team file or onboarding creation) doesn't list these tools, the agent can't use them. The policy layer (`policy.ts:177`) also enforces this: `!role.tools.includes(toolId)` blocks writes.

**Files:**
- `packages/orchestrator/src/tools/index.ts` — `ALWAYS_AVAILABLE_AGENT_TOOLS` definition
- `packages/orchestrator/src/services/spirit-agent-run.ts:636-648` — `resolveToolAllowlist`
- `packages/orchestrator/src/services/policy.ts:169-183` — policy enforcement

**Fix:** Two options:
A. Add `filesystem`, `write`, `edit`, `multiedit`, `shell` to the baseline (like `ALWAYS_AVAILABLE_AGENT_TOOLS`)
B. Ensure the onboarding flow and default roles include all write tools

Option B is safer — option A makes write tools ubiquitous across all roles regardless of config, which might violate the IAM model. The fix should be in how onboarding creates default roles: ensure the role `tools` array includes all workspace write tools.

---

## Tasks

### Task 1 — Fix update command on Windows
**What:** Add `shell: true` conditionally for `process.platform === 'win32'` in both `runNpmGlobalInstall` and `cmdUpdate`. Fix `sudo` reference in error message.
**Touches:** `packages/cli/src/main.ts`

### Task 2 — Fix onboarding channel membership
**What:** Remove or relax the `AGENT_KIND` guard in `addMemberToDefaultChannels` so the human owner is added to channels. Also fix the web side to include owner in `memberIds`.
**Touches:** `packages/orchestrator/src/services/member-channels.ts`, `apps/web/src/features/onboarding/api-contract.ts`

### Task 3 — Disable self-delegation
**What:** Add `fromMemberId === target.id` check in `runAgentDelegateTurn`, throw descriptive error.
**Touches:** `packages/orchestrator/src/services/index.ts`

### Task 4 — Ensure all tools enabled on onboarding
**What:** Trace how default roles are created during onboarding. Ensure the role's `tools` array includes all workspace write tools (`filesystem`, `write`, `edit`, `multiedit`, `shell`).
**Touches:** `packages/orchestrator/src/services/onboarding.ts`, role/tool configuration
