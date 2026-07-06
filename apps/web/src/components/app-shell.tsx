"use client";

import { CircleUserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_ROUTES } from "@/config/routes";
import { ThemeToggle } from "./theme-toggle";
import { ToastContainer } from "./ui/toast-container";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLandingPage = pathname === "/";
  const isOnboardingPage = pathname.startsWith("/onboarding");
  const isLoginPage = pathname.startsWith("/login");
  const isWorkspacePage = pathname.startsWith("/workspace");
  const isSettingsPage = pathname.startsWith("/settings");
  const isProfilePage = pathname.startsWith("/profile");
  const isCompactHeader = isSettingsPage || isProfilePage;
  const showSectionNav = !isSettingsPage && !isProfilePage;

  if (isLandingPage) {
    return (
      <div className="min-h-screen scroll-smooth overflow-y-auto bg-white text-zinc-950 dark:bg-[#09090b] dark:text-zinc-100">
        {children}
        <ToastContainer />
      </div>
    );
  }

  if (isOnboardingPage || isLoginPage || isWorkspacePage) {
    return (
      <div
        className={`h-screen overflow-hidden bg-zinc-50 text-zinc-950 dark:bg-[#040712] dark:text-zinc-100 ${
          isOnboardingPage ? "flex min-h-0 flex-col" : ""
        }`}
      >
        <div className={isOnboardingPage ? "min-h-0 flex-1" : isWorkspacePage ? "h-full w-full" : undefined}>{children}</div>
        <ToastContainer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">
      <ToastContainer />
      <header className="border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
        <div
          className={`mx-auto flex max-w-6xl items-center justify-between px-4 md:px-6 ${isCompactHeader ? "py-2" : "py-3"}`}
        >
          <div className="flex items-center gap-3">
            <Link
              href="/workspace"
              className="text-sm font-semibold text-zinc-900 transition hover:text-violet-600 dark:text-zinc-100 dark:hover:text-violet-400"
            >
              Ujima
            </Link>
            {isCompactHeader ? (
              <span className="hidden text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-400 sm:inline">
                Account
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {showSectionNav ? (
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
            ) : null}
            <div className="flex items-center gap-1 rounded-xl border border-zinc-200 bg-zinc-50/90 p-1 dark:border-zinc-800 dark:bg-zinc-900/90">
              <Link
                href="/profile"
                aria-label="Open profile"
                title="Profile"
                className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition ${
                  pathname === "/profile"
                    ? "bg-violet-600 text-white"
                    : "text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                <CircleUserRound className="h-4 w-4" />
              </Link>
              <ThemeToggle compact variant="ghost" />
            </div>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-4 md:px-6 md:py-5">{children}</div>
    </div>
  );
}
