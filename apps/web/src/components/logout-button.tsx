"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { clientFetchVoid } from "@/lib/client-api";

export function LogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => {
        startTransition(async () => {
          await clientFetchVoid("/api/auth/logout", { method: "POST" }, "Unable to sign out.");
          router.replace("/login");
          router.refresh();
        });
      }}
      disabled={isPending}
      className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
    >
      {isPending ? "Signing out..." : "Sign out"}
    </button>
  );
}
