# Ujima Web

Next.js UI for the local Ujima control plane.

The web app will provide:
- onboarding
- chat and channel views
- DMs and mentions
- agent-to-agent messaging
- approvals
- run streams
- settings for providers, roles, agents, workspace scope, personality presets, and organization hierarchy

## Status

This is the primary browser UI, but it is not the source of truth. It consumes the local API for onboarding, messaging, approvals, and realtime runs.

## Install

From the monorepo root:

```bash
bun install
```

## Development Notes

- Use existing UI primitives first.
- Keep the UI thin and driven by API contracts.
- Align all workspace actions with the org root selected during onboarding.

## Onboarding Implementation Checklist

This checklist scaffolds the onboarding flow to match the target UI structure:
Organization -> Owner account -> Team configuration -> Review & create.

### 1) Route and feature layout

- [ ] Create `src/app/(onboarding)/page.tsx` as the onboarding entry route.
- [ ] Create `src/features/onboarding/components/OnboardingLayout.tsx` for the shell, left stepper, and content slot.
- [ ] Create `src/features/onboarding/components/OnboardingStepper.tsx` with fixed steps:
  - Organization
  - Owner account
  - Team configuration
  - Review & create
  - Need help (non-blocking support section)
- [ ] Add a post-onboarding redirect target route (for now `src/app/page.tsx` can be the destination).

### 2) API integration layer

- [ ] Create `src/features/onboarding/api/getBootstrap.ts` for `GET /api/bootstrap`.
- [ ] Create `src/features/onboarding/api/postOnboarding.ts` for `POST /api/onboarding`.
- [ ] Create `src/features/onboarding/api/types.ts` that re-exports or mirrors:
  - `OnboardingRequest`
  - `OnboardingResponse`
  - `BootstrapResponse`
- [ ] Add an API base helper in `src/features/onboarding/api/client.ts` that applies bearer auth and normalizes API errors.

### 3) State and validation model

- [ ] Create `src/features/onboarding/model/types.ts` with `OnboardingDraft`:
  - `organizationName`
  - `workspaceRoot`
  - `ownerName`
  - `ownerEmail` (UI-only for now)
  - `ownerPassword` (UI-only for now)
  - `providerKeys`
  - `team` (roles, agents, channels, providers, organizationChart, policies)
- [ ] Create `src/features/onboarding/model/schema.ts` with step validators (zod).
- [ ] Create `src/features/onboarding/model/state-machine.ts`:
  - step transitions
  - per-step validity guards
  - submit guard for final step
- [ ] Create `src/features/onboarding/hooks/useOnboardingDraft.ts` with local storage persistence key `onboarding:draft:v1`.

### 4) Bootstrap gating

- [ ] Create `src/features/onboarding/hooks/useOnboardingBootstrap.ts`.
- [ ] On app load:
  - if `bootstrap.onboardingStatus === "ready"` -> redirect to main app
  - if `bootstrap.onboardingStatus === "pending"` -> render onboarding wizard
- [ ] Render loading and retry states for bootstrap fetch failures.

### 5) Step screens

- [ ] Create `src/features/onboarding/components/StepOrganization.tsx`:
  - org name
  - workspace root
  - workspace boundary explainer card
- [ ] Create `src/features/onboarding/components/StepOwnerAccount.tsx`:
  - owner full name (maps to API `ownerName`)
  - email/password fields as UI-only placeholders until auth APIs exist
- [ ] Create `src/features/onboarding/components/StepTeamConfiguration.tsx`:
  - preset-first configuration of roles/agents/channels/policies
  - optional advanced editor toggle for raw team object
- [ ] Create `src/features/onboarding/components/StepReviewCreate.tsx`:
  - organization summary
  - team counts (roles, agents, channels)
  - policy summary
  - submit action

### 6) Payload mapping and submit

- [ ] Create `src/features/onboarding/model/toApiPayload.ts`:
  - map draft to `OnboardingRequest`
  - exclude UI-only owner fields (`ownerEmail`, `ownerPassword`) from request body
- [ ] Create `src/features/onboarding/hooks/useOnboardingSubmit.ts`:
  - call `POST /api/onboarding`
  - map API errors (`ERR_BAD_REQUEST`) into inline field/section errors
  - disable duplicate submits while pending
- [ ] On success:
  - clear `onboarding:draft:v1`
  - redirect to main app

### 7) Suggested baseline file scaffold

- [ ] `src/app/(onboarding)/page.tsx`
- [ ] `src/features/onboarding/api/client.ts`
- [ ] `src/features/onboarding/api/getBootstrap.ts`
- [ ] `src/features/onboarding/api/postOnboarding.ts`
- [ ] `src/features/onboarding/api/types.ts`
- [ ] `src/features/onboarding/model/types.ts`
- [ ] `src/features/onboarding/model/schema.ts`
- [ ] `src/features/onboarding/model/state-machine.ts`
- [ ] `src/features/onboarding/model/toApiPayload.ts`
- [ ] `src/features/onboarding/hooks/useOnboardingBootstrap.ts`
- [ ] `src/features/onboarding/hooks/useOnboardingDraft.ts`
- [ ] `src/features/onboarding/hooks/useOnboardingSubmit.ts`
- [ ] `src/features/onboarding/components/OnboardingLayout.tsx`
- [ ] `src/features/onboarding/components/OnboardingStepper.tsx`
- [ ] `src/features/onboarding/components/StepOrganization.tsx`
- [ ] `src/features/onboarding/components/StepOwnerAccount.tsx`
- [ ] `src/features/onboarding/components/StepTeamConfiguration.tsx`
- [ ] `src/features/onboarding/components/StepReviewCreate.tsx`
- [ ] `src/features/onboarding/components/WorkspaceBoundaryCard.tsx`
- [ ] `src/features/onboarding/components/TeamSummaryPanel.tsx`

### 8) Acceptance criteria

- [ ] The wizard visually matches the four core steps shown in the target design.
- [ ] The app never shows onboarding if bootstrap reports `ready`.
- [ ] The onboarding submit is a single `POST /api/onboarding` call.
- [ ] Team summary and review are generated from the same draft state used for submit.
- [ ] API validation failures are actionable and displayed inline.
