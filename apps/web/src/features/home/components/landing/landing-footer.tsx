import { LandingContainer, PrimaryButton, SecondaryButton } from "./primitives";

export function LandingFooter() {
  return (
    <footer className="landing-hero-bg py-20 md:py-24">
      <LandingContainer className="text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 md:text-4xl">
          Run your team locally.
        </h2>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          <PrimaryButton href="/onboarding">Get started</PrimaryButton>
          <SecondaryButton href="/login">Sign in</SecondaryButton>
        </div>
        <p className="mt-16 text-[13px] text-zinc-500 dark:text-zinc-600">
          © {new Date().getFullYear()} Ujima Agents
        </p>
      </LandingContainer>
    </footer>
  );
}
