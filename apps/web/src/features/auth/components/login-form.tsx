"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface LoginFormProps {
  organizationId: string;
  organizationName: string;
}

export function LoginForm({ organizationId, organizationName }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          email,
          password,
        }),
      });

      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setError(body.message ?? "Unable to sign in right now.");
        return;
      }

      router.replace("/workspace");
      router.refresh();
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto w-full max-w-md rounded-[28px] border border-zinc-200 bg-white p-8 shadow-[0_20px_80px_rgba(15,23,42,0.08)] dark:border-zinc-800 dark:bg-zinc-950"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-600 dark:text-violet-300">
        Owner sign-in
      </p>
      <h1 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-zinc-950 dark:text-zinc-50">
        Continue into {organizationName}
      </h1>
      <p className="mt-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
        Your onboarding state is already registered. Sign in with the owner credentials created during setup.
      </p>

      <div className="mt-8 space-y-5">
        <label className="block">
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-violet-500 focus:bg-white dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:bg-zinc-950"
            placeholder="owner@example.com"
            required
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-violet-500 focus:bg-white dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:bg-zinc-950"
            placeholder="Enter your password"
            required
            minLength={8}
          />
        </label>
      </div>

      {error ? (
        <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="mt-8 inline-flex w-full items-center justify-center rounded-2xl bg-violet-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
