"use client";

import {
  Check,
  ChevronDown,
  Clock,
  Command,
  Hash,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { Avatar } from "./chat/primitives";
import type { BootstrapResponse } from "@ujima/api-schema";
import type { SelectedConversation, WorkspaceRoleInput } from "../types";
import { useState, useMemo, useEffect, useRef, memo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { TextInput } from "@/components/ui/form-fields";
import type { RolePresetTemplate } from "../../onboarding/types";
import { defaultModelForProvider } from "../../onboarding/types";
import { resolveMemberActivity } from "../workspace-store";
import type { ActivityState } from "../activity-state";
import { ThemeToggle } from "@/components/theme-toggle";
import { AgentEditorModal } from "./sidebar/agent-editor-modal";
import { CreateAgentModal } from "./sidebar/create-agent-modal";
import { CreateChannelModal } from "./sidebar/create-channel-modal";
import { reloadAfterWorkspaceSwitch, switchWorkspace } from "../switch-workspace";

type WorkspaceSchedule = {
  id: string;
  name: string;
  status: "active" | "paused" | "completed" | "failed";
  runCount: number;
};

type WorkspaceOption = {
  id: string;
  root_path: string | null;
  label: string | null;
  is_current?: boolean;
};

export interface WorkspaceSidebarProps {
  bootstrap: BootstrapResponse;
  rolePresets: RolePresetTemplate[];
  teamSettings: {
    agents: { name: string; roleName: string; personalityName: string; kind: string }[];
    roles: {
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
    }[];
  } | null;
  goalMode: boolean;
  agentEditorTargetId?: string | null;
  onAgentEditorHandled?: () => void;
  channels: BootstrapResponse["channels"];
  members: BootstrapResponse["members"];
  memberActivity: Record<string, ActivityState>;
  conversationUnreadCounts: Record<string, number>;
  selected: SelectedConversation;
  onSelect: (conv: SelectedConversation) => void;
  onCreateChannel: (name: string) => Promise<SelectedConversation | null>;
  onCreateAgent: (input: {
    name: string;
    roleName: string;
    channelIds: string[];
    llm: string;
    model: string;
    role: WorkspaceRoleInput;
  }) => Promise<SelectedConversation | null>;
  onUpdateAgent: (input: {
    previousAgentId: string;
    previousRoleName: string;
    memberId: string;
    name: string;
    roleName: string;
    personalityName: string;
    channelIds: string[];
    llm: string;
    model: string;
    role: WorkspaceRoleInput;
  }) => Promise<BootstrapResponse["members"][number] | null>;
}

export function slugifyRoleName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function roleFromTemplate(template: RolePresetTemplate): WorkspaceRoleInput {
  return {
    id: template.name,
    name: template.name,
    title: template.title,
    description: template.description,
    instructions: template.instructions,
    kind: "agent",
    workspaceScopes: template.workspaceScopes ?? [],
    tools: template.tools ?? [],
    channels: ["general"],
    skills: template.skills ?? [],
  };
}

export function customRole(title: string, instructions: string): WorkspaceRoleInput {
  const name = slugifyRoleName(title) || "custom-agent";
  return {
    id: name,
    name,
    title: title.trim(),
    description: "",
    instructions: instructions.trim(),
    kind: "agent",
    workspaceScopes: [],
    tools: [],
    channels: ["general"],
    skills: [],
  };
}

export interface AgentEditorDraft {
  originalName: string;
  originalRoleName: string;
  memberId: string;
  name: string;
  roleName: string;
  personalityName: string;
  llm: string;
  model: string;
  title: string;
  description: string;
  instructions: string;
  workspaceScopes: string[];
  tools: string[];
  channels: string[];
  skills: string[];
}

export function buildAgentEditorDraft({
  agent,
  teamSettings,
  rolePresets,
  channels,
}: {
  agent: BootstrapResponse["members"][number];
  teamSettings: WorkspaceSidebarProps["teamSettings"];
  rolePresets: RolePresetTemplate[];
  channels: BootstrapResponse["channels"];
}) {
  const role =
    teamSettings?.roles.find((item) => item.name === agent.roleName) ??
    rolePresets.find((item) => item.name === agent.roleName);
  const provider = role && "provider" in role ? role.provider : undefined;
  const model = role && "model" in role ? role.model : undefined;
  const personalityName =
    teamSettings?.agents.find((item) => item.name === agent.id)?.personalityName ??
    "direct";

  return {
    originalName: agent.name,
    originalRoleName: agent.roleName,
    memberId: agent.id,
    name: agent.name,
    roleName: agent.roleName,
    personalityName,
    llm: agent.llm ?? provider ?? "openai",
    model:
      agent.model ??
      model ??
      defaultModelForProvider(agent.llm ?? provider ?? "openai"),
    title: role?.title ?? agent.roleName,
    description: role?.description ?? "",
    instructions: role?.instructions ?? "",
    workspaceScopes: role?.workspaceScopes ?? [],
    tools: role?.tools ?? [],
    channels: (role?.channels ?? ["general"])
      .map((channelName) => channels.find((channel) => channel.name === channelName)?.id)
      .filter((id): id is string => Boolean(id)),
    skills: role?.skills ?? [],
  } satisfies AgentEditorDraft;
}

export const PERSONALITY_OPTIONS = [
  { value: "direct", label: "Direct" },
  { value: "thoughtful", label: "Thoughtful" },
  { value: "precise", label: "Precise" },
  { value: "warm", label: "Warm" },
  { value: "skeptical", label: "Skeptical" },
  { value: "pragmatic", label: "Pragmatic" },
] as const;

export function listCsvValues(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function joinCsvValues(values: string[]) {
  return values.join(", ");
}

export function uniqueSorted(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function scheduleStatusToActivity(status: WorkspaceSchedule["status"]): ActivityState {
  if (status === "active") return "online";
  if (status === "paused") return "idle";
  if (status === "failed") return "error";
  return "offline";
}

export function WorkspaceSidebar({
  bootstrap,
  rolePresets,
  teamSettings,
  goalMode,
  agentEditorTargetId,
  onAgentEditorHandled,
  channels,
  members,
  memberActivity,
  conversationUnreadCounts,
  selected,
  onSelect,
  onCreateChannel,
  onCreateAgent,
  onUpdateAgent,
}: WorkspaceSidebarProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isChannelModalOpen, setIsChannelModalOpen] = useState(false);
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<WorkspaceSchedule[]>([]);
  const [visibleCounts, setVisibleCounts] = useState({
    channels: 5,
    agents: 5,
    schedules: 5,
  });
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const workspacesFetched = useRef(false);
  const initialProvider =
    bootstrap.providers.find((provider) => provider.hasKey)?.name ?? "openai";

  const primaryChannel = useMemo(
    () =>
      channels.find(
        (channel) =>
          channel.name === "general" &&
          channel.kind !== "self" &&
          channel.kind !== "dm",
      ) ??
      channels.find(
        (channel) => channel.kind !== "self" && channel.kind !== "dm",
      ) ??
      null,
    [channels],
  );
  const visibleChannels = useMemo(
    () => channels.filter((channel) => channel.kind !== "self" && channel.kind !== "dm"),
    [channels],
  );
  const agentMembers = useMemo(
    () => members.filter((member) => member.kind === "agent"),
    [members],
  );
  const orgId = bootstrap.organization?.id;

  useEffect(() => {
    if (!menuOpen) return;
    if (workspacesFetched.current || !orgId) return;
    workspacesFetched.current = true;
    setLoadingWorkspaces(true);
    void (async () => {
      try {
        const response = await fetch("/api/workspaces");
        if (!response.ok) return;
        const body = (await response.json().catch(() => null)) as { workspaces?: WorkspaceOption[] } | null;
        setWorkspaces(body?.workspaces ?? []);
      } catch {
        setWorkspaces([]);
      } finally {
        setLoadingWorkspaces(false);
      }
    })();
  }, [menuOpen, orgId]);

  useEffect(() => {
    let cancelled = false;
    setSchedules([]);

    if (!orgId) return;

    void (async () => {
      try {
        const response = await fetch("/api/schedules");
        if (!response.ok) return;
        const body = (await response.json().catch(() => null)) as { jobs?: WorkspaceSchedule[] } | null;
        if (cancelled) return;
        setSchedules(body?.jobs ?? []);
      } catch {
        if (!cancelled) setSchedules([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !headerMenuRef.current?.contains(target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const showMore = useCallback((key: keyof typeof visibleCounts) => {
    setVisibleCounts((current) => ({ ...current, [key]: current[key] + 10 }));
  }, []);

  const openSchedules = useCallback(() => {
    router.push("/settings/organization?tab=schedules");
  }, [router]);

  const handleWorkspaceSelect = useCallback(
    async (workspaceId: string, isCurrent: boolean) => {
      setMenuOpen(false);
      if (isCurrent || switchingWorkspaceId) return;
      setSwitchingWorkspaceId(workspaceId);
      try {
        await switchWorkspace(workspaceId);
        reloadAfterWorkspaceSwitch();
      } catch {
        setSwitchingWorkspaceId(null);
      }
    },
    [switchingWorkspaceId],
  );

  return (
    <aside className="relative flex h-full w-full flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#09090b]">
      {/* Sidebar background gradient */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-zinc-50/50 to-transparent dark:from-white/[0.02]" />

      {/* Workspace Header / Org Switcher */}
      <div ref={headerMenuRef} className="relative z-30 px-4 pt-3">
        <div className="flex items-start justify-between gap-2">
          <div className="relative min-w-0 flex-1">
            <button
              onClick={() => setMenuOpen((value) => !value)}
              className="flex w-full min-w-0 items-center gap-2 rounded-lg p-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-indigo-700 text-white shadow-[0_0_15px_rgba(124,58,237,0.3)]">
                <Command className="h-5 w-5" />
              </div>
              <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {bootstrap.organization?.name || "Ujima Agents"}
              </span>
              <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-zinc-400" />
            </button>
            {menuOpen ? (
              <div className="absolute left-11 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-[0_16px_40px_rgba(0,0,0,0.12)] dark:border-zinc-800 dark:bg-[#09090b]">
                {bootstrap.organizations.length > 1 ? (
                  <>
                    {bootstrap.organizations.map((org) => {
                      const active = org.id === bootstrap.organization?.id;
                      return (
                        <button
                          key={org.id}
                          type="button"
                          onClick={async () => {
                            setMenuOpen(false);
                            if (active) return;
                            const res = await fetch("/api/auth/switch-org", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ organizationId: org.id }),
                            });
                            if (res.ok) {
                              window.location.href = "/workspace";
                            }
                          }}
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition ${
                            active
                              ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50"
                              : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                          }`}
                        >
                          <span className="flex-1 truncate font-medium">{org.name}</span>
                          {active ? <Check className="h-3.5 w-3.5 text-zinc-500" /> : null}
                        </button>
                      );
                    })}

                    <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
                  </>
                ) : null}
                {loadingWorkspaces ? (
                  <p className="px-2 py-2 text-xs text-zinc-500">Loading...</p>
                ) : null}
                {!loadingWorkspaces ? (
                  workspaces.map((workspace) => {
                    const active = Boolean(workspace.is_current);
                    const busy = switchingWorkspaceId === workspace.id;
                    return (
                      <button
                        key={workspace.id}
                        type="button"
                        disabled={Boolean(switchingWorkspaceId)}
                        onClick={() => void handleWorkspaceSelect(workspace.id, active)}
                        className={`flex w-full flex-col gap-0.5 rounded-lg px-2 py-2 text-left text-xs transition ${
                          active
                            ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50"
                            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                        } disabled:opacity-60`}
                      >
                        <span className="flex items-center gap-2 font-medium">
                          {busy ? <Clock className="h-3.5 w-3.5 animate-pulse" /> : null}
                          <span className="truncate">{workspace.label || workspace.id}</span>
                          {active ? <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-zinc-500" /> : null}
                        </span>
                        <span className="truncate font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                          {workspace.root_path || "—"}
                        </span>
                      </button>
                    );
                  })
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-1">
            <ThemeToggle compact />
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative z-10 px-4 py-1.5">
        <div className="group relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400 group-focus-within:text-violet-500" />
          <TextInput
            type="text"
            placeholder="Search"
            className="h-8 pl-9 pr-8 text-xs bg-zinc-50/50 focus:ring-1 focus:ring-violet-500 dark:bg-zinc-900/50"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Navigation Groups */}
      <div className="relative z-10 flex-1 overflow-y-auto px-2 py-3">
        {/* Channels */}
        <div className="mb-5">
          <SidebarSectionHeader title="Channels" onAdd={() => setIsChannelModalOpen(true)} />
          <div className="mt-1.5 space-y-0.5">
            {visibleChannels.slice(0, visibleCounts.channels).map((channel) => (
              <SidebarItem
                key={channel.id}
                icon={<Hash className="h-4 w-4" />}
                label={channel.name}
                count={conversationUnreadCounts[channel.id]}
                active={
                  selected.type === "channel" && selected.id === channel.id
                }
                onClick={() =>
                  onSelect({
                    type: "channel",
                    id: channel.id,
                    name: channel.name,
                  })
                }
              />
            ))}
          </div>
          {visibleChannels.length > visibleCounts.channels ? (
            <button
              type="button"
              onClick={() => showMore("channels")}
              className="mt-1 px-2 text-[11px] font-medium text-zinc-400 transition hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-400"
            >
              Show 10 more
            </button>
          ) : null}
        </div>

        {/* Agents */}
        <div className="mb-5">
          <SidebarSectionHeader title="Agents" onAdd={() => setIsAgentModalOpen(true)} />
          <div className="mt-1.5 space-y-0.5">
            {agentMembers.slice(0, visibleCounts.agents).map((agent, idx) => (
              <SidebarItem
                key={agent.id}
                icon={<Avatar name={agent.name} colorIndex={idx} size="xs" />}
                label={agent.name}
                count={conversationUnreadCounts[agent.id]}
                active={selected.type === "agent" && selected.id === agent.id}
                status={resolveMemberActivity(agent, memberActivity)}
                goalMode={goalMode}
                onClick={() =>
                  onSelect({
                    type: "agent",
                    id: agent.id,
                    name: agent.name,
                  })
                }
              />
            ))}
          </div>
          {agentMembers.length > visibleCounts.agents ? (
            <button
              type="button"
              onClick={() => showMore("agents")}
              className="mt-1 px-2 text-[11px] font-medium text-zinc-400 transition hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-400"
            >
              Show 10 more
            </button>
          ) : null}
        </div>

        {schedules.length > 0 ? (
          <div className="mb-5">
            <SidebarSectionHeader title="Schedules" />
            <div className="mt-1.5 space-y-0.5">
              {schedules.slice(0, visibleCounts.schedules).map((schedule) => (
                <SidebarItem
                  key={schedule.id}
                  icon={<Clock className="h-4 w-4" />}
                  label={schedule.name}
                  count={schedule.runCount > 0 ? schedule.runCount : undefined}
                  status={scheduleStatusToActivity(schedule.status)}
                  onClick={openSchedules}
                />
              ))}
            </div>
            {schedules.length > visibleCounts.schedules ? (
              <button
                type="button"
                onClick={() => showMore("schedules")}
                className="mt-1 px-2 text-[11px] font-medium text-zinc-400 transition hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-400"
              >
                Show 10 more
              </button>
            ) : null}
          </div>
        ) : null}
      </div>



      {/* User Footer */}
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <Link
          href="/settings/organization"
          className="flex w-full items-center gap-3 rounded-xl p-2 transition hover:bg-zinc-100 dark:hover:bg-zinc-900 text-left"
        >
          <div className="relative shrink-0">
            <div className="h-9 w-9 rounded-full bg-gradient-to-tr from-violet-500 to-indigo-500 shadow-[0_2px_10px_rgba(99,102,241,0.2)]" />
            <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-[#09090b]" />
          </div>
          <div className="flex flex-col items-start overflow-hidden">
            <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {bootstrap.auth.member?.name || "Admin"}
            </span>
          </div>
          <Settings className="ml-auto h-4 w-4 text-zinc-400" />
        </Link>
      </div>

      <CreateChannelModal
        isOpen={isChannelModalOpen}
        onClose={() => setIsChannelModalOpen(false)}
        onCreateChannel={onCreateChannel}
        onSelect={onSelect}
      />

      <CreateAgentModal
        isOpen={isAgentModalOpen}
        onClose={() => setIsAgentModalOpen(false)}
        rolePresets={rolePresets}
        initialProvider={initialProvider}
        primaryChannel={primaryChannel}
        onCreateAgent={onCreateAgent}
        onSelect={onSelect}
      />

      {agentEditorTargetId ? (
        <AgentEditorModal
          key={agentEditorTargetId}
          agent={agentMembers.find((item) => item.id === agentEditorTargetId) ?? null}
          teamSettings={teamSettings}
          rolePresets={rolePresets}
          visibleChannels={visibleChannels}
          onClose={() => onAgentEditorHandled?.()}
          onSelect={onSelect}
          onUpdateAgent={onUpdateAgent}
        />
      ) : null}
    </aside>
  );
}

export const SidebarItem = memo(function SidebarItem({
  icon,
  label,
  count,
  active,
  status,
  goalMode,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  status?: ActivityState;
  goalMode?: boolean;
  onClick?: () => void;
}) {
  const useRunner = active && goalMode && status === "working";
  return (
    <div
      className={`group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition ${
        active
          ? "bg-violet-600/10 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <div
          className={`${active ? "text-violet-600 dark:text-violet-400" : "text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100"}`}
        >
          {icon}
        </div>
        <span
          className={`flex-1 truncate ${active ? "font-semibold" : "font-medium"}`}
        >
          {label}
        </span>
        {count && count > 0 ? (
          <span className="ml-1 rounded-full bg-violet-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {count}
          </span>
        ) : null}
      </button>
      <div className="flex items-center gap-1.5">
        {useRunner ? (
          <RunningFigureIndicator />
        ) : status === "loading" ? (
          <div className="h-2 w-2 animate-spin rounded-full border border-violet-500 border-t-transparent" />
        ) : status === "working" ? (
          <div className="h-2 w-2 animate-pulse rounded-full bg-violet-500" />
        ) : status === "online" ? (
          <div className="h-2 w-2 rounded-full bg-emerald-500" />
        ) : status === "idle" ? (
          <div className="h-2 w-2 rounded-full bg-amber-500" />
        ) : status === "offline" ? (
          <div className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-700" />
        ) : status === "error" ? (
          <div className="h-2 w-2 rounded-full bg-red-500" />
        ) : null}
      </div>
    </div>
  );
});

function RunningFigureIndicator() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      {/* Head */}
      <circle cx="14" cy="4" r="1.4" fill="currentColor" stroke="none" />

      {/* Torso */}
      <line x1="13.5" y1="5.5" x2="11" y2="12">
        <animate attributeName="y2" values="12;11.5;12;11.5;12" dur="0.6s" repeatCount="indefinite" />
      </line>

      {/* Back arm (depth via opacity) */}
      <path strokeOpacity="0.4" d="M13 7 L10 9.5">
        <animate attributeName="d"
          values="M13 7 L10 9.5;M13 7 L15.5 9;M13 7 L16 10.5;M13 7 L15.5 9;M13 7 L10 9.5"
          dur="0.6s" repeatCount="indefinite" />
      </path>

      {/* Front arm */}
      <path d="M13 7 L16 10.5">
        <animate attributeName="d"
          values="M13 7 L16 10.5;M13 7 L11.5 10;M13 7 L10 9.5;M13 7 L11.5 10;M13 7 L16 10.5"
          dur="0.6s" repeatCount="indefinite" />
      </path>

      {/* Back leg (depth via opacity) */}
      <path strokeOpacity="0.4" d="M11 12 L8 15 L6.5 16">
        <animate attributeName="d"
          values="M11 12 L8 15 L6.5 16;M11 12 L12 16 L14 19;M11 12 L14.5 15.5 L16.5 18;M11 12 L12 16 L14 19;M11 12 L8 15 L6.5 16"
          dur="0.6s" repeatCount="indefinite" />
      </path>

      {/* Front leg */}
      <path d="M11 12 L14.5 15.5 L16.5 18">
        <animate attributeName="d"
          values="M11 12 L14.5 15.5 L16.5 18;M11 12 L12 16 L10 19;M11 12 L8 15 L6.5 16;M11 12 L12 16 L10 19;M11 12 L14.5 15.5 L16.5 18"
          dur="0.6s" repeatCount="indefinite" />
      </path>

      {/* Motion lines */}
      <g strokeOpacity="0.25" strokeWidth="1.2">
        <line x1="6" y1="7" x2="3" y2="7.5">
          <animate attributeName="x1" values="6;4;6" dur="0.3s" repeatCount="indefinite" />
          <animate attributeName="x2" values="3;1;3" dur="0.3s" repeatCount="indefinite" />
        </line>
        <line x1="5" y1="10" x2="2.5" y2="10.5">
          <animate attributeName="x1" values="5;3;5" dur="0.3s" repeatCount="indefinite" />
          <animate attributeName="x2" values="2.5;0.5;2.5" dur="0.3s" repeatCount="indefinite" />
        </line>
      </g>
    </svg>
  );
}

export const SidebarSectionHeader = memo(function SidebarSectionHeader({
  title,
  onAdd,
}: {
  title: string;
  onAdd?: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-2">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
        {title}
      </h3>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
});
