import {
  CalendarClock,
  CircleUserRound,
  FolderKanban,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/logout-button";
import { SettingsBadge, SettingsSecondaryButton } from "@/features/settings/shared/settings-buttons";
import { SettingsPageHeader } from "@/features/settings/shared/settings-page-header";
import { getServerBootstrap } from "@/server/ujima-daemon";

export default async function ProfilePage() {
  const bootstrap = await getServerBootstrap();

  if (bootstrap.onboardingStatus === "pending") {
    redirect("/onboarding");
  }
  if (!bootstrap.auth.authenticated || !bootstrap.auth.user || !bootstrap.auth.member) {
    redirect("/login");
  }

  const { user, member, session } = bootstrap.auth;
  const workspaceName = bootstrap.organization?.name ?? "Unavailable";
  const workspaceRoot = bootstrap.team?.workspaceRoot ?? "Unavailable";
  const joinedAt = user.createdAt ? formatDate(user.createdAt) : "Unknown";
  const lastSeenAt = session?.lastSeenAt ? formatDate(session.lastSeenAt) : "Unavailable";

  return (
    <main className="mx-auto max-w-5xl space-y-6">
      <SettingsPageHeader bootstrap={bootstrap} />

      <section className="space-y-6">
        <div className="flex flex-col gap-4 border-b border-zinc-200 pb-5 dark:border-zinc-800 md:flex-row md:items-end md:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 text-zinc-100 dark:bg-zinc-100 dark:text-zinc-950">
              <CircleUserRound className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">
                Profile
              </p>
              <h1 className="mt-1.5 truncate text-4xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-[2.8rem]">
                {member.name}
              </h1>
              <p className="mt-1 truncate text-sm text-zinc-500 dark:text-zinc-400 sm:text-base">
                {user.email}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SettingsBadge variant="violet">{member.roleName}</SettingsBadge>
            <SettingsBadge variant="success">{member.presence}</SettingsBadge>
            <SettingsBadge>{workspaceName}</SettingsBadge>
            <SettingsSecondaryButton>{bootstrap.onboardingStatus}</SettingsSecondaryButton>
            <LogoutButton />
          </div>
        </div>

        <div className="grid gap-x-10 gap-y-7 lg:grid-cols-2">
          <ProfileSection
            title="Account"
            description="Identity and authentication details for the current signed-in user."
          >
            <ProfileRow
              icon={<CircleUserRound className="h-4 w-4" />}
              label="Display name"
              value={member.name}
            />
            <ProfileRow icon={<Mail className="h-4 w-4" />} label="Email" value={user.email} />
            <ProfileRow
              icon={<ShieldCheck className="h-4 w-4" />}
              label="Role"
              value={`${member.roleName} · ${member.presence}`}
            />
          </ProfileSection>

          <ProfileSection
            title="Workspace"
            description="Current workspace context tied to this account."
          >
            <ProfileRow
              icon={<FolderKanban className="h-4 w-4" />}
              label="Workspace"
              value={workspaceName}
            />
            <ProfileRow
              icon={<FolderKanban className="h-4 w-4" />}
              label="Project folder"
              value={workspaceRoot}
              valueClassName="break-all"
            />
            <ProfileRow
              icon={<CalendarClock className="h-4 w-4" />}
              label="Onboarding status"
              value={bootstrap.onboardingStatus}
            />
          </ProfileSection>

          <ProfileSection
            title="Session"
            description="Basic account lifecycle and recent session activity."
            className="lg:col-span-2"
          >
            <ProfileRow
              icon={<CalendarClock className="h-4 w-4" />}
              label="Joined"
              value={joinedAt}
            />
            <ProfileRow
              icon={<CalendarClock className="h-4 w-4" />}
              label="Last seen"
              value={lastSeenAt}
            />
          </ProfileSection>
        </div>
      </section>
    </main>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function ProfileSection({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`space-y-4 ${className}`.trim()}>
      <div className="space-y-0.5">
        <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{title}</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ProfileRow({
  icon,
  label,
  value,
  valueClassName = "",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-zinc-200/80 pb-3 last:border-0 last:pb-0 dark:border-zinc-800/80">
      <div className="mt-0.5 text-zinc-400 dark:text-zinc-500">{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
          {label}
        </p>
        <p className={`mt-1 text-sm text-zinc-900 dark:text-zinc-100 ${valueClassName}`.trim()}>
          {value}
        </p>
      </div>
    </div>
  );
}
