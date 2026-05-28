import { redirect } from "next/navigation";
import {
  getServerBootstrap,
  getServerTeamSettings,
  getServerRolePresets,
  daemonJson,
  getSessionTokenFromCookie,
} from "@/server/ujima-daemon";
import type {
  McpServerListResponse,
  OrganizationSettingsResponse,
  ProviderStatus,
  TeamSettingsResponse,
} from "@ujima/api-schema";
import { OrganizationSettingsPage } from "@/features/settings/organization/components/organization-settings";
import { DaemonUnavailablePanel } from "@/features/system/daemon-unavailable-panel";

export const dynamic = "force-dynamic";

export default async function OrganizationSettingsRoute() {
  const bootstrap = await getServerBootstrap().catch(() => null);
  if (!bootstrap) {
    return <DaemonUnavailablePanel />;
  }

  if (bootstrap.onboardingStatus === "pending") {
    redirect("/onboarding");
  }
  if (!bootstrap.auth.authenticated) {
    redirect("/login");
  }

  const sessionToken = await getSessionTokenFromCookie();
  const orgId = bootstrap.organization?.id;
  const orgSettings = orgId
    ? await daemonJson<OrganizationSettingsResponse>(
        `/api/settings/organization?organizationId=${encodeURIComponent(orgId)}`,
        {},
        sessionToken,
      ).catch(() => null)
    : null;

  const teamSettings: TeamSettingsResponse | null = await getServerTeamSettings(orgId).catch(
    () => null,
  );

  const providers = orgId
    ? await daemonJson<ProviderStatus[]>(
        `/api/settings/providers?organizationId=${encodeURIComponent(orgId)}`,
        {},
        sessionToken,
      ).catch(() => [])
    : [];

  const mcpServers = orgId
    ? await daemonJson<McpServerListResponse>(
        `/api/settings/mcps?organizationId=${encodeURIComponent(orgId)}`,
        {},
        sessionToken,
      )
        .then((response) => response.servers)
        .catch(() => [])
    : [];

  const rolePresets = await getServerRolePresets().catch(() => []);

  return (
    <OrganizationSettingsPage
      bootstrap={bootstrap}
      orgSettings={orgSettings}
      teamSettings={teamSettings}
      providers={providers}
      mcpServers={mcpServers}
      rolePresets={rolePresets}
    />
  );
}
