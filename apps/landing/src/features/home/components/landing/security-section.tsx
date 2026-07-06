import { securityLines } from "./content";
import { LandingContainer, LandingSection } from "./primitives";
import { InteractiveSandboxCube } from "./illustrations";
import { LandingReveal } from "./landing-reveal";

export function SecuritySection() {
  return (
    <LandingSection id="security" muted reveal={false}>
      <LandingContainer wide className="grid gap-12 md:grid-cols-2 md:items-center">
        <LandingReveal revealType="3d">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Security</h2>
          <ul className="mt-8 space-y-4">
            {securityLines.map((line) => (
              <li
                key={line}
                className="landing-divider border-b py-4 text-[17px] leading-relaxed text-zinc-600 last:border-b-0 dark:text-zinc-400"
              >
                {line}
              </li>
            ))}
          </ul>
        </LandingReveal>
        <LandingReveal revealType="3d" delay={120} className="flex justify-center">
          <InteractiveSandboxCube />
        </LandingReveal>
      </LandingContainer>
    </LandingSection>
  );
}
