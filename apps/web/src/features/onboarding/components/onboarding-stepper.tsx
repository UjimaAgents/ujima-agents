import { Check, ChevronRight, ExternalLink, HelpCircle } from "lucide-react";
import type { OnboardingStep, OnboardingStepId } from "../types";

interface OnboardingStepperProps {
  steps: OnboardingStep[];
  activeStep: OnboardingStepId;
  isStepAccessible: (stepId: OnboardingStepId) => boolean;
  onStepClick: (stepId: OnboardingStepId) => void;
}

function stepButtonClass(isActive: boolean, isAccessible: boolean) {
  if (isActive) {
    return "bg-violet-50 text-zinc-950 dark:bg-violet-500/10 dark:text-zinc-50";
  }

  if (isAccessible) {
    return "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900/70";
  }

  return "cursor-not-allowed opacity-45";
}

function stepBadgeClass(isActive: boolean, isAccessible: boolean, isComplete: boolean) {
  if (isActive) {
    return "border-violet-500 bg-violet-600 text-white";
  }

  if (isComplete) {
    return "border-violet-500/40 bg-violet-100 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-300";
  }

  if (isAccessible) {
    return "border-zinc-300 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400";
  }

  return "border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-600";
}

export function OnboardingStepProgress({
  steps,
  activeStep,
  isStepAccessible,
  onStepClick,
}: OnboardingStepperProps) {
  const activeIndex = steps.findIndex((step) => step.id === activeStep);
  const activeStepConfig = steps[activeIndex] ?? steps[0];

  return (
    <nav className="shrink-0 border-b border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950 sm:px-4" aria-label="Onboarding progress">
      <ol className="flex items-center gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {steps.map((step, index) => {
          const isActive = step.id === activeStep;
          const isAccessible = isStepAccessible(step.id);
          const isComplete = index < activeIndex;

          return (
            <li key={step.id} className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={!isAccessible}
                onClick={() => onStepClick(step.id)}
                className={`inline-flex max-w-[9.5rem] items-center gap-1.5 rounded-full px-2 py-1.5 text-left transition sm:max-w-none sm:px-2.5 ${stepButtonClass(isActive, isAccessible)}`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${stepBadgeClass(isActive, isAccessible, isComplete)}`}
                >
                  {isComplete ? <Check className="h-3 w-3" strokeWidth={2.5} /> : index + 1}
                </span>
                <span className="truncate text-xs font-medium sm:text-[13px]">{step.title}</span>
              </button>
              {index < steps.length - 1 ? (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-300 dark:text-zinc-600" aria-hidden />
              ) : null}
            </li>
          );
        })}
      </ol>
      {activeStepConfig ? (
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{activeStepConfig.description}</p>
      ) : null}
    </nav>
  );
}

export function OnboardingStepper({ steps, activeStep, isStepAccessible, onStepClick }: OnboardingStepperProps) {
  const activeIndex = steps.findIndex((step) => step.id === activeStep);

  return (
    <aside className="flex min-h-full flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="px-4 pb-3 pt-4 xl:px-5 xl:pt-5">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 xl:text-xl">Onboarding</h2>
        <p className="mt-1 hidden text-xs leading-5 text-zinc-500 dark:text-zinc-400 xl:block">
          Bootstrap your organization, owner account, and agent workspace.
        </p>
      </div>

      <ol className="space-y-0.5 px-2 pb-2 xl:px-3">
        {steps.map((step, index) => {
          const isActive = step.id === activeStep;
          const isAccessible = isStepAccessible(step.id);
          const isComplete = index < activeIndex;

          return (
            <li key={step.id}>
              <button
                type="button"
                disabled={!isAccessible}
                onClick={() => onStepClick(step.id)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition xl:gap-3 xl:px-3 xl:py-2.5 ${stepButtonClass(isActive, isAccessible)}`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${stepBadgeClass(isActive, isAccessible, isComplete)}`}
                >
                  {isComplete ? <Check className="h-3 w-3" strokeWidth={2.5} /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium leading-5 text-zinc-900 dark:text-zinc-100 xl:text-sm">
                    {step.title}
                  </span>
                  <span className="mt-0.5 hidden line-clamp-2 text-[11px] leading-4 text-zinc-500 dark:text-zinc-400 xl:block">
                    {step.description}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-auto px-2 pb-3 pt-3 xl:px-3 xl:pb-4">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-1.5 text-zinc-900 dark:text-zinc-100">
            <HelpCircle className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400" />
            <p className="text-xs font-semibold">Need help?</p>
          </div>
          <p className="mt-1.5 hidden text-[11px] leading-4 text-zinc-500 dark:text-zinc-400 xl:block">
            Questions about setup? Reach out on X.
          </p>
          <a
            href="https://x.com/vincent_presh"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            @vincent_presh
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </aside>
  );
}
