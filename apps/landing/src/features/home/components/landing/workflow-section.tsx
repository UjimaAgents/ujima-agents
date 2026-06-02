import { workflowSteps } from "./content";
import { LandingReveal } from "./landing-reveal";
import { LandingContainer, LandingSection } from "./primitives";

export function WorkflowSection() {
  return (
    <LandingSection id="quick-start" muted reveal={false}>
      <LandingContainer>
        <LandingReveal>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Quick start</h2>
        </LandingReveal>
        <ol className="mt-10 space-y-10">
          {workflowSteps.map((step, index) => (
            <LandingReveal key={step.step} as="li" delay={index * 100} className="flex gap-6 md:gap-10">
              <span className="text-[13px] font-medium tabular-nums text-zinc-400">{step.step}</span>
              <div>
                <p className="font-mono text-lg font-medium text-zinc-950 dark:text-zinc-50">{step.title}</p>
                <p className="mt-1 text-[17px] text-zinc-600 dark:text-zinc-400">{step.text}</p>
              </div>
            </LandingReveal>
          ))}
        </ol>
      </LandingContainer>
    </LandingSection>
  );
}
