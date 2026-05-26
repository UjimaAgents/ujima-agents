import { hero } from "./content";
import { GitHubButton, LandingContainer, PrimaryButton } from "./primitives";

export function HeroSection() {
  return (
    <section className="landing-hero-bg relative min-h-[92vh] overflow-hidden text-white">
      <LandingContainer
        wide
        className="flex min-h-[92vh] flex-col items-center justify-center pb-20 pt-28 text-center md:pt-32"
      >
        <div className="mx-auto w-full max-w-3xl">
          <p className="text-[13px] font-medium tracking-wide text-zinc-500">{hero.eyebrow}</p>
          <h1 className="mt-5 text-[2.75rem] font-semibold leading-[1.08] tracking-[-0.03em] md:text-[4.5rem] md:leading-[1.05] lg:text-[5.25rem]">
            {hero.headline}
          </h1>
          <p className="mx-auto mt-6 max-w-lg text-[17px] leading-relaxed text-zinc-400 md:text-[19px]">
            {hero.body}
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <PrimaryButton href="/onboarding">{hero.primaryCta}</PrimaryButton>
            <GitHubButton>{hero.secondaryCta}</GitHubButton>
          </div>
        </div>
      </LandingContainer>
    </section>
  );
}
