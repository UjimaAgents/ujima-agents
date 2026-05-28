"use client";

import type { ApiError } from "@ujima/api-schema";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Home, Sparkles } from "lucide-react";
import { normalizeProviderName } from "./api-contract";
import { ThemeToggle } from "@/components/theme-toggle";
import { MIN_TEAM_AGENTS, buildOnboardingRequest } from "./api-contract";
import { OnboardingForm } from "./components/onboarding-form";
import { OnboardingStepper, OnboardingStepProgress } from "./components/onboarding-stepper";
import {
  INITIAL_DRAFT,
  ONBOARDING_STEPS,
  defaultModelForProvider,
  getModelOptionsForProvider,
  type OnboardingDraft,
  type OnboardingStepId,
  type RolePresetTemplate,
  type TeamTabId,
} from "./types";

const TEAM_TABS: TeamTabId[] = ["agents", "channels", "org-chart", "policies", "providers"];
const ONBOARDING_STORAGE_KEY = "ujima-web-onboarding-session-v2";

interface PersistedOnboardingState {
  activeStep: OnboardingStepId;
  activeTeamTab: TeamTabId;
  draft: OnboardingDraft;
}

function subscribe() {
  return () => undefined;
}

function isStepId(value: unknown): value is OnboardingStepId {
  return typeof value === "string" && ONBOARDING_STEPS.some((step) => step.id === value);
}

function isTeamTabId(value: unknown): value is TeamTabId {
  return typeof value === "string" && TEAM_TABS.includes(value as TeamTabId);
}

function normalizeDraft(raw: unknown, baseline: OnboardingDraft): OnboardingDraft {
  const source = typeof raw === "object" && raw !== null ? (raw as Partial<OnboardingDraft>) : {};

  return {
    organizationName: typeof source.organizationName === "string" ? source.organizationName : baseline.organizationName,
    workspaceRoot: typeof source.workspaceRoot === "string" ? source.workspaceRoot : baseline.workspaceRoot,
    ownerName: typeof source.ownerName === "string" ? source.ownerName : baseline.ownerName,
    ownerEmail: typeof source.ownerEmail === "string" ? source.ownerEmail : baseline.ownerEmail,
    ownerPassword: typeof source.ownerPassword === "string" ? source.ownerPassword : baseline.ownerPassword,
    roles: Array.isArray(source.roles)
      ? source.roles.map((role, index) => {
          const item = typeof role === "object" && role !== null ? role : {};
          const fallbackRole = baseline.roles[index] ?? baseline.roles[0];
          const id =
            typeof (item as { id?: unknown }).id === "string"
              ? (item as { id: string }).id
              : fallbackRole?.id ?? `role-restored-${index}`;
          const rawLlm = typeof (item as { llm?: unknown }).llm === "string" ? (item as { llm: string }).llm : "";
          const llm = rawLlm.trim() ? normalizeProviderName(rawLlm) : fallbackRole?.llm ?? "";
          const model = typeof (item as { model?: unknown }).model === "string" ? (item as { model: string }).model : fallbackRole?.model ?? "";
          const modelOptions = getModelOptionsForProvider(llm);
          const repairedModel = modelOptions.some((option) => option.value === model)
            ? model
            : defaultModelForProvider(llm);

          return {
            id,
            name:
              typeof (item as { name?: unknown }).name === "string"
                ? (item as { name: string }).name
                : fallbackRole?.name ?? "",
            agentName:
              typeof (item as { agentName?: unknown }).agentName === "string"
                ? (item as { agentName: string }).agentName
                : fallbackRole?.agentName ?? fallbackRole?.title ?? "",
            title:
              typeof (item as { title?: unknown }).title === "string"
                ? (item as { title: string }).title
                : fallbackRole?.title ?? "",
            instructions:
              typeof (item as { instructions?: unknown }).instructions === "string"
                ? (item as { instructions: string }).instructions
                : fallbackRole?.instructions ?? "",
            llm,
            model: repairedModel,
            channelIds: Array.isArray((item as { channelIds?: unknown }).channelIds)
              ? ((item as { channelIds: unknown[] }).channelIds.filter((channelId): channelId is string => typeof channelId === "string"))
              : fallbackRole?.channelIds ?? [],
          };
        })
      : baseline.roles.map((role) => ({
          ...role,
          llm: normalizeProviderName(role.llm),
          model: getModelOptionsForProvider(role.llm).some((option) => option.value === role.model)
            ? role.model
            : defaultModelForProvider(role.llm),
        })),
    channels: Array.isArray(source.channels)
      ? source.channels.map((channel, index) => {
          const item = typeof channel === "object" && channel !== null ? channel : {};
          return {
            id: typeof (item as { id?: unknown }).id === "string" ? (item as { id: string }).id : `channel-restored-${index}`,
            name: typeof (item as { name?: unknown }).name === "string" ? (item as { name: string }).name : "",
            description:
              typeof (item as { description?: unknown }).description === "string"
                ? (item as { description: string }).description
                : "",
          };
        })
      : baseline.channels,
    organizationReports: Array.isArray(source.organizationReports)
      ? source.organizationReports.map((report, index) => {
          const item = typeof report === "object" && report !== null ? report : {};
          return {
            id: typeof (item as { id?: unknown }).id === "string" ? (item as { id: string }).id : `report-restored-${index}`,
            subjectName:
              typeof (item as { subjectName?: unknown }).subjectName === "string"
                ? (item as { subjectName: string }).subjectName
                : "",
            managerName:
              typeof (item as { managerName?: unknown }).managerName === "string"
                ? (item as { managerName: string }).managerName
                : "",
          };
        })
      : baseline.organizationReports,
    providers: Array.isArray(source.providers)
      ? source.providers.map((provider, index) => {
          const item = typeof provider === "object" && provider !== null ? provider : {};
          return {
            id: typeof (item as { id?: unknown }).id === "string" ? (item as { id: string }).id : `provider-restored-${index}`,
            name:
              typeof (item as { name?: unknown }).name === "string" &&
              (item as { name: string }).name.trim()
                ? normalizeProviderName((item as { name: string }).name)
                : "",
            apiKey:
              typeof (item as { apiKey?: unknown }).apiKey === "string"
                ? (item as { apiKey: string }).apiKey
                : "",
          };
        })
      : baseline.providers,
    policies: {
      requireApprovalForWrites:
        typeof source.policies?.requireApprovalForWrites === "boolean"
          ? source.policies.requireApprovalForWrites
          : baseline.policies.requireApprovalForWrites,
      requireApprovalForShell:
        typeof source.policies?.requireApprovalForShell === "boolean"
          ? source.policies.requireApprovalForShell
          : baseline.policies.requireApprovalForShell,
      workspaceBoundaryMode: "hard",
    },
  };
}

