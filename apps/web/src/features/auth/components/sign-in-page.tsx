"use client";

import type { BootstrapResponse } from "@ujima/api-schema";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, LockKeyhole, User2 } from "lucide-react";
import { useWebSession } from "@/features/auth/use-web-session";
import { writeWebSession } from "@/features/auth/web-session";

export function SignInPage() {
  const router = useRouter();
  const session = useWebSession();
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) {
      router.replace("/");
    }
  }, [router, session]);

  useEffect(() => {
    let ignore = false;

    async function loadBootstrap() {
      try {
        const response = await fetch("/api/bootstrap", { cache: "no-store" });
        const payload = (await response.json()) as BootstrapResponse | { message?: string };

        if (!response.ok) {
          throw new Error("message" in payload && typeof payload.message === "string" ? payload.message : "Unable to load sign-in state.");
        }

        if (!ignore) {
          setBootstrap(payload as BootstrapResponse);
        }
      } catch (loadError) {
        if (!ignore) {
          setBootstrapError(loadError instanceof Error ? loadError.message : "Unable to load sign-in state.");
        }
      }
    }

    void loadBootstrap();

    return () => {
      ignore = true;
    };
  }, []);

  const organizationId = bootstrap?.organization?.id ?? "";
  const organizationName = bootstrap?.organization?.name ?? "";
  const canSignIn = Boolean(bootstrap?.organization);

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-[#040712] dark:text-zinc-100">
      <div className="mx-auto max-w-6xl px-4 py-4 md:px-6 md:py-6">
        <div className="flex items-center justify-start">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
            Go home
          </Link>
        </div>

        <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
          <div className="w-full max-w-[460px] rounded-[28px] border border-zinc-200 bg-white p-8 shadow-[0_20px_60px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[#101426]">
            <div className="text-center">
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-violet-700 dark:text-violet-300">
                Ujima Agents
              </p>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-white">
                Sign in
              </h1>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Continue to your dashboard using the local owner profile.
              </p>
            </div>

            <form
              className="mt-8 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();

                if (!canSignIn) {
                  setError("Complete onboarding first before using sign in.");
                  return;
                }

                if (!ownerName.trim()) {
                  setError("Enter the owner name before signing in.");
                  return;
                }

                writeWebSession({
                  organizationId,
                  organizationName,
                  ownerName: ownerName.trim(),
                  loggedInAt: new Date().toISOString(),
                });
                router.push("/");
              }}
            >
              <label className="block">
                <span className="mb-2 flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  <User2 className="h-4 w-4" />
                  Owner name
                </span>
                <input
                  value={ownerName}
                  onChange={(event) => {
                    setOwnerName(event.target.value);
                    if (error) {
                      setError(null);
                    }
                  }}
                  className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:border-blue-400 dark:focus:ring-blue-500/20"
                  placeholder="Enter owner name"
                  disabled={!canSignIn}
                />
              </label>

              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
                <div className="flex items-center gap-2 text-zinc-900 dark:text-white">
                  <LockKeyhole className="h-4 w-4 text-emerald-500" />
                  Local-only session
                </div>
                <p className="mt-2">
                  Signing in restores this browser session only.
                </p>
              </div>

              {error ? (
                <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                  {error}
                </p>
              ) : null}
              {bootstrapError ? (
                <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                  {bootstrapError}
                </p>
              ) : null}
              {!bootstrapError && !canSignIn ? (
                <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                  No onboarded organization was found yet. Create one from onboarding first.
                </p>
              ) : null}

              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canSignIn}
              >
                Sign in
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
