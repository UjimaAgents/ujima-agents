"use client";

import {
  Activity,
  Bell,
  Building2,
  Clock,
  Layers,
  MessageSquare,
  Package,
  Plug,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
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
import { PluginsTab } from "./plugins-tab";
import { SchedulesTab } from "./schedules-tab";
import { HeartbeatsTab } from "./heartbeats-tab";
import { SelfImprovementTab } from "./self-improvement-tab";
import { McpsTab } from "./mcps-tab";
import { WorkspacesTab } from "./workspaces-tab";
import { CultureTab } from "@/features/settings/shared/culture-tab";
import { NotificationsTab } from "./notifications-tab";

export type SettingsTabId =
  | "general"
  | "workspaces"
  | "culture"
  | "agents"
  | "channels"
  | "org-chart"
  | "policies"
  | "providers"
  | "plugins"
  | "schedules"
  | "mcps"
  | "notifications"
  | "heartbeats"
  | "self-improvement";

const VALID_TABS: SettingsTabId[] = [
  "general",
  "workspaces",
  "culture",
  "agents",
  "channels",
  "org-chart",
  "policies",
  "providers",
  "plugins",
  "schedules",
  "mcps",
  "notifications",
  "heartbeats",
  "self-improvement",
];

const NAV_GROUPS: SettingsNavGroup<SettingsTabId>[] = [
  {
    label: "Workspace",
    items: [
      { id: "general", label: "General", icon: SlidersHorizontal },
      { id: "workspaces", label: "Workspaces", icon: Layers },
      { id: "culture", label: "Culture", icon: Sparkles },
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
      { id: "plugins", label: "Plugins", icon: Package },
      { id: "mcps", label: "MCPs", icon: Plug },
      { id: "notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Runtime",
    items: [
      { id: "schedules", label: "Schedules", icon: Clock },
      { id: "heartbeats", label: "Heartbeats", icon: Activity },
      { id: "self-improvement", label: "Self-Improvement", icon: Sparkles },
    ],
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
    setTeamSettings,
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
          <WorkspacesTab
            currentWorkspaceRoot={
              orgSettings?.organization.workspace.root ??
              teamSettings?.workspace.root ??
              ""
            }
            configuredProviders={providers}
          />
        )}
        {activeTab === "culture" && (
          <CultureTab organizationId={orgId} channelId={null} members={members} />
        )}
        {activeTab === "agents" && (
          <AgentsTab
            orgId={orgId}
            members={members}
            teamSettings={teamSettings}
            channels={channels}
            providers={providers}
            rolePresets={rolePresets}
            onTeamSettingsChange={setTeamSettings}
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
                shellApprovalMode: "always_review",
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
        {activeTab === "plugins" && (
          <PluginsTab bootstrap={bootstrap} createdBy={createdBy} />
        )}
        {activeTab === "schedules" && <SchedulesTab />}
        {activeTab === "heartbeats" && <HeartbeatsTab />}
        {activeTab === "self-improvement" && <SelfImprovementTab />}
        {activeTab === "notifications" && <NotificationsTab />}
        {activeTab === "mcps" && (
          <McpsTab orgId={orgId} createdBy={createdBy} members={members} />
        )}
      </SettingsLayout>
    </>
  );
}
