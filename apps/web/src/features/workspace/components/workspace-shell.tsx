"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { getDirectMessageThreadId, SocketEventNames, type SocketEventName } from "@ujima/shared";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { ChannelView } from "./channel-view";
import type { BootstrapResponse } from "@ujima/api-schema";
import type { SelectedConversation, WorkspaceRoleInput } from "../types";
import { resolveSelectedConversationFromSearchParams } from "../conversation-routing";
import { sameConversation, useWorkspaceStore } from "../workspace-store";

import type { RolePresetTemplate } from "../../onboarding/types";

/** Shared motion for dashboard layout (sidebar width, details column, resizers). */
export const WORKSPACE_PANEL_WIDTH_TRANSITION =
  "transition-[width] duration-300 ease-out motion-reduce:transition-none motion-reduce:duration-0";

export const WORKSPACE_MAIN_GRID_TRANSITION =
  "transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none motion-reduce:duration-0";

type WorkspaceChannel = BootstrapResponse["channels"][number];
type WorkspaceMember = BootstrapResponse["members"][number];
type WorkspaceTeamRole = {
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
};
type WorkspaceTeamSettings = {
  workspace?: { root: string; roleScopes?: Record<string, string[]> };
  agents: Array<{ name: string; roleName: string; personalityName: string; kind: string }>;
  roles: WorkspaceTeamRole[];
} | null;

function normalizeWorkspaceTeamRole(role: WorkspaceRoleInput): WorkspaceTeamRole {
  return {
    id: role.id ?? role.name,
    name: role.name,
    title: role.title,
    description: role.description ?? "",
    instructions: role.instructions,
    kind: role.kind ?? "agent",
    provider: role.provider,
    model: role.model,
    workspaceScopes: role.workspaceScopes ?? [],
    tools: role.tools ?? [],
    channels: role.channels ?? [],
    skills: role.skills ?? [],
  };
}

