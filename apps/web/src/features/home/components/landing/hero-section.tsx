import { hero } from "./content";
import { HeroHeadline } from "./hero-headline";
import { LandingContainer, PrimaryButton } from "./primitives";

export function HeroSection() {
  return (
    <section className="landing-hero-bg relative isolate min-h-[92vh]">
      <LandingContainer
        wide
        className="relative z-10 flex min-h-[92vh] flex-col items-center justify-center px-4 pb-20 pt-28 text-center md:pt-32"
      >
        <div className="mx-auto w-full max-w-4xl">
          <p className="landing-hero-enter text-[13px] font-medium tracking-wide text-zinc-500 dark:text-zinc-400">
            {hero.eyebrow}
          </p>
          <HeroHeadline />
          <p className="landing-hero-enter landing-hero-delay-2 mx-auto mt-6 max-w-lg text-[17px] leading-relaxed text-zinc-600 dark:text-zinc-400 md:text-[19px]">
            {hero.body}
          </p>
          <div className="landing-hero-enter landing-hero-delay-3 mt-10 flex justify-center">
            <PrimaryButton href="/onboarding">{hero.primaryCta}</PrimaryButton>
          </div>
        </div>
      </LandingContainer>
    </section>
  );
}
