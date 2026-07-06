"use client";

import {
  Check,
  ChevronDown,
  Clock,
  Command,
  CircleUserRound,
  Hash,
  KanbanSquare,
  LogOut,
  Moon,
  PanelRight,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { Avatar, RunningFigureIndicator } from "./chat/primitives";
import type { BootstrapResponse } from "@ujima/api-schema";
import { listCustomRoleToolIds, slugifyMemberId } from "@ujima/shared";
import type { CreateAgentHandler, UpdateAgentHandler } from "@/features/team/agent-mutations";
import type { SelectedConversation, WorkspaceRoleInput } from "../types";
import { useState, useMemo, useEffect, useRef, memo, useCallback } from "react";
import { APP_VERSION } from "@/lib/app-version";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { TextInput } from "@/components/ui/form-fields";
import type { RolePresetTemplate } from "../../onboarding/types";
import { defaultModelForProvider } from "../../onboarding/types";
import { resolveMemberActivity } from "../workspace-store";
import type { ActivityState } from "../activity-state";
import { listItemIdle, listItemSelectedNeutral } from "@/lib/list-item-styles";
import { AgentEditorModal } from "./sidebar/agent-editor-modal";
import { CreateAgentModal } from "./sidebar/create-agent-modal";
import { CreateChannelModal } from "./sidebar/create-channel-modal";
import { SidebarSectionEmpty } from "./sidebar/sidebar-section-empty";
import { switchOrganization, switchToWorkspace, orgWorkspaceId } from "../switch-workspace";
import { visibleWorkspaceChannels } from "../workspace-channels";
import { WORKSPACE_DOCK_ROW_CLASS } from "../workspace-dock";
import {
  WorkspaceCreateModal,
  type WorkspaceCreateSubmitInput,
} from "../../settings/organization/components/workspaces/workspace-create-modal";
import { createWorkspaceApi } from "../workspace-api";
import { ConfirmDialog } from "@/features/settings/shared/confirm-dialog";

interface WorkspaceSchedule {
  id: string;
  name: string;
  status: "active" | "paused" | "completed" | "failed";
  runCount: number;
}

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
    // Full org tool catalog (id → capability).
    tools?: Record<string, { id: string; name?: string; description?: string }>;
  } | null;
  goalMode: boolean;
  agentEditorTargetId?: string | null;
  onAgentEditorHandled?: () => void;
  channels: BootstrapResponse["channels"];
  members: BootstrapResponse["members"];
  memberActivity: Record<string, ActivityState>;
  conversationUnreadCounts: Record<string, number>;
  selected?: SelectedConversation;
  tasksActive?: boolean;
  onOpenTasks?: () => void;
  onSelect: (conv: SelectedConversation) => void;
  onCreateChannel: (name: string) => Promise<SelectedConversation | null>;
  onCreateAgent: CreateAgentHandler;
  onUpdateAgent: UpdateAgentHandler;
}

