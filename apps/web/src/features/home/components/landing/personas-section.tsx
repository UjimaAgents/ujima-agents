import { GITHUB_URL, productSurfaces } from "./content";
import { LandingReveal } from "./landing-reveal";
import { GitHubButton, LandingContainer, LandingSection, SecondaryButton } from "./primitives";

export function PersonasSection() {
  return (
    <LandingSection id="surfaces" reveal={false}>
      <LandingContainer wide>
        <LandingReveal>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Surfaces</h2>
        </LandingReveal>
        <div className="mt-10 grid gap-12 md:grid-cols-3 md:gap-8">
          {productSurfaces.map((surface, index) => (
            <LandingReveal key={surface.title} as="article" delay={index * 120}>
              <h3 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                {surface.title}
              </h3>
              <p className="mt-2 text-[17px] leading-relaxed text-zinc-600 dark:text-zinc-400">{surface.text}</p>
              <div className="mt-4">
                {surface.href === GITHUB_URL ? (
                  <GitHubButton className="!px-3 !py-2 !text-xs">GitHub</GitHubButton>
                ) : (
                  <SecondaryButton href={surface.href} className="!px-3 !py-2 !text-xs">
                    Learn more
                  </SecondaryButton>
                )}
              </div>
            </LandingReveal>
          ))}
        </div>
      </LandingContainer>
    </LandingSection>
  );
}
