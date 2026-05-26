import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { headerLinks } from "./content";
import { GitHubIconLink, LandingContainer, PrimaryButton, SecondaryButton } from "./primitives";

export function LandingHeader() {
  return (
    <header className="absolute inset-x-0 top-0 z-50">
      <LandingContainer wide className="relative flex h-16 items-center justify-between gap-4 md:h-[72px]">
        <Link href="/" className="shrink-0 text-[15px] font-semibold tracking-tight text-white">
          Ujima
        </Link>

        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 md:flex">
          {headerLinks.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-[13px] text-zinc-400 transition hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <ThemeToggle compact />
          <GitHubIconLink className="hidden sm:inline-flex" />
          <SecondaryButton href="/login" className="hidden !px-3 !py-2 !text-xs md:inline-flex">
            Sign in
          </SecondaryButton>
          <PrimaryButton href="/onboarding" className="!px-3 !py-2 !text-xs">
            Get started
          </PrimaryButton>
        </div>
      </LandingContainer>
    </header>
  );
}