export function slugifyRoleName(value: string) {
  return slugifyMemberId(value);
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
    tools: listCustomRoleToolIds(role?.tools ?? []),
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

export const WorkspaceSidebar = memo(function WorkspaceSidebar({
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
  tasksActive = false,
  onOpenTasks,
  onSelect,
  onCreateChannel,
  onCreateAgent,
  onUpdateAgent,
}: WorkspaceSidebarProps) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [isChannelModalOpen, setIsChannelModalOpen] = useState(false);
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);
  const [isCreateWorkspaceOpen, setIsCreateWorkspaceOpen] = useState(false);
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ workspaceId: string; name: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [workspaces, setWorkspaces] = useState<{ id: string; root_path: string | null; label: string | null }[]>([]);
  const [schedules, setSchedules] = useState<WorkspaceSchedule[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleCounts, setVisibleCounts] = useState({
    channels: 5,
    agents: 5,
    schedules: 5,
  });
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const initialProvider =
    bootstrap.providers.find((provider) => provider.hasKey)?.name ?? "openai";
  const memberName = bootstrap.auth.member?.name || "Admin";
  const memberEmail = bootstrap.auth.user?.email || "No email";
  const memberInitials = memberName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "A";
  const nextTheme = resolvedTheme === "dark" ? "light" : "dark";
  const themeLabel = `Switch to ${nextTheme === "dark" ? "dark" : "light"} mode`;

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
  const visibleChannels = useMemo(() => visibleWorkspaceChannels(channels), [channels]);
  const agentMembers = useMemo(
    () => members.filter((member) => member.kind === "agent"),
    [members],
  );
  const filteredChannels = useMemo(
    () =>
      searchQuery
        ? visibleChannels.filter((ch) =>
            ch.name.toLowerCase().includes(searchQuery.toLowerCase()),
          )
        : visibleChannels,
    [visibleChannels, searchQuery],
  );
  const filteredAgents = useMemo(
    () =>
      searchQuery
        ? agentMembers.filter((agent) =>
            agent.name.toLowerCase().includes(searchQuery.toLowerCase()),
          )
        : agentMembers,
    [agentMembers, searchQuery],
  );
  const orgId = bootstrap.organization?.id;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/workspaces");
        if (!response.ok) return;
        const body = (await response.json().catch(() => null)) as { workspaces?: { id: string; root_path: string | null; label: string | null }[] } | null;
        if (cancelled) return;
        setWorkspaces(body?.workspaces ?? []);
      } catch {
        if (!cancelled) setWorkspaces([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

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

  useEffect(() => {
    if (!accountMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !accountMenuRef.current?.contains(target)) {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [accountMenuOpen]);

  const showMore = useCallback((key: keyof typeof visibleCounts) => {
    setVisibleCounts((current) => ({ ...current, [key]: current[key] + 10 }));
  }, []);

  const openSchedules = useCallback(() => {
    router.push("/settings/organization?tab=schedules");
  }, [router]);

  const handleCreateWorkspace = useCallback(async (input: WorkspaceCreateSubmitInput) => {
    const created = await createWorkspaceApi(input);
    await switchToWorkspace(created.id, "/workspace");
  }, []);

  const handleDeleteWorkspace = useCallback(async () => {
    if (!pendingDelete) return;
    setDeletingWorkspace(true);
    setDeleteError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(pendingDelete.workspaceId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Failed to delete workspace");
      }
      setPendingDelete(null);
      window.location.reload();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete workspace");
    } finally {
      setDeletingWorkspace(false);
    }
  }, [pendingDelete]);

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    setAccountMenuOpen(false);
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }, [loggingOut, router]);

  return (
    <aside className="relative flex h-full w-full flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#09090b]">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-zinc-50/50 to-transparent dark:from-white/[0.02]" />

      <div ref={headerMenuRef} className="relative z-30 px-4 pt-3">
        <div className="relative min-w-0 w-full">
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
          {menuOpen && bootstrap.organizations.length >= 1 ? (
            <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-[0_16px_40px_rgba(0,0,0,0.12)] dark:border-zinc-800 dark:bg-[#09090b]">
              <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                Workspaces
              </p>
              <div className="space-y-0.5 max-h-60 overflow-y-auto">
                {bootstrap.organizations.map((org) => {
                  const active = org.id === bootstrap.organization?.id;
                  const busy = switchingOrgId === org.id;
                  return (
                    <div key={org.id} className="group/workspace flex items-center gap-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900">
                      <button
                        type="button"
                        disabled={Boolean(switchingOrgId)}
                        onClick={() => {
                          void (async () => {
                            setMenuOpen(false);
                            if (active || switchingOrgId) return;
                            setSwitchingOrgId(org.id);
                            try {
                              await switchOrganization(org.id, "/workspace");
                            } catch {
                              setSwitchingOrgId(null);
                            }
                          })();
                        }}
                        className={`flex-1 flex items-center gap-2 px-2 py-2 text-left text-xs transition disabled:opacity-60 ${
                          active ? listItemSelectedNeutral : listItemIdle
                        }`}
                      >
                        {busy ? <Clock className="h-3.5 w-3.5 shrink-0 animate-pulse" /> : null}
                        <span className="flex-1 truncate font-medium">{org.name}</span>
                        {active ? <Check className="h-3.5 w-3.5 shrink-0 text-zinc-500" /> : null}
                      </button>
                      {!active && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteError(null);
                            setPendingDelete({
                              workspaceId: orgWorkspaceId(org.id),
                              name: org.name,
                            });
                          }}
                          className="mr-1 rounded p-1 text-zinc-400 hover:bg-red-500/10 hover:text-red-500 transition-colors"
                          title="Delete Workspace"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setIsCreateWorkspaceOpen(true);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold text-violet-600 hover:bg-zinc-100 dark:text-violet-400 dark:hover:bg-zinc-900"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                Add Workspace
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="relative z-10 px-4 py-1.5">
        <div className="group relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400 group-focus-within:text-violet-500" />
          <TextInput
            type="text"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-9 pr-8 text-xs bg-zinc-50/50 focus:ring-1 focus:ring-violet-500 dark:bg-zinc-900/50"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800">
            ⌘K
          </kbd>
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-5">
          <SidebarSectionHeader title="Workspace" />
          <div className="mt-1.5 space-y-0.5">
            <SidebarItem
              icon={<KanbanSquare className="h-4 w-4" />}
              label="Tasks"
              active={tasksActive}
              onClick={onOpenTasks}
            />
          </div>
        </div>

        <div className="mb-5">
          <SidebarSectionHeader title="Channels" onAdd={() => setIsChannelModalOpen(true)} />
          <div className="mt-1.5 space-y-0.5">
            {filteredChannels.length === 0 ? (
              <SidebarSectionEmpty
                message="No channels yet. Create one to start conversations."
                actionLabel="Add channel"
                onAction={() => setIsChannelModalOpen(true)}
              />
            ) : (
              filteredChannels.slice(0, visibleCounts.channels).map((channel) => (
                <SidebarItem
                  key={channel.id}
                  icon={<Hash className="h-4 w-4" />}
                  label={channel.name}
                  count={conversationUnreadCounts[channel.id]}
                active={
                  selected?.type === "channel" && selected.id === channel.id
                }
                  onClick={() =>
                    onSelect({
                      type: "channel",
                      id: channel.id,
                      name: channel.name,
                    })
                  }
                />
              ))
            )}
          </div>
          {filteredChannels.length > visibleCounts.channels ? (
            <button
              type="button"
              onClick={() => showMore("channels")}
              className="mt-1 px-2 text-[11px] font-medium text-zinc-400 transition hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-400"
            >
              Show 10 more
            </button>
          ) : null}
        </div>

        <div className="mb-5">
          <SidebarSectionHeader title="Agents" onAdd={() => setIsAgentModalOpen(true)} />
          <div className="mt-1.5 space-y-0.5">
            {filteredAgents.length === 0 ? (
              <SidebarSectionEmpty
                message="No agents yet. Add one to delegate work in this workspace."
                actionLabel="Add agent"
                onAction={() => setIsAgentModalOpen(true)}
              />
            ) : (
              filteredAgents.slice(0, visibleCounts.agents).map((agent, idx) => {
                const roleTitle = teamSettings?.roles.find((r) => r.name === agent.roleName)?.title;
                return (
                  <SidebarItem
                    key={agent.id}
                    icon={<Avatar name={agent.name} colorIndex={idx} size="xs" />}
                    label={agent.name}
                    subtitle={roleTitle}
                    count={conversationUnreadCounts[agent.id]}
                    active={selected?.type === "agent" && selected.id === agent.id}
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
                );
              })
            )}
          </div>
          {filteredAgents.length > visibleCounts.agents ? (
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
      <div ref={accountMenuRef} className={`${WORKSPACE_DOCK_ROW_CLASS} relative px-3 pb-3`}>
        {accountMenuOpen ? (
          <div className="absolute bottom-full left-3 right-3 z-40 mb-2 overflow-hidden rounded-lg border border-zinc-200/50 bg-white/90 p-2 shadow-[0_10px_30px_-5px_rgba(0,0,0,0.08),_0_0_1px_rgba(0,0,0,0.03)] backdrop-blur-sm animate-in fade-in slide-in-from-bottom-1 duration-150 dark:border-zinc-800/50 dark:bg-zinc-950/90">
            <div className="flex items-center gap-2.5 px-2 py-1">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-200/70 bg-zinc-50/80 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-300">
                <CircleUserRound className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{memberEmail}</p>
              </div>
            </div>

            <div className="my-2 h-px bg-zinc-200/80 dark:bg-zinc-800/80" />

            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setTheme(nextTheme)}
                className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm font-medium text-zinc-900 transition hover:bg-zinc-100/80 dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                {nextTheme === "dark" ? (
                  <Moon className="h-4 w-4 text-zinc-500" />
                ) : (
                  <Sun className="h-4 w-4 text-zinc-500" />
                )}
                <span className="flex-1">{themeLabel}</span>
              </button>

              <Link
                href="/profile"
                onClick={() => setAccountMenuOpen(false)}
                className="flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100/80 dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                <PanelRight className="h-4 w-4 text-zinc-500" />
                <span className="flex-1">Profile</span>
              </Link>

              <Link
                href="/settings/organization"
                onClick={() => setAccountMenuOpen(false)}
                className="flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100/80 dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                <Settings className="h-4 w-4 text-zinc-500" />
                <span className="flex-1">Settings</span>
              </Link>

              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={loggingOut}
                className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm font-medium text-zinc-900 transition hover:bg-zinc-100/80 disabled:opacity-60 dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                <LogOut className="h-4 w-4 text-zinc-500" />
                <span className="flex-1">{loggingOut ? "Logging out..." : "Log out"}</span>
              </button>
            </div>

            <div className="px-2.5 pt-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
              v{APP_VERSION}
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setAccountMenuOpen((value) => !value)}
          className="flex w-full items-center gap-3 rounded-2xl border border-zinc-200/70 bg-white/80 px-3 py-2 text-left shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950/80 dark:hover:bg-zinc-900"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-300 via-rose-400 to-orange-500 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(251,146,60,0.22)]">
            {memberInitials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{memberName}</p>
          </div>
          <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-400 transition ${accountMenuOpen ? "rotate-180" : ""}`} />
        </button>
      </div>

      <CreateChannelModal
        isOpen={isChannelModalOpen}
        onClose={() => setIsChannelModalOpen(false)}
        onCreateChannel={onCreateChannel}
        onSelect={onSelect}
      />

      <WorkspaceCreateModal
        isOpen={isCreateWorkspaceOpen}
        onClose={() => setIsCreateWorkspaceOpen(false)}
        configuredProviders={bootstrap.providers}
        workspaces={workspaces}
        onSubmit={handleCreateWorkspace}
      />

      <CreateAgentModal
        isOpen={isAgentModalOpen}
        onClose={() => setIsAgentModalOpen(false)}
        rolePresets={rolePresets}
        initialProvider={initialProvider}
        channels={visibleChannels.map((channel) => ({ id: channel.id, name: channel.name }))}
        primaryChannelId={primaryChannel?.id}
        orgId={orgId}
        onCreateAgent={onCreateAgent}
        onSelect={onSelect}
      />

      {deleteError ? (
        <p className="mx-4 mb-2 text-xs text-red-600 dark:text-red-400">{deleteError}</p>
      ) : null}

      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        title="Delete workspace"
        message={`Delete "${pendingDelete?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        busy={deletingWorkspace}
        onConfirm={handleDeleteWorkspace}
      />

      {agentEditorTargetId ? (
        <AgentEditorModal
          key={agentEditorTargetId}
          agent={agentMembers.find((item) => item.id === agentEditorTargetId) ?? null}
          teamSettings={teamSettings}
          rolePresets={rolePresets}
          visibleChannels={visibleChannels}
          orgId={orgId}
          onClose={() => onAgentEditorHandled?.()}
          onSelect={onSelect}
          onUpdateAgent={onUpdateAgent}
        />
      ) : null}
    </aside>
  );
});

export const SidebarItem = memo(function SidebarItem({
  icon,
  label,
  subtitle,
  count,
  active,
  status,
  goalMode,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  subtitle?: string;
  count?: number;
  active?: boolean;
  status?: ActivityState;
  goalMode?: boolean;
  onClick?: () => void;
}) {
  const useRunner = active && goalMode && status === "working";
  return (
    <div
      className={`group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition relative ${
        active
          ? "bg-violet-600/10 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
      }`}
    >
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] bg-violet-600 dark:bg-violet-500 rounded-r" />
      )}
      <button
        type="button"
        onClick={onClick}
        title={subtitle ? `${label} — ${subtitle}` : label}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <div
          className={`relative shrink-0 ${active ? "text-violet-600 dark:text-violet-400" : "text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100"}`}
        >
          {icon}
          {status && status !== "loading" && (
            <div className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-white dark:border-[#09090b] ${
              status === "working" ? "bg-violet-500 animate-pulse" :
              status === "online" ? "bg-emerald-500" :
              status === "idle" ? "bg-amber-500" :
              status === "offline" ? "bg-zinc-300 dark:bg-zinc-700" :
              status === "error" ? "bg-red-500" : ""
            }`} />
          )}
          {status === "loading" && (
            <div className="absolute -bottom-0.5 -right-0.5 h-2 w-2 animate-spin rounded-full border border-violet-500 border-t-transparent bg-white dark:bg-[#09090b]" />
          )}
        </div>
        <span
          className={`flex-1 truncate ${active ? "font-semibold" : "font-medium"}`}
        >
          {label}
        </span>
        {subtitle ? (
          <span className="hidden shrink-0 truncate text-[10px] text-zinc-400 group-hover:inline dark:text-zinc-500">
            {subtitle}
          </span>
        ) : null}
        {count && count > 0 ? (
          <span className="ml-1 rounded-full bg-violet-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {count}
          </span>
        ) : null}
      </button>
      <div className="flex items-center gap-1.5">
        {useRunner ? (
          <RunningFigureIndicator />
        ) : null}
      </div>
    </div>
  );
});

export const SidebarSectionHeader = memo(function SidebarSectionHeader({
  title,
  onAdd,
}: {
  title: string;
  onAdd?: () => void;
}) {
  return (
    <div className="group/section flex items-center justify-between px-2">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
        {title}
      </h3>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="opacity-0 group-hover/section:opacity-100 transition-opacity duration-200 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
});
