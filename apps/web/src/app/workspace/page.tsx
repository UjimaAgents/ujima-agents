import { redirect } from "next/navigation";
import { getServerBootstrap } from "@/server/ujima-daemon";

export default async function WorkspacePage() {
  const bootstrap = await getServerBootstrap();

  if (bootstrap.onboardingStatus === "pending") {
    redirect("/onboarding");
  }
  if (!bootstrap.auth.authenticated || !bootstrap.auth.user || !bootstrap.auth.member) {
    redirect("/login");
  }

  const visibleChannels = bootstrap.channels.filter((channel) => channel.kind !== "self" && channel.kind !== "dm");
  const humanMembers = bootstrap.members.filter((member) => member.kind === "human");
  const agentMembers = bootstrap.members.filter((member) => member.kind === "agent");

  return (
    <main className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.06)] dark:border-zinc-800 dark:bg-zinc-950">
        <div className="px-6 py-7 md:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-violet-700 dark:text-violet-300">
              Workspace overview
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-zinc-950 dark:text-zinc-50">
              {bootstrap.organization?.name}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-600 dark:text-zinc-300">
              Review the current organization snapshot, team composition, and provider readiness from one place.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Humans" value={String(humanMembers.length)} detail="Registered workspace operators" />
        <MetricCard label="Agents" value={String(agentMembers.length)} detail="Persisted teammate identities" />
        <MetricCard label="Channels" value={String(visibleChannels.length)} detail="Visible collaboration spaces" />
        <MetricCard
          label="Providers"
          value={String(bootstrap.providers.filter((provider) => provider.hasKey).length)}
          detail="Configured model backends"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[24px] border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Members</p>
          <div className="mt-4 space-y-3">
            {bootstrap.members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between rounded-2xl border border-zinc-200 px-4 py-3 dark:border-zinc-800"
              >
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{member.name}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {member.kind} · {member.roleName}
                  </p>
                </div>
                <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  {member.presence}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[24px] border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Channels & providers</p>
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">Channels</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {visibleChannels.map((channel) => (
                  <span
                    key={channel.id}
                    className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-700 dark:border-zinc-800 dark:text-zinc-300"
                  >
                    #{channel.name}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">Providers</p>
              <div className="mt-3 space-y-2">
                {bootstrap.providers.map((provider) => (
                  <div
                    key={provider.name}
                    className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3 text-sm dark:bg-zinc-900"
                  >
                    <span className="text-zinc-800 dark:text-zinc-200">{provider.name}</span>
                    <span className={provider.hasKey ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                      {provider.hasKey ? "configured" : "missing key"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[24px] border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-zinc-950 dark:text-zinc-50">{value}</p>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{detail}</p>
    </div>
  );
}
