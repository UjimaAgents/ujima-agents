import Link from "next/link";
import { LandingContainer } from "@/features/home/components/landing/primitives";

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#e9d5ff,transparent_38%),linear-gradient(180deg,#faf5ff_0%,#fafafa_58%,#ffffff_100%)] px-4 py-16 dark:bg-[radial-gradient(circle_at_top,#312e81,transparent_30%),linear-gradient(180deg,#050816_0%,#09090b_60%,#020617_100%)]">
      <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-md flex-col items-center justify-center">
        <Link
          href="/"
          className="mb-6 inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          Go Home
        </Link>
        <LandingContainer className="surface-panel rounded-3xl border border-zinc-200 py-10 shadow-sm dark:border-zinc-800">
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
            Static site
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Sign in lives in the local app.
          </h1>
          <p className="mt-3 text-[17px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            GitHub Pages hosts the public landing page only. Open the full Ujima app locally to sign in.
          </p>
        </LandingContainer>
      </div>
    </main>
  );
}
