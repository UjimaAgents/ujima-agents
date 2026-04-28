"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_ROUTES } from "@/config/routes";
import { ThemeToggle } from "./theme-toggle";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLandingPage = pathname === "/";
  const isOnboardingPage = pathname.startsWith("/onboarding");
  const isSignInPage = pathname.startsWith("/sign-in");
  const isLoginPage = pathname.startsWith("/login");

  if (isLandingPage || isOnboardingPage || isSignInPage || isLoginPage) {
    return <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-[#040712] dark:text-zinc-100">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-violet-700 dark:text-violet-400">Ujima Agents</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Agentic software team control plane</p>
          </div>
          <div className="flex items-center gap-2">
            <nav className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-900">
              {APP_ROUTES.map((route) => {
                const active = pathname === route.href;
                return (
                  <Link
                    key={route.href}
                    href={route.href}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? "bg-violet-600 text-white"
                        : "text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {route.label}
                  </Link>
                );
              })}
            </nav>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-4 md:px-6 md:py-6">{children}</div>
    </div>
  );
}
