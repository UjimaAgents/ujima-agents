"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getDirectMessageThreadId,
  SocketEventNames,
  type RunState,
  type SocketEventName,
} from "@ujima/shared/browser";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { ChannelView } from "./channel-view";
import type { BootstrapResponse } from "@ujima/api-schema";
import { resolveSelectedConversationFromSearchParams } from "../conversation-routing";
import type { SelectedConversation, WorkspaceRoleInput } from "../types";
import { useWorkspaceStore } from "../workspace-store";
import type { RolePresetTemplate } from "../../onboarding/types";
import {
  goalModePreferenceKey,
  readGoalModePreference,
  writeGoalModePreference,
} from "../goal-mode";

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
} | null;

export function WorkspaceShell(props: {
  bootstrap: BootstrapResponse;
  rolePresets: RolePresetTemplate[];
  teamSettings: WorkspaceTeamSettings;
  initialConversation?: SelectedConversation;
}) {
  const { bootstrap, initialConversation } = props;
  const organizationId = bootstrap.organization?.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [agentEditorTargetId, setAgentEditorTargetId] = useState<string | null>(null);
  const [goalMode, setGoalMode] = useState(false);
  const sidebarWidth = useWorkspaceStore((state) => state.sidebarWidth);
  const selected = useWorkspaceStore((state) => state.selectedConversation);
  const channels = useWorkspaceStore((state) => state.channels);
  const members = useWorkspaceStore((state) => state.members);
  const memberActivity = useWorkspaceStore((state) => state.memberActivity);
  const conversationUnreadCounts = useWorkspaceStore((state) => state.conversationUnreadCounts);
  const setSidebarWidth = useWorkspaceStore((state) => state.setSidebarWidth);
  const syncWorkspace = useWorkspaceStore((state) => state.syncWorkspace);
  const setSelectedConversation = useWorkspaceStore((state) => state.setSelectedConversation);
  const appendChannel = useWorkspaceStore((state) => state.appendChannel);
  const appendMember = useWorkspaceStore((state) => state.appendMember);
  const clearConversationUnreadCount = useWorkspaceStore((state) => state.clearConversationUnreadCount);
  const incrementConversationUnreadCount = useWorkspaceStore((state) => state.incrementConversationUnreadCount);
  const setMemberActivity = useWorkspaceStore((state) => state.setMemberActivity);
  const seenApprovalNotifications = useRef(new Set<string>());
  const goalModeSyncing = useRef(false);

  const defaultConversation = useMemo(() => {
    if (initialConversation) return initialConversation;
    const generalChannel =
      channels.find((c) => c.name === "general") ?? channels[0];
    return {
      type: "channel" as const,
      id: generalChannel?.id ?? "general",
      name: generalChannel?.name ?? "general",
    };
  }, [channels, initialConversation]);

  const urlConversation = useMemo(
    () => resolveSelectedConversationFromSearchParams(searchParams, bootstrap),
    [searchParams, bootstrap],
  );

  const resolvedSelected = urlConversation ?? selected ?? defaultConversation;
  const goalModeKey = useMemo(
    () => goalModePreferenceKey(bootstrap.organization?.id, resolvedSelected.id),
    [bootstrap.organization?.id, resolvedSelected.id],
  );

  useEffect(() => {
    goalModeSyncing.current = true;
    queueMicrotask(() => {
      setGoalMode(readGoalModePreference(goalModeKey));
    });
  }, [goalModeKey]);

  useEffect(() => {
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
      if (conversation.type === "channel") {
        params.set("channelId", conversation.id);
        params.delete("agentId");
      } else {
        params.set("agentId", conversation.id);
        params.delete("channelId");
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams, setSelectedConversation],
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
      return { type: "agent" as const, id: member.id, name: member.name };
    },
    [appendMember, organizationId],
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
      return member;
    },
    [appendMember, organizationId],
  );

  useEffect(() => {
    if (!bootstrap.channels) return;
    syncWorkspace({
      channels: bootstrap.channels,
      members: bootstrap.members,
      conversationUnreadCounts: bootstrap.conversationUnreadCounts,
      selectedConversation: resolvedSelected,
    });
    for (const run of bootstrap.activeRuns) {
      if (isLiveRunStatus(run.status)) {
        setMemberActivity(run.agentId, "working");
      }
    }
  }, [
    bootstrap.activeRuns,
    bootstrap.channels,
    bootstrap.conversationUnreadCounts,
    bootstrap.members,
    resolvedSelected,
    setMemberActivity,
    syncWorkspace,
  ]);

  useEffect(() => {
    const currentMemberId = bootstrap.auth.member?.id;
    if (!organizationId || !currentMemberId) return;

    const source = new EventSource(
      `/api/notifications/stream?organizationId=${encodeURIComponent(organizationId)}`,
    );

    source.onmessage = (event) => {
      const envelope = parseNotificationEnvelope(event.data);
      if (!envelope || envelope.type === "ready" || envelope.type === "error") return;
      if (
        envelope.event !== SocketEventNames.approvalRequested &&
        !isNotificationMessageEvent(envelope.event) &&
        !isNotificationRunEvent(envelope.event)
      ) {
        return;
      }

      if (isNotificationRunEvent(envelope.event)) {
        updateRunActivity(envelope.payload, setMemberActivity);
      }

      const conversationId = resolveNotificationConversationId(
        envelope.event,
        envelope.payload,
        currentMemberId,
        bootstrap.channels,
      );
      if (!conversationId) return;

      if (
        (resolvedSelected.type === "channel" &&
          envelope.event !== SocketEventNames.dmMessage &&
          resolvedSelected.id === conversationId) ||
        (resolvedSelected.type === "agent" && resolvedSelected.id === conversationId)
      ) {
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
    incrementConversationUnreadCount,
    organizationId,
    resolvedSelected,
    setMemberActivity,
  ]);

  useEffect(() => {
    if (!organizationId || !bootstrap.auth.member || !resolvedSelected) return;
    const threadId =
      resolvedSelected.type === "agent"
        ? getDirectMessageThreadId(bootstrap.auth.member.id, resolvedSelected.id)
        : resolvedSelected.id;
    clearConversationUnreadCount(resolvedSelected.id);
    void fetch(
      `/api/conversations/${encodeURIComponent(threadId)}/read?organizationId=${encodeURIComponent(organizationId)}`,
      { method: "POST" },
    ).catch(() => undefined);
  }, [bootstrap.auth.member, clearConversationUnreadCount, organizationId, resolvedSelected]);

  return (
    <div className="flex h-full min-h-0">
      <div
        className="flex h-full shrink-0 flex-col overflow-hidden border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
        style={{ width: `${sidebarWidth}%` }}
      >
        <WorkspaceSidebar
          bootstrap={bootstrap}
          rolePresets={props.rolePresets}
          teamSettings={props.teamSettings}
          currentWorkspaceRoot={
            props.teamSettings?.workspace?.root ?? bootstrap.team?.workspaceRoot
          }
          goalMode={goalMode}
          channels={channels}
          members={members}
          memberActivity={memberActivity}
          selected={resolvedSelected}
          agentEditorTargetId={agentEditorTargetId}
          conversationUnreadCounts={conversationUnreadCounts}
          onSelect={handleSelect}
          onCreateChannel={handleCreateChannel}
          onCreateAgent={handleCreateAgent}
          onUpdateAgent={handleUpdateAgent}
          onAgentEditorHandled={() => setAgentEditorTargetId(null)}
        />
      </div>
      <DragHandle onResize={setSidebarWidth} />
      <main className="flex h-full min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <ChannelView
            key={`${resolvedSelected.type}:${resolvedSelected.id}`}
            bootstrap={bootstrap}
            conversation={resolvedSelected}
            members={members}
            goalMode={goalMode}
            onGoalModeChange={setGoalMode}
            onOpenAgentEditor={() => {
              if (resolvedSelected.type === "agent") {
                setAgentEditorTargetId(resolvedSelected.id);
              }
            }}
          />
        </div>
      </main>
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
        const pct = Math.max(minPct, Math.min(50, rawPct));
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
      };

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

function updateRunActivity(
  payload: unknown,
  setMemberActivity: (memberId: string, activity: "working" | "error" | "idle" | "online" | "offline" | "loading") => void,
): void {
  const run = (payload as { run?: Pick<RunState, "agentId" | "status"> })?.run;
  if (!run?.agentId) return;
  if (isLiveRunStatus(run.status)) {
    setMemberActivity(run.agentId, "working");
  } else if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    setMemberActivity(run.agentId, "idle");
  }
}

function isLiveRunStatus(status: RunState["status"] | undefined): boolean {
  return status === "queued" || status === "running" || status === "waiting_for_approval";
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
    if (threadId.startsWith("dm:")) {
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
  if (threadId.startsWith("dm:")) {
    return resolveDmConversationId(threadId, currentMemberId);
  }
  return channels.some((channel) => channel.id === threadId) ? threadId : undefined;
}

function parseApprovalId(payload: unknown): string | undefined {
  const body = payload as { approval?: { id?: string } };
  return typeof body.approval?.id === "string" ? body.approval.id : undefined;
}

function resolveDmConversationId(threadId: string, currentMemberId: string): string | undefined {
  if (!threadId.startsWith("dm:")) return undefined;
  const [, firstId, secondId] = threadId.split(":", 3);
  if (firstId === currentMemberId) return secondId;
  if (secondId === currentMemberId) return firstId;
  return undefined;
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