function getDefaultSession(baseline: OnboardingDraft = INITIAL_DRAFT): PersistedOnboardingState {
  return {
    activeStep: "organization",
    activeTeamTab: "agents",
    draft: baseline,
  };
}

function readPersistedSession(baseline: OnboardingDraft = INITIAL_DRAFT): PersistedOnboardingState {
  if (typeof window === "undefined") {
    return getDefaultSession(baseline);
  }

  try {
    const rawValue = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);

    if (!rawValue) {
      return getDefaultSession(baseline);
    }

    const parsed = JSON.parse(rawValue) as Partial<PersistedOnboardingState>;

    return {
      activeStep: isStepId(parsed.activeStep) ? parsed.activeStep : "organization",
      activeTeamTab: isTeamTabId(parsed.activeTeamTab) ? parsed.activeTeamTab : "agents",
      draft: normalizeDraft(parsed.draft, baseline),
    };
  } catch {
    return getDefaultSession(baseline);
  }
}

function isOrganizationStepComplete(draft: OnboardingDraft) {
  return Boolean(draft.organizationName.trim() && draft.workspaceRoot.trim());
}

function isOwnerStepComplete(draft: OnboardingDraft) {
  return Boolean(
    draft.ownerName.trim() &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.ownerEmail.trim()) &&
      draft.ownerPassword.trim().length >= 8,
  );
}

function isTeamStepComplete(draft: OnboardingDraft) {
  if (draft.roles.length < MIN_TEAM_AGENTS) {
    return false;
  }

  const agentNames = new Set<string>();
  const hasRoles = draft.roles.every((role) => {
    const roleName = role.name.trim();
    const agentName = role.agentName.trim();

    if (!roleName || !agentName || !role.llm.trim() || role.channelIds.length === 0 || agentNames.has(agentName)) {
      return false;
    }

    agentNames.add(agentName);
    return true;
  });
  const hasChannels = draft.channels.every((channel) => channel.name.trim() && channel.description.trim());
  const hasReports = draft.organizationReports.every(
    (report) => report.subjectName.trim() && report.managerName.trim(),
  );
  const hasProviders = draft.providers.every((provider) => provider.name.trim() && provider.apiKey.trim());

  return hasRoles && hasChannels && hasReports && hasProviders;
}

