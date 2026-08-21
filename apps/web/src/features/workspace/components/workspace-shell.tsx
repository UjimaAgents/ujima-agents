"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { GripVertical, MessageSquare } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getDirectMessageThreadId,
  isDirectMessageThread,
  resolveDmPeerMemberId,
  SocketEventNames,
  type RunState,
  type SocketEventName,
} from "@ujima/shared/browser";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { normalizeOrgShellApprovalMode, type ShellApprovalMode } from "@ujima/shared/browser";
import { ChannelView } from "./channel-view";
import { ChannelGoalsBoard } from "./channel-goals-board";
import { WorkspaceTasksView } from "./tasks/workspace-tasks-view";
import { WorkflowsList } from "@/features/workflows/workflows-list";
import { WorkspaceTabBar, type WorkspaceTabItem } from "./workspace-tab-bar";
import { GlobalApprovalIndicator } from "./global-approval-indicator";
import { WorkflowRunsIndicator } from "@/features/workflows/workflow-runs-indicator";
import { WorkflowRunDrawer } from "@/features/workflows/workflow-run-drawer";
import { useWorkflowApprovalsLive } from "../use-workflow-approvals";
import { CommandPalette, type SearchResult } from "@/components/ui/command-palette";
import { BootstrapResponseSchema, type BootstrapResponse } from "@ujima/api-schema";
import { resolveSelectedConversationFromSearchParams } from "../conversation-routing";
import { resolveDefaultConversation } from "../workspace-channels";
import type { SelectedConversation, WorkspaceRoleInput } from "../types";
import { useWorkspaceStore } from "../workspace-store";
import type { RolePresetTemplate } from "../../onboarding/types";
import { runStatusToActivityState } from "../activity-state";
import {
  goalModePreferenceKey,
  readGoalModePreference,
  writeGoalModePreference,
} from "../goal-mode";
import { publishWorkspaceLiveEvent } from "../live-events";
import { clientApiUrl, clientFetchJson, clientFetchVoid } from "@/lib/client-api";

import { useShallow } from "zustand/react/shallow";

export const WORKSPACE_MAIN_GRID_TRANSITION =
  "transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none motion-reduce:duration-0";

type WorkspaceChannel = BootstrapResponse["channels"][number];
type WorkspaceMember = BootstrapResponse["members"][number];
interface WorkspaceTeamRole {
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
}
type WorkspaceTeamSettings = {
  workspace?: { root: string; roleScopes?: Record<string, string[]> };
  agents: { name: string; roleName: string; personalityName: string; kind: string }[];
  roles: WorkspaceTeamRole[];
  tools?: Record<string, { id: string; name?: string; description?: string }>;
  policies?: {
    requireApprovalForWrites: boolean;
    shellApprovalMode: ShellApprovalMode;
    workspaceBoundaryMode: string;
  };
} | null;

