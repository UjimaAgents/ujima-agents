"use client";

import {
  Building2,
  FolderKanban,
  MessageSquare,
  Server,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { BootstrapResponse, OrganizationSettingsResponse, ProviderStatus } from "@ujima/api-schema";
import { GeneralTab } from "./general-tab";
import { AgentsTab } from "./agents-tab";
import { ChannelsTab } from "./channels-tab";
import { OrgChartTab } from "./org-chart-tab";
import { PoliciesTab } from "./policies-tab";
import { ProvidersTab } from "./providers-tab";

type SettingsTabId = "general" | "agents" | "channels" | "org-chart" | "policies" | "providers";

interface SettingsTab {
  id: SettingsTabId;
  label: string;
  icon: typeof Users;
}

const TABS: SettingsTab[] = [
  { id: "general", label: "General", icon: FolderKanban },
  { id: "agents", label: "Agents & Roles", icon: Users },
  { id: "channels", label: "Channels", icon: MessageSquare },
  { id: "org-chart", label: "Organization chart", icon: Building2 },
  { id: "policies", label: "Policies", icon: ShieldCheck },
  { id: "providers", label: "Providers", icon: Server },
];

export interface TeamSettingsData {
  name: string;
  workspace: { root: string; roleScopes: Record<string, string[]> };
  organizationChart: { reportsTo: Record<string, string> };
  agents: Array<{ name: string; roleName: string; personalityName: string; kind: string }>;
  roles: Array<{
    id?: string;
    name: string;
    title: string;
    description: string;
    instructions: string;
    kind: string;
    provider?: string;
    model?: string;
    workspaceScopes: string[];
    tools: string[];
    channels: string[];
    skills: string[];
  }>;
  channels: Array<{ id?: string; name: string; kind: string; topic: string; memberIds: string[] }>;
  tools: Record<string, unknown>;
  policies: { requireApprovalForWrites: boolean; requireApprovalForShell: boolean; workspaceBoundaryMode: string };
}

export function OrganizationSettingsPage({
  bootstrap,
  orgSettings,
  teamSettings,
  providers,
}: {
  bootstrap: BootstrapResponse;
  orgSettings: OrganizationSettingsResponse | null;
  teamSettings: TeamSettingsData | null;
  providers: ProviderStatus[];
}) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("general");
  const [orgSettingsState, setOrgSettingsState] = useState(orgSettings);
  const [teamSettingsState] = useState(teamSettings);
  const [providersState, setProvidersState] = useState(providers);

  const orgId = bootstrap.organization?.id ?? "";
  const auth = bootstrap.auth;
  const channels = orgSettingsState?.channels ?? bootstrap.channels ?? [];
  const members = orgSettingsState?.members ?? bootstrap.members ?? [];

  const onOrgNameUpdate = (name: string) => {
    setOrgSettingsState((prev) =>
      prev ? { ...prev, organization: { ...prev.organization, name } } : prev,
    );
  };

  return (
    <main className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.06)] dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-6 px-6 py-7 md:flex-row md:items-start md:justify-between md:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-violet-700 dark:text-violet-300">
              Settings
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-zinc-950 dark:text-zinc-50">
              Organization Settings
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-600 dark:text-zinc-300">
              Manage your organization, team, agents, channels, policies, and providers.
            </p>
          </div>
          <Link
            href="/workspace"
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            Back to workspace
          </Link>
        </div>
      </section>

      <div className="rounded-[24px] border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex flex-wrap gap-6">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-2 border-b-2 pb-3 text-sm font-medium transition ${
                    isActive
                      ? "border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300"
                      : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6">
          {activeTab === "general" && (
            <GeneralTab
              orgId={orgId}
              auth={auth}
              organizationName={bootstrap.organization?.name ?? ""}
              workspaceRoot={teamSettingsState?.workspace.root ?? ""}
              onUpdate={onOrgNameUpdate}
            />
          )}
          {activeTab === "agents" && (
            <AgentsTab
              orgId={orgId}
              members={members}
              teamSettings={teamSettingsState}
              bootstrap={bootstrap}
            />
          )}
          {activeTab === "channels" && (
            <ChannelsTab
              orgId={orgId}
              channels={channels}
            />
          )}
          {activeTab === "org-chart" && (
            <OrgChartTab
              orgId={orgId}
              members={members}
              organizationChart={teamSettingsState?.organizationChart ?? { reportsTo: {} }}
            />
          )}
          {activeTab === "policies" && (
            <PoliciesTab
              orgId={orgId}
              policies={teamSettingsState?.policies ?? { requireApprovalForWrites: true, requireApprovalForShell: true, workspaceBoundaryMode: "hard" }}
            />
          )}
          {activeTab === "providers" && (
            <ProvidersTab
              orgId={orgId}
              providers={providersState}
              onProvidersChange={setProvidersState}
            />
          )}
        </div>
      </div>
    </main>
  );
}
