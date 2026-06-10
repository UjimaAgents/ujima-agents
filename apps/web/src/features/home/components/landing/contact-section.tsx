import { contributors } from "./content";
import { LandingReveal } from "./landing-reveal";
import { LandingContainer, LandingSection } from "./primitives";

export function ContactSection() {
  return (
    <LandingSection id="contact" reveal={false}>
      <LandingContainer wide>
        <LandingReveal>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
            Contact
          </h2>
        </LandingReveal>
        <LandingReveal delay={80}>
          <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            Built by a small team. Reach any of us directly for questions, bugs, or design feedback.
          </p>
        </LandingReveal>
        <div className="mt-10 grid gap-12 md:grid-cols-3 md:gap-8">
          {contributors.map((person, index) => (
            <LandingReveal key={person.contactHref} as="article" delay={index * 120}>
              <h3 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                {person.name}
              </h3>
              <p className="mt-2 text-[13px] font-medium uppercase tracking-[0.1em] text-zinc-500 dark:text-zinc-400">
                {person.role}
              </p>
              <a
                href={person.contactHref}
                target={person.contactHref.startsWith("mailto:") ? undefined : "_blank"}
                rel={person.contactHref.startsWith("mailto:") ? undefined : "noreferrer"}
                className="landing-interactive mt-4 inline-flex items-center gap-1.5 text-[15px] text-violet-600 underline-offset-4 hover:underline dark:text-violet-400"
              >
                {person.contactLabel}
              </a>
            </LandingReveal>
          ))}
        </div>
      </LandingContainer>
    </LandingSection>
  );
}