export function WorkspaceShell(props: {
  bootstrap: BootstrapResponse;
  rolePresets: RolePresetTemplate[];
  teamSettings: WorkspaceTeamSettings;
  initialConversation?: SelectedConversation;
}) {
  const { bootstrap, initialConversation } = props;
  const organizationId = bootstrap.organization?.id;
  useWorkflowApprovalsLive();
  const workflowRunDrawerId = useWorkspaceStore((s) => s.workflowRunDrawerId);
  const closeWorkflowRunDrawer = useWorkspaceStore((s) => s.closeWorkflowRunDrawer);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [teamSettings, setTeamSettings] = useState(props.teamSettings);
  const [agentEditorTargetId, setAgentEditorTargetId] = useState<string | null>(null);
  const [goalMode, setGoalMode] = useState(false);
  const [orgShellApprovalMode, setOrgShellApprovalMode] = useState(
    normalizeOrgShellApprovalMode(props.teamSettings?.policies ?? {}),
  );
  const [prevPropsTeamSettings, setPrevPropsTeamSettings] = useState(props.teamSettings);
  if (props.teamSettings !== prevPropsTeamSettings) {
    setPrevPropsTeamSettings(props.teamSettings);
    setTeamSettings(props.teamSettings);
    setOrgShellApprovalMode(normalizeOrgShellApprovalMode(props.teamSettings?.policies ?? {}));
  }
  const [searchPaletteOpen, setSearchPaletteOpen] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const sidebarWidth = useWorkspaceStore((state) => state.sidebarWidth);
  const showDetails = useWorkspaceStore((state) => state.showDetails);
  const selected = useWorkspaceStore((state) => state.selectedConversation);
  const channels = useWorkspaceStore((state) => state.channels);
  const members = useWorkspaceStore((state) => state.members);
  const memberActivity = useWorkspaceStore((state) => state.memberActivity);
  const conversationUnreadCounts = useWorkspaceStore((state) => state.conversationUnreadCounts);
  const {
    setSidebarWidth,
    setShowDetails,
    syncWorkspace,
    replaceConversationUnreadCounts,
    setSelectedConversation,
    appendChannel,
    appendMember,
    clearConversationUnreadCount,
    incrementConversationUnreadCount,
    setMemberActivity,
    upsertGlobalActiveRun,
    hydrateClientPersisted,
  } = useWorkspaceStore(
    useShallow((state) => ({
      setSidebarWidth: state.setSidebarWidth,
      setShowDetails: state.setShowDetails,
      syncWorkspace: state.syncWorkspace,
      replaceConversationUnreadCounts: state.replaceConversationUnreadCounts,
      setSelectedConversation: state.setSelectedConversation,
      appendChannel: state.appendChannel,
      appendMember: state.appendMember,
      clearConversationUnreadCount: state.clearConversationUnreadCount,
      incrementConversationUnreadCount: state.incrementConversationUnreadCount,
      setMemberActivity: state.setMemberActivity,
      upsertGlobalActiveRun: state.upsertGlobalActiveRun,
      hydrateClientPersisted: state.hydrateClientPersisted,
    }))
  );
  const seenApprovalNotifications = useRef(new Set<string>());
  const goalModeSyncing = useRef(false);
  const activeConversationRef = useRef<SelectedConversation | undefined>(undefined);
  const membersRef = useRef(members);

  useEffect(() => {
    hydrateClientPersisted();
  }, [hydrateClientPersisted]);

  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  const defaultConversation = useMemo(
    () => initialConversation ?? resolveDefaultConversation(channels),
    [channels, initialConversation],
  );

  const workspaceTasksActive = searchParams.get("view") === "tasks";
  const workspaceWorkflowsActive = searchParams.get("view") === "workflows";
  const urlConversation = useMemo(
    () => resolveSelectedConversationFromSearchParams(searchParams, bootstrap),
    [searchParams, bootstrap],
  );

  const resolvedSelected = urlConversation ?? selected ?? defaultConversation;
  const activeConversation = workspaceTasksActive || workspaceWorkflowsActive ? undefined : resolvedSelected;
  useEffect(() => {
    activeConversationRef.current = activeConversation;
  }, [activeConversation]);

  // ---------- Notion Top Tab Bar state ----------
  const [openTabs, setOpenTabs] = useState<WorkspaceTabItem[]>(() => {
    const list: WorkspaceTabItem[] = [];
    if (workspaceWorkflowsActive) {
      list.push({ id: "view:workflows", type: "workflows", title: "Workflows", targetId: "workflows" });
    }
    if (workspaceTasksActive) {
      list.push({ id: "view:tasks", type: "tasks", title: "Tasks", targetId: "tasks" });
    }
    if (resolvedSelected) {
      list.push({
        id: `${resolvedSelected.type}:${resolvedSelected.id}`,
        type: resolvedSelected.type === "channel" ? "channel" : "agent",
        title: resolvedSelected.name,
        targetId: resolvedSelected.id,
        conversation: resolvedSelected,
      });
    }
    if (list.length === 0) {
      list.push({ id: "view:tasks", type: "tasks", title: "Tasks", targetId: "tasks" });
    }
    return list;
  });

  const activeTabId = useMemo(() => {
    if (workspaceWorkflowsActive) return "view:workflows";
    if (workspaceTasksActive) return "view:tasks";
    if (activeConversation) return `${activeConversation.type}:${activeConversation.id}`;
    return openTabs[0]?.id ?? "view:tasks";
  }, [workspaceWorkflowsActive, workspaceTasksActive, activeConversation, openTabs]);

  // Native-history navigation counters for < > buttons (router.push/back/forward)
  const [navPast, setNavPast] = useState(0);
  const [navFuture, setNavFuture] = useState(0);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const recordNav = useCallback(() => {
    setNavPast((p) => p + 1);
    setNavFuture(0);
  }, []);

  // Persist the open-tab working set across reloads (per organization)
  const tabsStorageKey = `workspaceTabs:v1:${bootstrap.organization?.id ?? "none"}`;
  const tabsHydratedRef = useRef(false);
  useEffect(() => {
    let raf = 0;
    // Restore after hydration commit (pre-paint) so server HTML and first
    // client render stay identical — persisted tabs merge in right after.
    raf = requestAnimationFrame(() => {
      try {
        const raw = window.localStorage.getItem(tabsStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as WorkspaceTabItem[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            setOpenTabs((prev) => {
              const merged = [...prev];
              for (const tab of parsed) {
                if (!merged.some((t) => t.id === tab.id)) merged.push(tab);
              }
              return merged;
            });
          }
        }
      } catch {
        /* ignore malformed persisted state */
      }
      tabsHydratedRef.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [tabsStorageKey]);
  useEffect(() => {
    if (!tabsHydratedRef.current) return;
    try {
      window.localStorage.setItem(tabsStorageKey, JSON.stringify(openTabs));
    } catch {
      /* ignore quota errors */
    }
  }, [openTabs, tabsStorageKey]);

  const handleSelect = useCallback(
    (conversation: SelectedConversation) => {
      setSelectedConversation(conversation);
      setMobileSidebarOpen(false);
      const tabId = `${conversation.type}:${conversation.id}`;

      setOpenTabs((prev) => {
        if (prev.some((t) => t.id === tabId)) {
          return prev.map((t) => (t.id === tabId ? { ...t, title: conversation.name, conversation } : t));
        }
        return [
          ...prev,
          {
            id: tabId,
            type: conversation.type === "channel" ? "channel" : "agent",
            title: conversation.name,
            targetId: conversation.id,
            conversation,
          },
        ];
      });

      recordNav();

      const params = new URLSearchParams(searchParams.toString());
      params.delete("view");
      params.delete("agent");
      params.delete("agentId");
      params.delete("channel");
      params.delete("channelId");
      if (conversation.type === "channel") {
        params.set("channelId", conversation.id);
      } else {
        params.set("agentId", conversation.id);
      }
      router.push(`?${params.toString()}`, { scroll: false });
    },
    [recordNav, router, searchParams, setSelectedConversation]
  );

  const handleOpenTasks = useCallback(() => {
    const tabId = "view:tasks";
    setOpenTabs((prev) => {
      if (prev.some((t) => t.id === tabId)) return prev;
      return [...prev, { id: tabId, type: "tasks", title: "Tasks", targetId: "tasks" }];
    });

    recordNav();

    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "tasks");
    params.delete("channelId");
    params.delete("agentId");
    router.push(`?${params.toString()}`, { scroll: false });
  }, [recordNav, router, searchParams]);

  const handleOpenWorkflows = useCallback(() => {
    const tabId = "view:workflows";
    setOpenTabs((prev) => {
      if (prev.some((t) => t.id === tabId)) return prev;
      return [...prev, { id: tabId, type: "workflows", title: "Workflows", targetId: "workflows" }];
    });

    recordNav();

    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "workflows");
    params.delete("channelId");
    params.delete("agentId");
    router.push(`?${params.toString()}`, { scroll: false });
  }, [recordNav, router, searchParams]);

  const handleNavigateBack = useCallback(() => {
    if (navPast <= 0) return;
    setNavPast((p) => p - 1);
    setNavFuture((f) => f + 1);
    router.back();
  }, [navPast, router]);

  const handleNavigateForward = useCallback(() => {
    if (navFuture <= 0) return;
    setNavFuture((f) => f - 1);
    setNavPast((p) => p + 1);
    router.forward();
  }, [navFuture, router]);

  const handleSelectTabItem = useCallback(
    (tab: WorkspaceTabItem) => {
      if (tab.type === "workflows") {
        handleOpenWorkflows();
      } else if (tab.type === "tasks") {
        handleOpenTasks();
      } else if (tab.conversation) {
        handleSelect(tab.conversation);
      } else if (tab.targetId && tab.type === "channel") {
        const ch = channels.find((c) => c.id === tab.targetId);
        if (ch) handleSelect({ type: "channel", id: ch.id, name: ch.name });
      } else if (tab.targetId && tab.type === "agent") {
        const ag = members.find((m) => m.id === tab.targetId);
        if (ag) handleSelect({ type: "agent", id: ag.id, name: ag.name });
      }
    },
    [channels, handleOpenTasks, handleOpenWorkflows, handleSelect, members]
  );

  const handleCloseTabItem = useCallback(
    (tabId: string) => {
      setOpenTabs((prev) => {
        if (prev.length <= 1) return prev;
        const next = prev.filter((t) => t.id !== tabId);
        if (tabId === activeTabId && next.length > 0) {
          const fallback = next[next.length - 1];
          setTimeout(() => handleSelectTabItem(fallback), 0);
        }
        return next;
      });
    },
    [activeTabId, handleSelectTabItem]
  );

  const goalModeKey = useMemo(
    () =>
      activeConversation
        ? goalModePreferenceKey(bootstrap.organization?.id, activeConversation.id)
        : null,
    [activeConversation, bootstrap.organization?.id],
  );

  useEffect(() => {
    if (!goalModeKey) return;
    goalModeSyncing.current = true;
    queueMicrotask(() => {
      setGoalMode(readGoalModePreference(goalModeKey));
    });
  }, [goalModeKey]);

  useEffect(() => {
    if (!goalModeKey) return;
    if (goalModeSyncing.current) {
      goalModeSyncing.current = false;
      return;
    }
    writeGoalModePreference(goalModeKey, goalMode);
  }, [goalMode, goalModeKey]);

  const handleOrgShellApprovalModeChange = useCallback(
    async (shellApprovalMode: ShellApprovalMode) => {
      const previous = orgShellApprovalMode;
      setOrgShellApprovalMode(shellApprovalMode);
      if (!organizationId) return;

      await clientFetchJson<unknown>(`/api/orgs/${encodeURIComponent(organizationId)}/policies`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          shellApprovalMode,
        }),
      }, "Unable to update policies.").catch((error) => {
        setOrgShellApprovalMode(previous);
        throw error;
      });
    },
    [organizationId, orgShellApprovalMode],
  );

  const handleCreateChannel = useCallback(
    async (name: string) => {
      if (!organizationId) {
        throw new Error("Missing organization context for channel creation.");
      }
      const channel = await clientFetchJson<WorkspaceChannel>(`/api/orgs/${organizationId}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }, "Unable to create channel.");
      appendChannel(channel);
      const created = { type: "channel" as const, id: channel.id, name: channel.name };
      handleSelect(created);
      return created;
    },
    [appendChannel, handleSelect, organizationId],
  );

  const refreshTeamSettings = useCallback(async () => {
    if (!organizationId) return;
    const settings = await clientFetchJson<WorkspaceTeamSettings>(
      `/api/settings/team?organizationId=${encodeURIComponent(organizationId)}`,
    ).catch(() => null);
    if (settings) setTeamSettings(settings);
  }, [organizationId]);

  const handleCreateAgent = useCallback(
    async (input: {
      name: string;
      roleName: string;
      channelIds: string[];
      llm: string;
      model: string;
      role: WorkspaceRoleInput;
    }) => {
      if (!organizationId) {
        throw new Error("Missing organization context for agent creation.");
      }
      const member = await clientFetchJson<WorkspaceMember>(`/api/orgs/${organizationId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          kind: "agent",
        }),
      }, "Unable to create agent.");
      appendMember(member);
      await refreshTeamSettings();
      return { type: "agent" as const, id: member.id, name: member.name };
    },
    [appendMember, organizationId, refreshTeamSettings],
  );

  const handleUpdateAgent = useCallback(
    async (input: {
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
    }) => {
      if (!organizationId) {
        throw new Error("Missing organization context for agent updates.");
      }
      const member = await clientFetchJson<WorkspaceMember>(
        `/api/orgs/${organizationId}/members/${input.memberId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: input.name,
            roleName: input.roleName,
            personalityName: input.personalityName,
            channelIds: input.channelIds,
            llm: input.llm,
            model: input.model,
            role: input.role,
          }),
        },
        "Unable to update agent.",
      );
      appendMember(member);
      await refreshTeamSettings();
      return member;
    },
    [appendMember, organizationId, refreshTeamSettings],
  );

  useLayoutEffect(() => {
    const conversationName = workspaceWorkflowsActive
      ? "Workflows"
      : workspaceTasksActive
      ? "Tasks"
      : activeConversation?.name?.trim();
    document.title = conversationName
      ? `Ujima Agents - ${conversationName}`
      : "Ujima Agents";
  }, [activeConversation?.id, activeConversation?.name, activeConversation?.type, workspaceTasksActive, workspaceWorkflowsActive]);

  const applyBootstrap = useCallback(
    (snapshot: BootstrapResponse) => {
      membersRef.current = snapshot.members;
      syncWorkspace({
        channels: snapshot.channels,
        members: snapshot.members,
        conversationUnreadCounts: snapshot.conversationUnreadCounts,
        selectedConversation: activeConversationRef.current,
        globalActiveRuns: snapshot.activeRuns,
      });
      replaceConversationUnreadCounts(snapshot.conversationUnreadCounts ?? {});
      for (const run of snapshot.activeRuns) {
        const member = snapshot.members.find((entry) => entry.id === run.agentId);
        const activity = runStatusToActivityState(run.status, member?.presence);
        if (activity) setMemberActivity(run.agentId, activity);
      }
    },
    [replaceConversationUnreadCounts, setMemberActivity, syncWorkspace],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchPaletteOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    applyBootstrap(bootstrap);
  }, [applyBootstrap, bootstrap]);

  useEffect(() => {
    const currentMemberId = bootstrap.auth.member?.id;
    if (!organizationId || !currentMemberId) return;

    let source: EventSource | undefined;
    let reconnectTimer: number | undefined;
    let disposed = false;
    let seenReady = false;

    const connect = () => {
      if (disposed) return;
      source = new EventSource(
        clientApiUrl(`/api/notifications/stream?organizationId=${encodeURIComponent(organizationId)}`),
      );
      source.onopen = () => {
        console.info("[notifications] stream connected");
        setNotificationError(null);
      };
      source.onerror = () => {
        if (source?.readyState !== EventSource.CLOSED) return;
        const message = "Live notifications disconnected. Retrying…";
        console.warn("[notifications]", message);
        setNotificationError(message);
        source?.close();
        if (reconnectTimer === undefined) {
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = undefined;
            connect();
          }, 3_000);
        }
      };
      source.onmessage = (event) => {
        const envelope = parseNotificationEnvelope(event.data);
        if (!envelope) return;
        if (envelope.type === "ready") {
          if (seenReady) {
            void (async () => {
              const body = await clientFetchJson<unknown>("/api/bootstrap").catch(() => null);
              const parsed = BootstrapResponseSchema.safeParse(body);
              if (parsed?.success) {
                applyBootstrap(parsed.data);
              }
            })();
          } else {
            seenReady = true;
          }
          return;
        }
        if (envelope.type === "error") {
          console.warn("[notifications] server stream error", envelope.message);
          setNotificationError(envelope.message || "Live notifications are unavailable.");
          return;
        }
        publishWorkspaceLiveEvent(envelope.event, envelope.payload);
        if (
          envelope.event !== SocketEventNames.approvalRequested &&
          !isNotificationMessageEvent(envelope.event) &&
          !isNotificationRunEvent(envelope.event)
        ) {
          return;
        }

        if (isNotificationRunEvent(envelope.event)) {
          updateRunActivity(envelope.payload, membersRef.current, setMemberActivity);
          const run = (envelope.payload as { run?: RunState })?.run;
          if (run) {
            upsertGlobalActiveRun(run);
          }
        }

        const conversationId = resolveNotificationConversationId(
          envelope.event,
          envelope.payload,
          currentMemberId,
          bootstrap.channels,
        );
        if (!conversationId) return;

        const currentConversation = activeConversationRef.current;
        if (
          currentConversation &&
          ((currentConversation.type === "channel" &&
            envelope.event !== SocketEventNames.dmMessage &&
            currentConversation.id === conversationId) ||
            (currentConversation.type === "agent" && currentConversation.id === conversationId))
        ) {
          if (isNotificationMessageEvent(envelope.event)) {
            clearConversationUnreadCount(currentConversation.id);
            void markConversationRead(
              organizationId,
              getConversationThreadId(currentConversation, currentMemberId),
            );
          }
          return;
        }

        incrementConversationUnreadCount(conversationId);

        if (envelope.event === SocketEventNames.approvalRequested) {
          const approvalId = parseApprovalId(envelope.payload);
          if (approvalId && !seenApprovalNotifications.current.has(approvalId)) {
            seenApprovalNotifications.current.add(approvalId);
            playApprovalSound();
          }
        }
      };
    };
    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [
    bootstrap.auth.member?.id,
    bootstrap.channels,
    bootstrap.organization?.id,
    applyBootstrap,
    clearConversationUnreadCount,
    incrementConversationUnreadCount,
    organizationId,
    setMemberActivity,
    upsertGlobalActiveRun,
  ]);

  useEffect(() => {
    if (!organizationId || !bootstrap.auth.member || !activeConversation) return;
    clearConversationUnreadCount(activeConversation.id);
    void markConversationRead(
      organizationId,
      getConversationThreadId(activeConversation, bootstrap.auth.member.id),
    );
  }, [activeConversation, bootstrap.auth.member, clearConversationUnreadCount, organizationId]);

  const searchResults = useMemo(() => {
    const results: SearchResult[] = [];
    for (const ch of channels) {
      results.push({
        id: `channel:${ch.id}`,
        type: "channel",
        label: ch.name,
        subtitle: `${ch.memberIds?.length ?? 0} members`,
        onSelect: () => handleSelect({ type: "channel", id: ch.id, name: ch.name }),
      });
    }
    for (const m of members) {
      if (m.kind === "agent") {
        results.push({
          id: `agent:${m.id}`,
          type: "agent",
          label: m.name,
          subtitle: m.roleName ?? "Agent",
          onSelect: () => handleSelect({ type: "agent", id: m.id, name: m.name }),
        });
      }
    }
    return results;
  }, [channels, members, handleSelect]);

  return (
    <div className="relative flex h-full min-h-0">
      <div
        className={`shrink-0 flex-col overflow-hidden border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 ${
          mobileSidebarOpen
            ? "absolute inset-y-0 left-0 z-40 flex w-[85vw] max-w-xs shadow-2xl"
            : "hidden"
        } md:relative md:z-auto md:flex md:h-full md:max-w-none md:shadow-none md:w-[var(--sidebar-w)]`}
        style={{ "--sidebar-w": `${sidebarWidth}%` } as React.CSSProperties}
      >
        <WorkspaceSidebar
          bootstrap={bootstrap}
          rolePresets={props.rolePresets}
          teamSettings={teamSettings}
          goalMode={goalMode}
          channels={channels}
          members={members}
          memberActivity={memberActivity}
          selected={activeConversation}
          tasksActive={workspaceTasksActive}
          workflowsActive={workspaceWorkflowsActive}
          agentEditorTargetId={agentEditorTargetId}
          conversationUnreadCounts={conversationUnreadCounts}
          onSelect={handleSelect}
          onOpenTasks={handleOpenTasks}
          onOpenWorkflows={handleOpenWorkflows}
          onCreateChannel={handleCreateChannel}
          onCreateAgent={handleCreateAgent}
          onUpdateAgent={handleUpdateAgent}
          onAgentEditorHandled={() => setAgentEditorTargetId(null)}
        />
      </div>
      {mobileSidebarOpen ? (
        <div
          className="absolute inset-0 z-30 bg-zinc-950/40 backdrop-blur-sm md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      ) : null}
      <DragHandle onResize={setSidebarWidth} />
      <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-[#09090b]">
        {/* Notion/Ramp HQ Top Workspace Tab Bar */}
        <WorkspaceTabBar
          openTabs={openTabs}
          activeTabId={activeTabId}
          onSelectTab={handleSelectTabItem}
          onCloseTab={handleCloseTabItem}
          onNewTab={() => setSearchPaletteOpen(true)}
          onNavigateBack={handleNavigateBack}
          onNavigateForward={handleNavigateForward}
          canNavigateBack={navPast > 0}
          canNavigateForward={navFuture > 0}
          showDetails={showDetails}
          onToggleDetails={
            activeConversation
              ? () => setShowDetails(!showDetails, { userIntent: true })
              : undefined
          }
          onToggleSidebar={() => setMobileSidebarOpen(true)}
        />

        {notificationError ? (
          <div
            className="absolute left-1/2 top-14 z-30 -translate-x-1/2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 shadow dark:bg-amber-950 dark:text-amber-100"
            role="status"
          >
            {notificationError}
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden relative">
          {workspaceWorkflowsActive ? (
            <div className="h-full overflow-y-auto bg-white dark:bg-zinc-950">
              <div className="mx-auto max-w-5xl p-6">
                <WorkflowsList />
              </div>
            </div>
          ) : workspaceTasksActive ? (
            <WorkspaceTasksView key="workspace-goals" members={members} selfMemberId={bootstrap.auth.member?.id} />
          ) : activeConversation ? (
            <ChannelView
              key={`${activeConversation.type}:${activeConversation.id}`}
              bootstrap={bootstrap}
              conversation={activeConversation}
              members={members}
              orgShellApprovalMode={orgShellApprovalMode}
              goalMode={goalMode}
              onGoalModeChange={setGoalMode}
              onSelectConversation={handleSelect}
              onMemberUpdated={appendMember}
              onOrgShellApprovalModeChange={handleOrgShellApprovalModeChange}
              onOpenAgentEditor={() => {
                if (activeConversation.type === "agent") {
                  setAgentEditorTargetId(activeConversation.id);
                }
              }}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <MessageSquare className="h-7 w-7 text-zinc-400" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-zinc-900 dark:text-white">
                No conversation selected
              </h3>
              <p className="mt-1 max-w-sm text-xs text-zinc-500">
                Select a channel or agent from the sidebar to get started.
              </p>
            </div>
          )}
        </div>
      </main>
      <CommandPalette
        results={searchResults}
        open={searchPaletteOpen}
        onOpenChange={setSearchPaletteOpen}
      />
      {organizationId ? <GlobalApprovalIndicator organizationId={organizationId} /> : null}
      {organizationId ? <WorkflowRunsIndicator /> : null}
      <WorkflowRunDrawer
        runId={workflowRunDrawerId}
        onClose={closeWorkflowRunDrawer}
      />
    </div>
  );
}

export function DragHandle({
  side,
  onResize,
}: {
  side?: "left" | "right";
  onResize: (pct: number) => void;
}) {
  const dragging = useRef(false);
  const onMoveRef = useRef<((e: PointerEvent) => void) | null>(null);
  const onUpRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (onMoveRef.current) window.removeEventListener("pointermove", onMoveRef.current);
      if (onUpRef.current) {
        window.removeEventListener("pointerup", onUpRef.current);
        window.removeEventListener("pointercancel", onUpRef.current);
      }
    };
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      dragging.current = true;
      const handle = event.currentTarget as HTMLDivElement;
      const sidebar = handle.parentElement;
      const container = sidebar?.parentElement;
      if (!sidebar || !container) return;
      const pointerId = event.pointerId;
      handle.setPointerCapture(pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (e: PointerEvent) => {
        if (!dragging.current) return;
        const { left, right, width } = container.getBoundingClientRect();
        const rawPct =
          side === "right"
            ? ((right - e.clientX) / width) * 100
            : ((e.clientX - left) / width) * 100;
        const minPct = side === "right" ? 33 : 15;
        const pct = Math.max(minPct, Math.min(side === "right" ? 46 : 40, rawPct));
        onResize(pct);
      };

      const onUp = () => {
        dragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        if (handle.hasPointerCapture(pointerId)) {
          handle.releasePointerCapture(pointerId);
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        onMoveRef.current = null;
        onUpRef.current = null;
      };

      onMoveRef.current = onMove;
      onUpRef.current = onUp;

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [onResize, side],
  );

  return (
    <div
      className="relative hidden w-1 shrink-0 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-violet-500/20 group md:block"
      data-side={side}
      onPointerDown={onPointerDown}
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
      <GripVertical className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-5 w-5 text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity dark:text-zinc-600" />
    </div>
  );
}

function parseNotificationEnvelope(value: string): ConversationStreamEnvelope | null {
  try {
    const parsed = JSON.parse(value) as ConversationStreamEnvelope;
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

type ConversationStreamEnvelope =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "socket"; event: SocketEventName; payload: unknown };

function isNotificationMessageEvent(event: SocketEventName): boolean {
  return (
    event === SocketEventNames.channelMessage ||
    event === SocketEventNames.threadMessage ||
    event === SocketEventNames.dmMessage
  );
}

function isNotificationRunEvent(event: SocketEventName): boolean {
  return (
    event === SocketEventNames.runStarted ||
    event === SocketEventNames.runUpdated ||
    event === SocketEventNames.runCompleted
  );
}

function getConversationThreadId(conversation: SelectedConversation, currentMemberId: string): string {
  return conversation.type === "agent"
    ? getDirectMessageThreadId(currentMemberId, conversation.id)
    : conversation.id;
}

async function markConversationRead(organizationId: string, threadId: string): Promise<void> {
  await clientFetchVoid(
    `/api/conversations/${encodeURIComponent(threadId)}/read?organizationId=${encodeURIComponent(organizationId)}`,
    { method: "POST" },
  ).catch(() => undefined);
}

function updateRunActivity(
  payload: unknown,
  members: WorkspaceMember[],
  setMemberActivity: (memberId: string, activity: "working" | "error" | "idle" | "online" | "offline" | "loading") => void,
): void {
  const run = (payload as { run?: Pick<RunState, "agentId" | "status"> })?.run;
  if (!run?.agentId) return;
  const member = members.find((entry) => entry.id === run.agentId);
  const activity = runStatusToActivityState(run.status, member?.presence);
  if (activity) {
    setMemberActivity(run.agentId, activity);
  }
}

function resolveNotificationConversationId(
  event: SocketEventName,
  payload: unknown,
  currentMemberId: string,
  channels: BootstrapResponse["channels"],
): string | undefined {
  if (event === SocketEventNames.channelMessage) {
    const body = payload as { channelId?: string };
    return typeof body.channelId === "string" && channels.some((channel) => channel.id === body.channelId)
      ? body.channelId
      : undefined;
  }

  if (event === SocketEventNames.threadMessage) {
    const body = payload as {
      threadId?: string;
      message?: { threadId?: string; channelId?: string };
    };
    const threadId = body.threadId ?? body.message?.threadId;
    if (typeof threadId !== "string") return undefined;
    if (isDirectMessageThread(threadId)) {
      return resolveDmConversationId(threadId, currentMemberId);
    }
    const messageChannelId = body.message?.channelId;
    if (
      typeof messageChannelId === "string" &&
      channels.some((channel) => channel.id === messageChannelId)
    ) {
      return messageChannelId;
    }
    return channels.some((channel) => channel.id === threadId) ? threadId : undefined;
  }

  if (event === SocketEventNames.dmMessage) {
    const body = payload as { message?: { threadId?: string } };
    const threadId = body.message?.threadId;
    return typeof threadId === "string" ? resolveDmConversationId(threadId, currentMemberId) : undefined;
  }

  const body = payload as { threadId?: string; run?: { threadId?: string } };
  const threadId = body.threadId ?? body.run?.threadId;
  if (typeof threadId !== "string") return undefined;
  if (isDirectMessageThread(threadId)) {
    return resolveDmConversationId(threadId, currentMemberId);
  }
  return channels.some((channel) => channel.id === threadId) ? threadId : undefined;
}

function parseApprovalId(payload: unknown): string | undefined {
  const body = payload as { approval?: { id?: string } };
  return typeof body.approval?.id === "string" ? body.approval.id : undefined;
}

function resolveDmConversationId(threadId: string, currentMemberId: string): string | undefined {
  return resolveDmPeerMemberId(threadId, currentMemberId);
}

function playApprovalSound(): void {
  if (typeof window === "undefined") return;
  const AudioContextCtor =
    typeof window !== "undefined"
      ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!AudioContextCtor) return;
  try {
    const context = new AudioContextCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.0001;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
    oscillator.stop(context.currentTime + 0.2);
    void context.close().catch(() => undefined);
  } catch {
    // Ignore
  }
}