export function OnboardingExperience({
  starterDraft = INITIAL_DRAFT,
  roleTemplates = [],
}: {
  starterDraft?: OnboardingDraft;
  roleTemplates?: RolePresetTemplate[];
}) {
  const isHydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const [session, setSession] = useState<PersistedOnboardingState>(() => readPersistedSession(starterDraft));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { activeStep, activeTeamTab, draft } = session;

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(session));
  }, [isHydrated, session]);

  const stepIndex = useMemo(
    () => ONBOARDING_STEPS.findIndex((step) => step.id === activeStep),
    [activeStep],
  );
  const activeStepConfig = ONBOARDING_STEPS[stepIndex];

  const navigateStep = (offset: 1 | -1) => {
    const nextIndex = Math.min(Math.max(stepIndex + offset, 0), ONBOARDING_STEPS.length - 1);
    const nextStepId = ONBOARDING_STEPS[nextIndex].id;
    setSession((current) => ({
      ...current,
      activeStep: nextStepId,
      activeTeamTab: nextStepId === "team" ? "agents" : current.activeTeamTab,
    }));
  };

  const handleNext = () => {
    if (activeStep === "team") {
      const activeTabIndex = TEAM_TABS.indexOf(activeTeamTab);

      if (activeTabIndex < TEAM_TABS.length - 1) {
        setSession((current) => ({ ...current, activeTeamTab: TEAM_TABS[activeTabIndex + 1] }));
        return;
      }
    }

    navigateStep(1);
  };

  const handleBack = () => {
    if (activeStep === "team") {
      const activeTabIndex = TEAM_TABS.indexOf(activeTeamTab);

      if (activeTabIndex > 0) {
        setSession((current) => ({ ...current, activeTeamTab: TEAM_TABS[activeTabIndex - 1] }));
        return;
      }
    }

    navigateStep(-1);
  };

  const accessibleSteps = useMemo(() => {
    const accessMap: Record<OnboardingStepId, boolean> = {
      organization: true,
      owner: isOrganizationStepComplete(draft),
      team: isOrganizationStepComplete(draft) && isOwnerStepComplete(draft),
      review: isOrganizationStepComplete(draft) && isOwnerStepComplete(draft) && isTeamStepComplete(draft),
    };

    return accessMap;
  }, [draft]);

  const handleStepClick = (stepId: OnboardingStepId) => {
    if (!accessibleSteps[stepId]) {
      return;
    }

    if (stepId === "team") {
      setSession((current) => ({ ...current, activeStep: stepId, activeTeamTab: "agents" }));
      return;
    }

    setSession((current) => ({ ...current, activeStep: stepId }));
  };

  const handleSubmit = async (currentDraft: OnboardingDraft) => {
    if (isSubmitting) {
      return;
    }

    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildOnboardingRequest(currentDraft)),
      });
      const body = (await response.json().catch(() => null)) as ApiError | null;

      if (!response.ok) {
        setSubmitError(
          body && typeof body === "object" && "message" in body && typeof body.message === "string"
            ? body.message
            : "Unable to complete onboarding right now.",
        );
        return;
      }

      if (
        !body ||
        typeof body !== "object" ||
        !("auth" in body) ||
        typeof body.auth !== "object" ||
        body.auth === null ||
        !("authenticated" in body.auth) ||
        body.auth.authenticated !== true
      ) {
        setSubmitError("Onboarding finished without a signed-in session. Try again or sign in if your organization was created.");
        return;
      }

      window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
      // Full navigation ensures the session cookie from Set-Cookie is sent on the next request.
      window.location.replace("/workspace");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to complete onboarding right now.");
    } finally {
      setIsSubmitting(false);
    }
  };
  if (!isHydrated) {
    return null;
  }

  const stepperProps = {
    steps: ONBOARDING_STEPS,
    activeStep,
    isStepAccessible: (stepId: OnboardingStepId) => accessibleSteps[stepId],
    onStepClick: handleStepClick,
  };

  return (
    <main className="flex h-full min-h-0 flex-col bg-[#fafafa] p-2 dark:bg-[#050816] sm:p-3 md:p-4">
      <div className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.05)] dark:border-zinc-800 dark:bg-zinc-950 md:rounded-[20px]">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-3 py-3 dark:border-zinc-800 sm:px-4 md:px-5 md:py-3.5">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white sm:h-8 sm:w-8">
              <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
            <p className="truncate text-base font-semibold text-zinc-950 dark:text-zinc-50 sm:text-lg">Ujima Agents</p>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 sm:gap-2 sm:px-4 sm:py-2"
            >
              <Home className="h-4 w-4" />
              <span className="hidden sm:inline">Go home</span>
              <span className="sr-only sm:hidden">Go home</span>
            </Link>
          </div>
        </header>

        <div className="lg:hidden">
          <OnboardingStepProgress {...stepperProps} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="hidden w-52 shrink-0 overflow-y-auto lg:block xl:w-60">
            <OnboardingStepper {...stepperProps} />
          </div>

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-white dark:bg-zinc-950">
            <OnboardingForm
              key={activeStepConfig.id}
              step={activeStepConfig}
              stepIndex={stepIndex}
              totalSteps={ONBOARDING_STEPS.length}
              draft={draft}
              suggestedRoles={roleTemplates}
              onDraftChange={(nextDraft) => setSession((current) => ({ ...current, draft: nextDraft }))}
              canGoBack={stepIndex > 0}
              isLastStep={stepIndex === ONBOARDING_STEPS.length - 1}
              activeTeamTab={activeTeamTab}
              onTeamTabChange={(nextTab) => setSession((current) => ({ ...current, activeTeamTab: nextTab }))}
              onBack={handleBack}
              onNext={handleNext}
              onSubmit={handleSubmit}
              isSubmitting={isSubmitting}
              submitError={submitError}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
