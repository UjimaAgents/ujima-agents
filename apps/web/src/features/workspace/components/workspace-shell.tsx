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
import { GlobalApprovalIndicator } from "./global-approval-indicator";
import { WorkflowRunsIndicator } from "@/features/workflows/workflow-runs-indicator";
import { useWorkflowApprovalsPoll } from "../use-workflow-approvals";
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
  // Feed pending workflow gates into the shared approval queue + pending pill.
  useWorkflowApprovalsPoll();
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
  const sidebarWidth = useWorkspaceStore((state) => state.sidebarWidth);
  const selected = useWorkspaceStore((state) => state.selectedConversation);
  const channels = useWorkspaceStore((state) => state.channels);
  const members = useWorkspaceStore((state) => state.members);
  const memberActivity = useWorkspaceStore((state) => state.memberActivity);
  const conversationUnreadCounts = useWorkspaceStore((state) => state.conversationUnreadCounts);
  const {
    setSidebarWidth,
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

  // Pull localStorage-backed prefs (chat font size, details auto-open dismissal)
  // into the store after mount so the first render matches the SSR snapshot.
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
  const urlConversation = useMemo(
    () => resolveSelectedConversationFromSearchParams(searchParams, bootstrap),
    [searchParams, bootstrap],
  );

  const resolvedSelected = urlConversation ?? selected ?? defaultConversation;
  const activeConversation = workspaceTasksActive ? undefined : resolvedSelected;
  useEffect(() => {
    activeConversationRef.current = activeConversation;
  }, [activeConversation]);
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

  const handleSelect = useCallback(
    (conversation: SelectedConversation) => {
      setSelectedConversation(conversation);
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
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams, setSelectedConversation],
  );
  const handleOpenTasks = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "tasks");
    params.delete("channelId");
    params.delete("agentId");
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const handleOrgShellApprovalModeChange = useCallback(
    async (shellApprovalMode: ShellApprovalMode) => {
      const previous = orgShellApprovalMode;
      setOrgShellApprovalMode(shellApprovalMode);
      if (!organizationId) return;

      const response = await fetch(`/api/orgs/${encodeURIComponent(organizationId)}/policies`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          shellApprovalMode,
        }),
      });
      if (!response.ok) {
        setOrgShellApprovalMode(previous);
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "Unable to update policies.");
      }
    },
    [organizationId, orgShellApprovalMode],
  );

  const handleCreateChannel = useCallback(
    async (name: string) => {
      if (!organizationId) {
        throw new Error("Missing organization context for channel creation.");
      }
      const response = await fetch(`/api/orgs/${organizationId}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.message ?? "Unable to create channel.");
      }
      const channel = (await response.json()) as WorkspaceChannel;
      appendChannel(channel);
      const created = { type: "channel" as const, id: channel.id, name: channel.name };
      handleSelect(created);
      return created;
    },
    [appendChannel, handleSelect, organizationId],
  );

  const refreshTeamSettings = useCallback(async () => {
    if (!organizationId) return;
    const response = await fetch(
      `/api/settings/team?organizationId=${encodeURIComponent(organizationId)}`,
    ).catch(() => null);
    if (response?.ok) {
      setTeamSettings((await response.json()) as WorkspaceTeamSettings);
    }
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
      const response = await fetch(`/api/orgs/${organizationId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          kind: "agent",
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.message ?? "Unable to create agent.");
      }
      const member = (await response.json()) as WorkspaceMember;
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
      const response = await fetch(
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
      );
      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.message ?? "Unable to update agent.");
      }
      const member = (await response.json()) as WorkspaceMember;
      appendMember(member);
      await refreshTeamSettings();
      return member;
    },
    [appendMember, organizationId, refreshTeamSettings],
  );

  useLayoutEffect(() => {
    const conversationName = workspaceTasksActive
      ? "Tasks"
      : activeConversation?.name?.trim();
    document.title = conversationName
      ? `Ujima Agents - ${conversationName}`
      : "Ujima Agents";
  }, [activeConversation?.id, activeConversation?.name, activeConversation?.type, workspaceTasksActive]);

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

  // Cmd+K to open global search
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

    const source = new EventSource(
      `/api/notifications/stream?organizationId=${encodeURIComponent(organizationId)}`,
    );
    let seenReady = false;

    source.onopen = () => {
      console.info("[notifications] stream connected");
    };
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        console.warn("[notifications] stream disconnected permanently — unread counts may be stale");
      }
    };
    source.onmessage = (event) => {
      const envelope = parseNotificationEnvelope(event.data);
      if (!envelope) return;
      if (envelope.type === "ready") {
        if (seenReady) {
          void (async () => {
            const response = await fetch("/api/bootstrap");
            const body = await response.json().catch(() => null);
            const parsed = response.ok ? BootstrapResponseSchema.safeParse(body) : null;
            if (parsed?.success) {
              applyBootstrap(parsed.data);
            }
          })();
        } else {
          seenReady = true;
        }
        return;
      }
      if (envelope.type === "error") return;
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

      // Read from ref to avoid re-creating the EventSource when the user switches conversations.
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

    return () => {
      source.close();
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
    <div className="flex h-full min-h-0">
      <div
        className="flex h-full shrink-0 flex-col overflow-hidden border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
        style={{ width: `${sidebarWidth}%` }}
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
          agentEditorTargetId={agentEditorTargetId}
          conversationUnreadCounts={conversationUnreadCounts}
          onSelect={handleSelect}
          onOpenTasks={handleOpenTasks}
          onCreateChannel={handleCreateChannel}
          onCreateAgent={handleCreateAgent}
          onUpdateAgent={handleUpdateAgent}
          onAgentEditorHandled={() => setAgentEditorTargetId(null)}
        />
      </div>
      <DragHandle onResize={setSidebarWidth} />
      <main className="flex h-full min-w-0 flex-1 overflow-hidden bg-white dark:bg-[#09090b]">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {workspaceTasksActive ? (
            <ChannelGoalsBoard key="workspace-goals" members={members} />
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
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
                <MessageSquare className="h-7 w-7 text-zinc-400" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-zinc-900 dark:text-white">
                No conversation selected
              </h3>
              <p className="mt-1 max-w-sm text-xs text-zinc-500">
                Add a channel or agent from the sidebar to open a conversation.
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
      className="relative w-1 shrink-0 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-violet-500/20 group"
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
  await fetch(
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
    window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
    // Ignore browsers that block autoplay or AudioContext.
  }
}
