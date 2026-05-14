"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { SocketEventNames, type SocketEventName } from "@ujima/shared/browser";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { ChannelView } from "./channel-view";
import type { BootstrapResponse } from "@ujima/api-schema";
import type { SelectedConversation, WorkspaceRoleInput } from "../types";
import { useWorkspaceStore } from "../workspace-store";
import type { RolePresetTemplate } from "../../onboarding/types";

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
  agents: Array<{ name: string; roleName: string; personalityName: string; kind: string }>;
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

  const resolvedSelected = selected ?? defaultConversation;

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
      conversationUnreadCounts,
      selectedConversation: resolvedSelected,
    });
  }, [
    bootstrap.channels,
    bootstrap.members,
    conversationUnreadCounts,
    resolvedSelected,
    syncWorkspace,
  ]);

  const wsRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    if (!organizationId) return;
    if (wsRef.current) return;

    const baseUrl = process.env.NEXT_PUBLIC_UJIMA_API_URL ?? `http://127.0.0.1:7511`;
    const socketUrl = baseUrl.replace(/^http/, "ws");
    const wsUrl = `${socketUrl}/api/events?organization_id=${organizationId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const envelope = parseNotificationEnvelope(event.data);
      if (!envelope) return;
      if (envelope.type === "socket" && isNotificationMessageEvent(envelope.event)) {
        if (resolvedSelected.type === "channel") {
          const payload = envelope.payload as { channelId?: string };
          if (payload?.channelId && payload.channelId !== resolvedSelected.id) {
            incrementConversationUnreadCount(payload.channelId, 1);
          }
        }
      }
      if (envelope.type === "socket" && isNotificationRunEvent(envelope.event)) {
        updateRunActivity(envelope.payload, setMemberActivity);
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [incrementConversationUnreadCount, organizationId, resolvedSelected.id, resolvedSelected.type, setMemberActivity]);

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
      const startX = event.clientX;
      const startPct = parseFloat(
        getComputedStyle(event.currentTarget.parentElement!).width,
      );
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (e: PointerEvent) => {
        if (!dragging.current) return;
        const parent = (event.currentTarget as HTMLElement).parentElement!;
        const parentWidth = parent.parentElement!.getBoundingClientRect().width;
        const dx = e.clientX - startX;
        const pct = Math.max(15, Math.min(50, startPct + (dx / parentWidth) * 100));
        onResize(pct);
      };

      const onUp = () => {
        dragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [onResize],
  );

  return (
    <div
      className="relative w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-violet-500/20 transition-colors group"
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
  const run = (payload as { run?: { agentId?: string; status?: string } })?.run;
  if (!run?.agentId) return;
  if (run.status === "running") {
    setMemberActivity(run.agentId, "working");
  } else if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    setMemberActivity(run.agentId, "idle");
  }
}
