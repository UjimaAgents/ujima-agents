import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { headerLinks } from "./content";
import { LandingContainer, SecondaryButton } from "./primitives";

export function LandingHeader() {
  return (
    <header className="landing-header-enter absolute inset-x-0 top-0 z-50">
      <LandingContainer wide className="relative flex h-16 items-center justify-between gap-4 md:h-[72px]">
        <Link href="/" className="shrink-0 text-[15px] font-semibold tracking-tight text-white">
          Ujima
        </Link>

        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 md:flex">
          {headerLinks.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="landing-nav-link text-[13px] text-zinc-400 hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <ThemeToggle compact />
          <SecondaryButton href="/login" className="!px-3 !py-2 !text-xs">
            Sign in
          </SecondaryButton>
        </div>
      </LandingContainer>
    </header>
  );
}