export function WorkspaceShell({
  bootstrap,
  rolePresets,
  teamSettings,
  initialConversation,
}: {
  bootstrap: BootstrapResponse;
  rolePresets: RolePresetTemplate[];
  teamSettings: WorkspaceTeamSettings;
  initialConversation?: SelectedConversation;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [teamSettingsState, setTeamSettingsState] = useState(teamSettings);
  const [agentEditorTargetId, setAgentEditorTargetId] = useState<string | null>(null);
  const seenApprovalNotifications = useRef(new Set<string>());
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

  useEffect(() => {
    syncWorkspace({
      channels: bootstrap.channels,
      members: bootstrap.members,
      conversationUnreadCounts: bootstrap.conversationUnreadCounts,
      selectedConversation: initialConversation ?? defaultConversation,
    });
  }, [bootstrap.channels, bootstrap.conversationUnreadCounts, bootstrap.members, defaultConversation, initialConversation, syncWorkspace]);

  const urlConversation = useMemo(
    () =>
      resolveSelectedConversationFromSearchParams(searchParams, {
        ...bootstrap,
        members,
        channels,
      }) ?? defaultConversation,
    [bootstrap, channels, defaultConversation, members, searchParams],
  );
  const resolvedSelected = selected ?? urlConversation;

  useEffect(() => {
    const sameIdentity = sameConversation(selected, urlConversation);
    const nameChanged =
      sameIdentity &&
      !!selected &&
      !!urlConversation &&
      selected.name !== urlConversation.name;
    if (!sameIdentity || nameChanged) {
      setSelectedConversation(urlConversation);
    }
  }, [selected, setSelectedConversation, urlConversation]);

  useEffect(() => {
    if (!bootstrap.organization?.id || !bootstrap.auth.member || !resolvedSelected) return;
    const threadId =
      resolvedSelected.type === "agent"
        ? getDirectMessageThreadId(bootstrap.auth.member.id, resolvedSelected.id)
        : resolvedSelected.id;
    clearConversationUnreadCount(resolvedSelected.id);
    void fetch(
      `/api/conversations/${encodeURIComponent(threadId)}/read?organizationId=${encodeURIComponent(bootstrap.organization.id)}`,
      { method: "POST" },
    ).catch(() => undefined);
  }, [bootstrap.auth.member, bootstrap.organization?.id, clearConversationUnreadCount, resolvedSelected]);

  useEffect(() => {
    const currentMemberId = bootstrap.auth.member?.id;
    if (!bootstrap.organization?.id || !currentMemberId) return;

    const source = new EventSource(
      `/api/notifications/stream?organizationId=${encodeURIComponent(bootstrap.organization.id)}`,
    );

    source.onmessage = (event) => {
      const parsed = parseNotificationEnvelope(event.data);
      if (!parsed) return;
      if (parsed.type === "ready" || parsed.type === "error") return;
      if (
        parsed.event !== SocketEventNames.approvalRequested &&
        !isNotificationMessageEvent(parsed.event) &&
        !isNotificationRunEvent(parsed.event)
      ) return;

      if (isNotificationRunEvent(parsed.event)) {
        updateRunActivity(parsed.payload, setMemberActivity);
      }

      const conversationId = resolveNotificationConversationId(
        parsed.event,
        parsed.payload,
        currentMemberId,
        bootstrap.channels,
      );
      if (!conversationId) return;
      if (
        (resolvedSelected.type === "channel" && parsed.event !== SocketEventNames.dmMessage && resolvedSelected.id === conversationId) ||
        (resolvedSelected.type === "agent" && resolvedSelected.id === conversationId)
      ) {
        return;
      }

      incrementConversationUnreadCount(conversationId);
      if (parsed.event === SocketEventNames.approvalRequested) {
        const approvalId = parseApprovalId(parsed.payload);
        if (approvalId && !seenApprovalNotifications.current.has(approvalId)) {
          seenApprovalNotifications.current.add(approvalId);
          playApprovalSound();
        }
      }
    };

    return () => {
      source.close();
    };
  }, [bootstrap.auth.member?.id, bootstrap.channels, bootstrap.organization?.id, incrementConversationUnreadCount, resolvedSelected, setMemberActivity]);

  const handleSelect = useCallback(
    (conversation: SelectedConversation) => {
      const param =
        conversation.type === "agent"
          ? `agentId=${encodeURIComponent(conversation.id)}`
          : `channelId=${encodeURIComponent(conversation.id)}`;
      setSelectedConversation(conversation);
      router.replace(`/workspace?${param}`, { scroll: false });
    },
    [router, setSelectedConversation],
  );

  const handleCreateChannel = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return null;

      const orgId = bootstrap.organization?.id;
      if (!orgId) return null;

      const response = await fetch(
        `/api/orgs/${encodeURIComponent(orgId)}/channels`,
        {
          method: "POST",
          body: JSON.stringify({ name: trimmed }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          body &&
            typeof body === "object" &&
            "message" in body &&
            typeof body.message === "string"
            ? body.message
            : "Unable to create channel.",
        );
      }

      const channel = body as WorkspaceChannel;
      appendChannel(channel);
      return { type: "channel" as const, id: channel.id, name: channel.name };
    },
    [appendChannel, bootstrap.organization?.id],
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
      const trimmed = input.name.trim();
      if (!trimmed) return null;

      const orgId = bootstrap.organization?.id;
      if (!orgId) return null;

      const response = await fetch(
        `/api/orgs/${encodeURIComponent(orgId)}/members`,
        {
          method: "POST",
          body: JSON.stringify({
            name: trimmed,
            kind: "agent",
            roleName: input.roleName.trim() || trimmed,
            channelIds: input.channelIds,
            llm: input.llm,
            model: input.model,
            role: input.role,
          }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          body &&
            typeof body === "object" &&
            "message" in body &&
            typeof body.message === "string"
            ? body.message
            : "Unable to create agent.",
        );
      }

      const member = body as WorkspaceMember;
      appendMember(member);
      setTeamSettingsState((current) =>
        current
          ? {
              ...current,
              agents: [
                ...current.agents.filter((agent) => agent.name !== member.id),
                {
                  name: member.id,
                  roleName: input.roleName.trim() || member.roleName,
                  personalityName: input.role.personalityName ?? "direct",
                  kind: "agent",
                },
              ],
              roles: [
                ...current.roles.filter((role) => role.name !== input.role.name),
                normalizeWorkspaceTeamRole(input.role),
              ],
            }
          : current,
      );
      return { type: "agent" as const, id: member.id, name: member.name };
    },
    [appendMember, bootstrap.organization?.id],
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
      const orgId = bootstrap.organization?.id;
      if (!orgId) return null;

      const response = await fetch(
        `/api/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(input.memberId)}`,
        {
          method: "PATCH",
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
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          body &&
            typeof body === "object" &&
            "message" in body &&
            typeof body.message === "string"
            ? body.message
            : "Unable to update agent.",
        );
      }

      const member = body as WorkspaceMember;
      appendMember(member);
      setTeamSettingsState((current) =>
        current
          ? (() => {
              const nextAgents = [
                ...current.agents.filter((agent) => agent.name !== input.previousAgentId),
                {
                  name: member.id,
                  roleName: input.roleName,
                  personalityName: input.personalityName,
                  kind: "agent",
                },
              ];
              const previousRoleStillUsed = nextAgents.some(
                (agent) =>
                  agent.name !== member.id &&
                  agent.roleName === input.previousRoleName,
              );
              const roles = [
                ...current.roles.filter((role) => {
                  if (role.name === input.roleName) return false;
                  if (
                    role.name === input.previousRoleName &&
                    input.previousRoleName !== input.roleName &&
                    !previousRoleStillUsed
                  ) {
                    return false;
                  }
                  return true;
                }),
                normalizeWorkspaceTeamRole(input.role),
              ];
              return {
                ...current,
                agents: nextAgents,
                roles,
              };
            })()
          : current,
      );
      return member;
    },
    [appendMember, bootstrap.organization?.id],
  );

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50 transition-colors duration-200 dark:bg-[#040712]">
      <div
        style={{ width: `${sidebarWidth}%`, minWidth: 220, maxWidth: "40%" }}
        className={`shrink-0 h-full overflow-hidden ${WORKSPACE_PANEL_WIDTH_TRANSITION}`}
      >
        <WorkspaceSidebar
          bootstrap={bootstrap}
          rolePresets={rolePresets}
          teamSettings={teamSettingsState}
          currentWorkspaceRoot={
            teamSettingsState?.workspace?.root ?? bootstrap.team?.workspaceRoot
          }
          agentEditorTargetId={agentEditorTargetId}
          onAgentEditorHandled={() => setAgentEditorTargetId(null)}
          channels={channels}
          members={members}
          memberActivity={memberActivity}
          conversationUnreadCounts={conversationUnreadCounts}
          selected={resolvedSelected}
          onSelect={handleSelect}
          onCreateChannel={handleCreateChannel}
          onCreateAgent={handleCreateAgent}
          onUpdateAgent={handleUpdateAgent}
        />
      </div>
      <DragHandle onResize={setSidebarWidth} />
      <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <ChannelView
          key={`${resolvedSelected.type}:${resolvedSelected.id}`}
          bootstrap={bootstrap}
          conversation={resolvedSelected}
          members={members}
          onOpenAgentEditor={() => {
            if (resolvedSelected.type === "agent") {
              setAgentEditorTargetId(resolvedSelected.id);
            }
          }}
        />
      </main>
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
  const run = (payload as { run?: { agentId?: string; status?: string } })?.run;
  if (typeof run?.agentId !== "string" || typeof run.status !== "string") return;
  if (run.status === "failed" || run.status === "cancelled") {
    setMemberActivity(run.agentId, "error");
  } else if (run.status === "completed") {
    setMemberActivity(run.agentId, "online");
  } else {
    setMemberActivity(run.agentId, "working");
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
    const body = payload as { threadId?: string };
    return typeof body.threadId === "string" && channels.some((channel) => channel.id === body.threadId)
      ? body.threadId
      : undefined;
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
  const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
    // Ignore audio failures in browsers that block autoplay or AudioContext.
  }
}

