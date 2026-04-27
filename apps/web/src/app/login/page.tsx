import { redirect } from "next/navigation";
import { LoginForm } from "@/features/auth/components/login-form";
import { getServerBootstrap } from "@/server/ujima-daemon";

export default async function LoginPage() {
  const bootstrap = await getServerBootstrap();

  if (bootstrap.onboardingStatus === "pending") {
    redirect("/onboarding");
  }

  if (bootstrap.auth.authenticated) {
    redirect("/workspace");
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#e9d5ff,transparent_38%),linear-gradient(180deg,#faf5ff_0%,#fafafa_58%,#ffffff_100%)] px-4 py-16 dark:bg-[radial-gradient(circle_at_top,#312e81,transparent_30%),linear-gradient(180deg,#050816_0%,#09090b_60%,#020617_100%)]">
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-violet-700 dark:text-violet-300">
              Persistent sessions
            </p>
            <h1 className="mt-5 max-w-xl text-5xl font-semibold tracking-[-0.05em] text-zinc-950 dark:text-zinc-50">
              The control plane now remembers who you are.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-zinc-600 dark:text-zinc-300">
              Ujima onboarding no longer stops at registration data. Owner credentials issue a durable session, and
              returning to the web app restores that session automatically until you sign out.
            </p>
          </div>

          <LoginForm
            organizationId={bootstrap.organization?.id ?? ""}
            organizationName={bootstrap.organization?.name ?? "your workspace"}
          />
        </div>
      </div>
    </main>
  );
}
