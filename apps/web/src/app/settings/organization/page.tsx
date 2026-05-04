import { redirect } from "next/navigation";
import { getServerBootstrap, getServerTeamSettings, daemonJson } from "@/server/ujima-daemon";
import type { OrganizationSettingsResponse, ProviderStatus } from "@ujima/api-schema";
import { OrganizationSettingsPage } from "@/features/settings/organization/components/organization-settings";
import type { TeamSettingsData } from "@/features/settings/organization/components/organization-settings";

export default async function OrganizationSettingsRoute() {
  const bootstrap = await getServerBootstrap().catch(() => null);
  if (!bootstrap) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 dark:bg-[#09090b]">
        <div className="max-w-xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Daemon is unavailable
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Could not reach the Ujima daemon. Start it and refresh.
          </p>
        </div>
      </main>
    );
  }

  if (bootstrap.onboardingStatus === "pending") {
    redirect("/onboarding");
  }
  if (!bootstrap.auth.authenticated) {
    redirect("/login");
  }

  const orgId = bootstrap.organization?.id;
  const orgSettings = orgId
    ? await daemonJson<OrganizationSettingsResponse>(
        `/api/settings/organization?organizationId=${encodeURIComponent(orgId)}`,
      ).catch(() => null)
    : null;

  const rawTeamSettings = await getServerTeamSettings().catch(() => null);
  const teamSettings: TeamSettingsData | null = rawTeamSettings
    ? {
        ...rawTeamSettings,
        policies: rawTeamSettings.policies as TeamSettingsData["policies"],
      }
    : null;

  const providers = orgId
    ? await daemonJson<ProviderStatus[]>(
        `/api/settings/providers?organizationId=${encodeURIComponent(orgId)}`,
      ).catch(() => [])
    : [];

  return (
    <OrganizationSettingsPage
      bootstrap={bootstrap}
      orgSettings={orgSettings}
      teamSettings={teamSettings}
      providers={providers}
    />
  );
}