export function DragHandle({
  onResize,
  side = "left",
  className = "",
}: {
  onResize: (percent: number) => void;
  side?: "left" | "right";
  className?: string;
}) {
  const handleRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const container = handleRef.current?.parentElement;
      if (!container) return;

      const onMouseMove = (e: MouseEvent) => {
        if (!isDragging.current || !container) return;
        const rect = container.getBoundingClientRect();
        const containerWidth = rect.width;
        const relativeX = e.clientX - rect.left;

        if (side === "left") {
          const percent = (relativeX / containerWidth) * 100;
          onResize(Math.min(Math.max(percent, 15), 40));
        } else {
          const rightPercent =
            ((containerWidth - relativeX) / containerWidth) * 100;
          onResize(Math.min(Math.max(rightPercent, 33), 45));
        }
      };

      const onMouseUp = () => {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [onResize, side],
  );

  return (
    <div
      ref={handleRef}
      onMouseDown={onMouseDown}
      className={`group relative flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-zinc-200 transition-colors hover:bg-violet-500/40 dark:bg-zinc-800 dark:hover:bg-violet-500/30 ${className}`}
    >
      <div className="pointer-events-none absolute z-50 flex h-8 w-5 items-center justify-center rounded-full border border-zinc-300 bg-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 dark:border-zinc-600 dark:bg-zinc-800">
        <GripVertical className="h-3.5 w-3.5 text-zinc-400 group-hover:text-violet-500" />
      </div>
    </div>
  );
}
