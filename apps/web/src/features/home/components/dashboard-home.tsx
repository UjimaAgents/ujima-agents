"use client";

import type { BootstrapResponse } from "@ujima/api-schema";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bot,
  Building2,
  CheckCircle2,
  DoorOpen,
  FolderKanban,
  MessageSquare,
  ShieldCheck,
  Users,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import type { UjimaWebSession } from "@/features/auth/web-session";
import { clearWebSession } from "@/features/auth/web-session";

const ONBOARDING_STORAGE_KEY = "ujima-web-onboarding-session-v1";

export function DashboardHome({ session }: { session: UjimaWebSession }) {
  const router = useRouter();
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    async function loadBootstrap() {
      try {
        const response = await fetch("/api/bootstrap", { cache: "no-store" });
        const payload = (await response.json()) as BootstrapResponse | { message?: string };

        if (!response.ok) {
          throw new Error("message" in payload && typeof payload.message === "string" ? payload.message : "Unable to load dashboard state.");
        }

        if (!ignore) {
          setBootstrap(payload as BootstrapResponse);
          setBootstrapError(null);
        }
      } catch (error) {
        if (!ignore) {
          setBootstrapError(error instanceof Error ? error.message : "Unable to load dashboard state.");
        }
      }
    }

    void loadBootstrap();

    return () => {
      ignore = true;
    };
  }, []);

  const organization = bootstrap?.organization ?? {
    id: session.organizationId,
    name: session.organizationName,
  };
  const statCards = [
    {
      label: "Members",
      value: String(bootstrap?.members.length ?? 0),
      icon: Users,
    },
    {
      label: "Channels",
      value: String(bootstrap?.channels.length ?? 0),
      icon: MessageSquare,
    },
    {
      label: "Configured providers",
      value: String(bootstrap?.providers.length ?? 0),
      icon: ShieldCheck,
    },
    {
      label: "Active runs",
      value: String(bootstrap?.activeRuns.length ?? 0),
      icon: Activity,
    },
  ];

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-[#040712] dark:text-zinc-100">
      <div className="mx-auto max-w-7xl px-4 py-4 md:px-6 md:py-6">
        <header className="surface-panel flex items-center justify-between rounded-2xl border border-zinc-200 bg-white/85 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-white/5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-violet-700 dark:text-violet-400">Ujima Agents</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Signed in as <span className="font-medium text-zinc-900 dark:text-zinc-100">{session.ownerName}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => {
                clearWebSession();
                window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
                router.push("/sign-in");
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/10"
            >
              <DoorOpen className="h-4 w-4" />
              Log out
            </button>
          </div>
        </header>

        <section className="surface-hero mt-6 rounded-[28px] border border-zinc-200 p-6 shadow-[0_16px_48px_rgba(15,23,42,0.08)] md:p-8">
          <div className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
            <div>
              <p className="inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                {bootstrap?.onboardingStatus === "ready" ? "System ready" : "Local session active"}
              </p>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight text-zinc-950 dark:text-white md:text-5xl">
                Welcome to {organization.name}
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-600 dark:text-zinc-400">
                This is your logged-in dashboard home. From here you can review onboarding state, inspect the current organization snapshot, and jump back into setup or docs as needed.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/onboarding" className="rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-400">
                  Open onboarding
                </Link>
                <a href="http://localhost:7511/docs" target="_blank" rel="noreferrer" className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:bg-white/10">
                  API docs
                </a>
              </div>
            </div>

            <div className="surface-panel rounded-[24px] border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-[#11162d]">
              <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Session summary</p>
              <div className="mt-4 space-y-4">
                <InfoRow icon={Building2} label="Organization" value={organization.name} />
                <InfoRow icon={Users} label="Signed-in user" value={session.ownerName} />
                <InfoRow icon={CheckCircle2} label="Onboarding status" value={bootstrap?.onboardingStatus ?? "loading"} />
                <InfoRow icon={FolderKanban} label="Workspace root" value={bootstrap?.team?.workspaceRoot ?? "Unavailable"} />
              </div>
              {bootstrapError ? (
                <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                  {bootstrapError}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {statCards.map((card) => (
            <article key={card.label} className="surface-panel rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex items-center justify-between">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{card.label}</p>
                <card.icon className="h-5 w-5 text-blue-500 dark:text-blue-300" />
              </div>
              <p className="mt-3 text-3xl font-semibold text-zinc-950 dark:text-white">{card.value}</p>
            </article>
          ))}
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          <article className="surface-panel rounded-[24px] border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Members</p>
            <div className="mt-4 space-y-3">
              {(bootstrap?.members ?? []).slice(0, 6).map((member) => (
                <div key={member.id} className="flex items-center justify-between rounded-2xl border border-zinc-200 px-4 py-3 dark:border-white/10">
                  <div>
                    <p className="text-sm font-semibold text-zinc-950 dark:text-white">{member.name}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {member.kind} · {member.roleName}
                    </p>
                  </div>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">{member.presence}</span>
                </div>
              ))}
              {bootstrap && bootstrap.members.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">No members were returned from the API yet.</p>
              ) : null}
            </div>
          </article>

          <article className="surface-panel rounded-[24px] border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Quick actions</p>
            <div className="mt-4 space-y-3">
              <ActionCard
                icon={Bot}
                title="Review team setup"
                text="Inspect roles, agents, and channel relationships from the onboarding flow."
                href="/onboarding"
              />
              <ActionCard
                icon={ShieldCheck}
                title="Inspect provider state"
                text="See which providers are configured and whether keys are present in the API bootstrap response."
                href="/onboarding"
              />
              <ActionCard
                icon={Activity}
                title="Open API docs"
                text="Review the transport contract that powers onboarding, runs, settings, and realtime events."
                href="http://localhost:7511/docs"
                external
              />
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-zinc-200 px-4 py-3 dark:border-white/10">
      <div className="rounded-xl bg-blue-500/10 p-2 text-blue-600 dark:text-blue-300">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</p>
        <p className="mt-1 truncate text-sm font-medium text-zinc-950 dark:text-white">{value}</p>
      </div>
    </div>
  );
}

function ActionCard({
  icon: Icon,
  title,
  text,
  href,
  external = false,
}: {
  icon: typeof Bot;
  title: string;
  text: string;
  href: string;
  external?: boolean;
}) {
  const content = (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-zinc-200 px-4 py-4 transition hover:bg-zinc-50 dark:border-white/10 dark:hover:bg-white/5">
      <div>
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-blue-500 dark:text-blue-300" />
          <p className="text-sm font-semibold text-zinc-950 dark:text-white">{title}</p>
        </div>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{text}</p>
      </div>
      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
    </div>
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {content}
      </a>
    );
  }

  return <Link href={href}>{content}</Link>;
}
