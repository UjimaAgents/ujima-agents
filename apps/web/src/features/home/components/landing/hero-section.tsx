import { hero } from "./content";
import { HeroHeadline } from "./hero-headline";
import { GitHubButton, LandingContainer, PrimaryButton } from "./primitives";

export function HeroSection() {
  return (
    <section className="landing-hero-bg relative min-h-[92vh] overflow-hidden text-white">
      <LandingContainer
        wide
        className="flex min-h-[92vh] flex-col items-center justify-center pb-20 pt-28 text-center md:pt-32"
      >
        <div className="mx-auto w-full max-w-3xl">
          <p className="landing-hero-enter text-[13px] font-medium tracking-wide text-zinc-500">{hero.eyebrow}</p>
          <HeroHeadline />
          <p className="landing-hero-enter landing-hero-delay-2 mx-auto mt-6 max-w-lg text-[17px] leading-relaxed text-zinc-400 md:text-[19px]">
            {hero.body}
          </p>
          <div className="landing-hero-enter landing-hero-delay-3 mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <PrimaryButton href="/onboarding">{hero.primaryCta}</PrimaryButton>
            <GitHubButton>{hero.secondaryCta}</GitHubButton>
          </div>
        </div>
      </LandingContainer>
    </section>
  );
}
