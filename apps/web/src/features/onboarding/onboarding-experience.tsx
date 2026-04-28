"use client";

import type { ApiError } from "@ujima/api-schema";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Home, Sparkles } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { buildOnboardingRequest } from "./api-contract";
import { OnboardingForm } from "./components/onboarding-form";
import { OnboardingStepper } from "./components/onboarding-stepper";
import {
  INITIAL_DRAFT,
  ONBOARDING_STEPS,
  type OnboardingDraft,
  type OnboardingStepId,
  type TeamTabId,
} from "./types";

const TEAM_TABS: TeamTabId[] = ["agents", "channels", "org-chart", "policies", "providers"];
const ONBOARDING_STORAGE_KEY = "ujima-web-onboarding-session-v1";

interface PersistedOnboardingState {
  activeStep: OnboardingStepId;
  activeTeamTab: TeamTabId;
  draft: OnboardingDraft;
}

function subscribe() {
  return () => {};
}

function isStepId(value: unknown): value is OnboardingStepId {
  return typeof value === "string" && ONBOARDING_STEPS.some((step) => step.id === value);
}

function isTeamTabId(value: unknown): value is TeamTabId {
  return typeof value === "string" && TEAM_TABS.includes(value as TeamTabId);
}

function normalizeDraft(raw: unknown): OnboardingDraft {
  const source = typeof raw === "object" && raw !== null ? (raw as Partial<OnboardingDraft>) : {};

  return {
    organizationName: typeof source.organizationName === "string" ? source.organizationName : INITIAL_DRAFT.organizationName,
    workspaceRoot: typeof source.workspaceRoot === "string" ? source.workspaceRoot : INITIAL_DRAFT.workspaceRoot,
    ownerName: typeof source.ownerName === "string" ? source.ownerName : INITIAL_DRAFT.ownerName,
    ownerEmail: typeof source.ownerEmail === "string" ? source.ownerEmail : INITIAL_DRAFT.ownerEmail,
    ownerPassword: typeof source.ownerPassword === "string" ? source.ownerPassword : INITIAL_DRAFT.ownerPassword,
    roles: Array.isArray(source.roles)
      ? source.roles.map((role, index) => {
          const item = typeof role === "object" && role !== null ? role : {};
          return {
            id: typeof (item as { id?: unknown }).id === "string" ? (item as { id: string }).id : `role-restored-${index}`,
            name: typeof (item as { name?: unknown }).name === "string" ? (item as { name: string }).name : "",
            title: typeof (item as { title?: unknown }).title === "string" ? (item as { title: string }).title : "",
            instructions:
              typeof (item as { instructions?: unknown }).instructions === "string"
                ? (item as { instructions: string }).instructions
                : "",
            llm: typeof (item as { llm?: unknown }).llm === "string" ? (item as { llm: string }).llm : "",
            model: typeof (item as { model?: unknown }).model === "string" ? (item as { model: string }).model : "",
            channelIds: Array.isArray((item as { channelIds?: unknown }).channelIds)
              ? ((item as { channelIds: unknown[] }).channelIds.filter((channelId): channelId is string => typeof channelId === "string"))
              : [],
          };
        })
      : INITIAL_DRAFT.roles,
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
      : INITIAL_DRAFT.channels,
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
      : INITIAL_DRAFT.organizationReports,
    providers: Array.isArray(source.providers)
      ? source.providers.map((provider, index) => {
          const item = typeof provider === "object" && provider !== null ? provider : {};
          return {
            id: typeof (item as { id?: unknown }).id === "string" ? (item as { id: string }).id : `provider-restored-${index}`,
            name: typeof (item as { name?: unknown }).name === "string" ? (item as { name: string }).name : "",
            apiKey:
              typeof (item as { apiKey?: unknown }).apiKey === "string"
                ? (item as { apiKey: string }).apiKey
                : "",
          };
        })
      : INITIAL_DRAFT.providers,
    policies: {
      requireApprovalForWrites:
        typeof source.policies?.requireApprovalForWrites === "boolean"
          ? source.policies.requireApprovalForWrites
          : INITIAL_DRAFT.policies.requireApprovalForWrites,
      requireApprovalForShell:
        typeof source.policies?.requireApprovalForShell === "boolean"
          ? source.policies.requireApprovalForShell
          : INITIAL_DRAFT.policies.requireApprovalForShell,
      workspaceBoundaryMode: "hard",
    },
  };
}

function getDefaultSession(): PersistedOnboardingState {
  return {
    activeStep: "organization",
    activeTeamTab: "agents",
    draft: INITIAL_DRAFT,
  };
}

function readPersistedSession(): PersistedOnboardingState {
  if (typeof window === "undefined") {
    return getDefaultSession();
  }

  try {
    const rawValue = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);

    if (!rawValue) {
      return getDefaultSession();
    }

    const parsed = JSON.parse(rawValue) as Partial<PersistedOnboardingState>;

    return {
      activeStep: isStepId(parsed.activeStep) ? parsed.activeStep : "organization",
      activeTeamTab: isTeamTabId(parsed.activeTeamTab) ? parsed.activeTeamTab : "agents",
      draft: normalizeDraft(parsed.draft),
    };
  } catch {
    return getDefaultSession();
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
  const hasRoles = draft.roles.every(
    (role) => role.name.trim() && role.llm.trim() && role.channelIds.length > 0,
  );
  const hasChannels = draft.channels.every((channel) => channel.name.trim() && channel.description.trim());
  const hasReports = draft.organizationReports.every((report) => report.subjectName.trim());
  const hasProviders = draft.providers.every((provider) => provider.name.trim() && provider.apiKey.trim());

  return hasRoles && hasChannels && hasReports && hasProviders;
}

export function OnboardingExperience() {
  const router = useRouter();
  const isHydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const [session, setSession] = useState<PersistedOnboardingState>(() => readPersistedSession());
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
    setSession((current) => ({ ...current, activeStep: ONBOARDING_STEPS[nextIndex].id }));
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

      window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
      router.replace("/workspace");
      router.refresh();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to complete onboarding right now.");
    } finally {
      setIsSubmitting(false);
    }
  };
  if (!isHydrated) {
    return null;
  }

  return (
    <main className="min-h-screen overflow-x-auto bg-[#fafafa] p-3 dark:bg-[#050816] md:p-4">
      <div className="mx-auto min-w-[1024px] overflow-hidden rounded-[20px] border border-zinc-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.05)] dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <p className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Ujima Agents</p>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <Home className="h-4 w-4" />
              <span>Go home</span>
            </Link>
          </div>
        </header>

        <div className="flex min-h-[calc(100vh-110px)]">
          <div className="w-[285px] shrink-0">
            <OnboardingStepper
              steps={ONBOARDING_STEPS}
              activeStep={activeStep}
              isStepAccessible={(stepId) => accessibleSteps[stepId]}
              onStepClick={handleStepClick}
            />
          </div>

          <div className="min-w-0 flex-1 bg-white dark:bg-zinc-950">
            <OnboardingForm
              key={activeStepConfig.id}
              step={activeStepConfig}
              stepIndex={stepIndex}
              totalSteps={ONBOARDING_STEPS.length}
              draft={draft}
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
