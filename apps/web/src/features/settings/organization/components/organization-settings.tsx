"use client";

import {
  Building2,
  Clock,
  FolderKanban,
  Layers,
  MessageSquare,
  Plug,
  Server,
  ShieldCheck,
  Users,
} from "lucide-react";
import type {
  BootstrapResponse,
  OrganizationSettingsResponse,
  ProviderStatus,
  TeamSettingsResponse,
} from "@ujima/api-schema";
import type { McpServerPublic } from "@ujima/shared";
import type { RolePresetTemplate } from "@/features/onboarding/types";
import { SettingsLayout } from "@/features/settings/shared/settings-layout";
import { SettingsPageHeader } from "@/features/settings/shared/settings-page-header";
import {
  SettingsPageProvider,
  useSettingsPage,
} from "@/features/settings/shared/settings-workspace-context";
import { useSettingsTab } from "@/features/settings/shared/use-settings-tab";
import type { SettingsNavGroup } from "@/features/settings/shared/settings-nav";
import { GeneralTab } from "./general-tab";
import { AgentsTab } from "./agents-tab";
import { ChannelsTab } from "./channels-tab";
import { OrgChartTab } from "./org-chart-tab";
import { PoliciesTab } from "./policies-tab";
import { ProvidersTab } from "./providers-tab";
import { SchedulesTab } from "./schedules-tab";
import { McpsTab } from "./mcps-tab";
import { WorkspacesTab } from "./workspaces-tab";

export type SettingsTabId =
  | "general"
  | "workspaces"
  | "agents"
  | "channels"
  | "org-chart"
  | "policies"
  | "providers"
  | "schedules"
  | "mcps";

const VALID_TABS: SettingsTabId[] = [
  "general",
  "workspaces",
  "agents",
  "channels",
  "org-chart",
  "policies",
  "providers",
  "schedules",
  "mcps",
];

const NAV_GROUPS: SettingsNavGroup<SettingsTabId>[] = [
  {
    label: "Workspace",
    items: [
      { id: "general", label: "General", icon: FolderKanban },
      { id: "workspaces", label: "Workspaces", icon: Layers },
      { id: "policies", label: "Policies", icon: ShieldCheck },
    ],
  },
  {
    label: "Team",
    items: [
      { id: "agents", label: "Agents & Roles", icon: Users },
      { id: "channels", label: "Channels", icon: MessageSquare },
      { id: "org-chart", label: "Org chart", icon: Building2 },
    ],
  },
  {
    label: "Integrations",
    items: [
      { id: "providers", label: "Providers", icon: Server },
      { id: "mcps", label: "MCPs", icon: Plug },
    ],
  },
  {
    label: "Runtime",
    items: [{ id: "schedules", label: "Schedules", icon: Clock }],
  },
];

export function OrganizationSettingsPage({
  bootstrap,
  orgSettings,
  teamSettings,
  providers,
  mcpServers,
  rolePresets,
}: {
  bootstrap: BootstrapResponse;
  orgSettings: OrganizationSettingsResponse | null;
  teamSettings: TeamSettingsResponse | null;
  providers: ProviderStatus[];
  mcpServers: McpServerPublic[];
  rolePresets: RolePresetTemplate[];
}) {
  return (
    <SettingsPageProvider
      initial={{
        orgSettings,
        teamSettings,
        members: orgSettings?.members ?? bootstrap.members ?? [],
        channels: orgSettings?.channels ?? bootstrap.channels ?? [],
        providers,
        mcpServers,
      }}
    >
      <OrganizationSettingsContent bootstrap={bootstrap} rolePresets={rolePresets} />
    </SettingsPageProvider>
  );
}

function OrganizationSettingsContent({
  bootstrap,
  rolePresets,
}: {
  bootstrap: BootstrapResponse;
  rolePresets: RolePresetTemplate[];
}) {
  const { activeTab, setActiveTab } = useSettingsTab(VALID_TABS, "general");
  const {
    orgSettings,
    teamSettings,
    members,
    channels,
    providers,
    setOrgSettings,
    setMembers,
    setChannels,
    setProviders,
  } = useSettingsPage();

  const orgId = bootstrap.organization?.id ?? "";
  const organizationName = orgSettings?.organization.name ?? bootstrap.organization?.name ?? "";
  const createdBy = bootstrap.auth.member?.id ?? "";
  const auth = bootstrap.auth;
  const onSettingsUpdate = (patch: { name?: string; workspaceRoot?: string }) => {
    setOrgSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        organization: {
          ...prev.organization,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          workspace: {
            ...prev.organization.workspace,
            ...(patch.workspaceRoot !== undefined ? { root: patch.workspaceRoot } : {}),
          },
        },
      };
    });
  };

  return (
    <>
      <SettingsPageHeader bootstrap={bootstrap} />
      <SettingsLayout
        groups={NAV_GROUPS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        {activeTab === "general" && (
          <GeneralTab
            orgId={orgId}
            auth={auth}
            organizationName={organizationName}
            workspaceRoot={
              orgSettings?.organization.workspace.root ??
              teamSettings?.workspace.root ??
              ""
            }
            onUpdate={onSettingsUpdate}
          />
        )}
        {activeTab === "workspaces" && (
          <WorkspacesTab currentWorkspaceRoot={teamSettings?.workspace.root ?? ""} />
        )}
        {activeTab === "agents" && (
          <AgentsTab
            orgId={orgId}
            members={members}
            teamSettings={teamSettings}
            channels={channels}
            providers={providers}
            rolePresets={rolePresets}
            onMemberUpdated={(member) => {
              setMembers((prev) =>
                prev.map((m) => (m.id === member.id ? { ...m, ...member } : m)),
              );
            }}
            onMemberCreated={(member) => {
              setMembers((prev) => [...prev, member]);
            }}
          />
        )}
        {activeTab === "channels" && (
          <ChannelsTab
            orgId={orgId}
            channels={channels}
            onChannelsChange={setChannels}
          />
        )}
        {activeTab === "org-chart" && (
          <OrgChartTab
            orgId={orgId}
            members={members}
            organizationChart={teamSettings?.organizationChart ?? { reportsTo: {} }}
          />
        )}
        {activeTab === "policies" && (
          <PoliciesTab
            orgId={orgId}
            policies={
              teamSettings?.policies ?? {
                requireApprovalForWrites: true,
                requireApprovalForShell: true,
                workspaceBoundaryMode: "hard",
              }
            }
          />
        )}
        {activeTab === "providers" && (
          <ProvidersTab
            orgId={orgId}
            providers={providers}
            onProvidersChange={setProviders}
          />
        )}
        {activeTab === "schedules" && <SchedulesTab />}
        {activeTab === "mcps" && (
          <McpsTab orgId={orgId} createdBy={createdBy} members={members} />
        )}
      </SettingsLayout>
    </>
  );
}
