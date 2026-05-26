import Link from "next/link";
import type { ReactNode } from "react";
import { GITHUB_URL } from "./content";
import { LandingReveal } from "./landing-reveal";

function GitHubIcon({ className = "h-4 w-4 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.01-.322 3.3 1.23.96-.266 1.98-.399 3-.404 1.02.005 2.04.138 3 .404 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

/** Matches SettingsPrimaryButton / login submit */
export const buttonPrimaryClass =
  "landing-interactive inline-flex items-center justify-center rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 hover:bg-violet-700 hover:shadow-violet-500/30 disabled:opacity-50 disabled:shadow-none";

/** Matches SettingsSecondaryButton / login page back link */
export const buttonSecondaryClass =
  "landing-interactive inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900";

export function LandingContainer({
  children,
  className = "",
  wide = false,
}: {
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div
      className={`mx-auto w-full px-6 ${wide ? "max-w-[1200px]" : "max-w-[680px]"} ${className}`}
    >
      {children}
    </div>
  );
}

export function LandingSection({
  id,
  children,
  className = "",
  muted = false,
  reveal = true,
  revealDelay = 0,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  muted?: boolean;
  reveal?: boolean;
  revealDelay?: number;
}) {
  const body = reveal ? (
    <LandingReveal delay={revealDelay}>{children}</LandingReveal>
  ) : (
    children
  );

  return (
    <section
      id={id}
      className={`py-20 md:py-28 ${muted ? "landing-section-muted" : "landing-section-base"} ${className}`}
    >
      {body}
    </section>
  );
}

export function PrimaryButton({
  href,
  children,
  external,
  className = "",
}: {
  href: string;
  children: string;
  external?: boolean;
  className?: string;
}) {
  const classes = `${buttonPrimaryClass} ${className}`;

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={classes}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}

function ButtonLabel({ icon, children }: { icon?: ReactNode; children: string }) {
  if (!icon) {
    return <>{children}</>;
  }

  return (
    <span className="inline-flex items-center gap-2">
      {icon}
      {children}
    </span>
  );
}

export function SecondaryButton({
  href,
  children,
  external,
  icon,
  className = "",
}: {
  href: string;
  children: string;
  external?: boolean;
  icon?: ReactNode;
  className?: string;
}) {
  const classes = `${buttonSecondaryClass} ${className}`;
  const label = <ButtonLabel icon={icon}>{children}</ButtonLabel>;

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={classes}>
        {label}
      </a>
    );
  }

  return (
    <Link href={href} className={classes}>
      {label}
    </Link>
  );
}

const githubIcon = <GitHubIcon />;

export function GitHubButton({
  children = "GitHub",
  className = "",
}: {
  children?: string;
  className?: string;
}) {
  return (
    <SecondaryButton href={GITHUB_URL} external icon={githubIcon} className={className}>
      {children}
    </SecondaryButton>
  );
}

/** Non-interactive label for features not shipped publicly yet. */
export function ComingSoonButton({
  children = "Coming soon",
  className = "",
}: {
  children?: string;
  className?: string;
}) {
  return (
    <span
      className={`${buttonSecondaryClass} pointer-events-none cursor-default opacity-70 ${className}`}
      aria-disabled="true"
      title="Available in a future release"
    >
      {children}
    </span>
  );
}

/** Icon-only control — matches ThemeToggle compact sizing */
export function GitHubIconLink({ className = "" }: { className?: string }) {
  return (
    <a
      href={GITHUB_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="GitHub repository"
      className={`landing-interactive inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900 ${className}`}
    >
      {githubIcon}
    </a>
  );
}

export function FeatureRow({ title, text, delay = 0 }: { title: string; text: string; delay?: number }) {
  return (
    <LandingReveal delay={delay} className="landing-divider grid gap-2 border-b py-6 first:pt-0 last:border-b-0 md:grid-cols-[200px_1fr] md:gap-12 md:py-8">
      <h3 className="text-[17px] font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">{title}</h3>
      <p className="text-[17px] leading-relaxed text-zinc-600 dark:text-zinc-400">{text}</p>
    </LandingReveal>
  );
}
