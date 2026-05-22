import { redirect } from "next/navigation";
import Link from "next/link";
import { LoginForm } from "@/features/auth/components/login-form";
import { getServerBootstrap } from "@/server/ujima-daemon";

export default async function LoginPage() {
  const bootstrap = await getServerBootstrap().catch(() => null);
  if (!bootstrap) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 dark:bg-[#09090b]">
        <div className="max-w-xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Daemon is unavailable
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Could not reach the Ujima API at port 7511. From the repo root, run{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-900">bun dev</code> and refresh.
          </p>
        </div>
      </main>
    );
  }

  if (bootstrap.onboardingStatus === "pending") {
    redirect("/onboarding");
  }

  if (bootstrap.auth.authenticated) {
    redirect("/workspace");
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#e9d5ff,transparent_38%),linear-gradient(180deg,#faf5ff_0%,#fafafa_58%,#ffffff_100%)] px-4 py-16 dark:bg-[radial-gradient(circle_at_top,#312e81,transparent_30%),linear-gradient(180deg,#050816_0%,#09090b_60%,#020617_100%)]">
      <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-md flex-col items-center justify-center">
        <Link
          href="/"
          className="mb-6 inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          Go Home
        </Link>
        <LoginForm organizations={bootstrap.organizations} />
      </div>
    </main>
  );
}
