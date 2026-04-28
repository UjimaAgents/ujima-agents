import { CalendarClock, CircleUserRound, Mail, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/logout-button";
import { getServerBootstrap } from "@/server/ujima-daemon";

export default async function ProfilePage() {
  const bootstrap = await getServerBootstrap();

  if (bootstrap.onboardingStatus === "pending") {
    redirect("/onboarding");
  }
  if (!bootstrap.auth.authenticated || !bootstrap.auth.user || !bootstrap.auth.member) {
    redirect("/login");
  }

  const { user, member } = bootstrap.auth;

  return (
    <main className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.06)] dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-6 px-6 py-7 md:flex-row md:items-start md:justify-between md:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-violet-700 dark:text-violet-300">
              Profile
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-zinc-950 dark:text-zinc-50">
              {member.name}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-600 dark:text-zinc-300">
              Manage your account details and current organization context here.
            </p>
          </div>

          <LogoutButton />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <Panel title="Account">
          <InfoRow icon={CircleUserRound} label="Display name" value={member.name} />
          <InfoRow icon={Mail} label="Email" value={user.email} />
          <InfoRow icon={ShieldCheck} label="Role" value={member.roleName} />
          <InfoRow icon={ShieldCheck} label="Presence" value={member.presence} />
        </Panel>

        <Panel title="Organization">
          <InfoRow icon={ShieldCheck} label="Organization" value={bootstrap.organization?.name ?? "Unavailable"} />
          <InfoRow
            icon={CalendarClock}
            label="Onboarding status"
            value={bootstrap.onboardingStatus}
          />
          <InfoRow
            icon={CalendarClock}
            label="Workspace root"
            value={bootstrap.team?.workspaceRoot ?? "Unavailable"}
          />
        </Panel>
      </section>
    </main>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{title}</p>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CircleUserRound;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-violet-50 p-2 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
            {label}
          </p>
          <p className="mt-1 break-all text-sm text-zinc-900 dark:text-zinc-100">{value}</p>
        </div>
      </div>
    </div>
  );
}
