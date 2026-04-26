import { ExternalLink, HelpCircle } from "lucide-react";
import type { OnboardingStep, OnboardingStepId } from "../types";

interface OnboardingStepperProps {
  steps: OnboardingStep[];
  activeStep: OnboardingStepId;
  isStepAccessible: (stepId: OnboardingStepId) => boolean;
  onStepClick: (stepId: OnboardingStepId) => void;
}

export function OnboardingStepper({ steps, activeStep, isStepAccessible, onStepClick }: OnboardingStepperProps) {
  return (
    <aside className="flex h-full flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="px-5 pb-6 pt-6">
        <h2 className="text-[28px] font-semibold tracking-[-0.02em] text-zinc-950 dark:text-zinc-50">Onboarding</h2>
        <p className="mt-2 max-w-[220px] text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          Bootstrap your organization, owner account, and agent workspace.
        </p>
      </div>

      <ol className="space-y-1 px-3">
        {steps.map((step, index) => {
          const isActive = step.id === activeStep;
          const isAccessible = isStepAccessible(step.id);

          return (
            <li key={step.id}>
              <button
                type="button"
                disabled={!isAccessible}
                onClick={() => onStepClick(step.id)}
                className={`flex w-full items-start gap-3 rounded-2xl px-4 py-4 text-left transition ${
                  isActive
                    ? "bg-violet-50 text-zinc-950 dark:bg-violet-500/10 dark:text-zinc-50"
                    : isAccessible
                      ? "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900/70"
                      : "cursor-not-allowed opacity-45"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium ${
                    isActive
                      ? "border-violet-500 bg-violet-600 text-white"
                      : isAccessible
                        ? "border-zinc-300 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400"
                        : "border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-600"
                  }`}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{step.title}</span>
                  <span className="mt-1 block max-w-[220px] text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                    {step.description}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-auto px-3 pb-4 pt-6">
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
            <HelpCircle className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
            <p className="text-sm font-semibold">Need help?</p>
          </div>
          <p className="mt-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            Learn more about Ujima Agents onboarding and team setup.
          </p>
          <a
            href="#"
            className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            View docs
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </aside>
  );
}
