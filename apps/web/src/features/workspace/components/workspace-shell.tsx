"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { GripVertical } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { ChannelView } from "./channel-view";
import type { BootstrapResponse } from "@ujima/api-schema";
import type { SelectedConversation, WorkspaceRoleInput } from "../types";
import { resolveSelectedConversationFromSearchParams } from "../conversation-routing";
import { sameConversation, useWorkspaceStore } from "../workspace-store";

import type { RolePresetTemplate } from "../../onboarding/types";

type WorkspaceChannel = BootstrapResponse["channels"][number];
type WorkspaceMember = BootstrapResponse["members"][number];

export function WorkspaceShell({
  bootstrap,
  rolePresets,
  initialConversation,
}: {
  bootstrap: BootstrapResponse;
  rolePresets: RolePresetTemplate[];
  initialConversation?: SelectedConversation;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sidebarWidth = useWorkspaceStore((state) => state.sidebarWidth);
  const selected = useWorkspaceStore((state) => state.selectedConversation);
  const channels = useWorkspaceStore((state) => state.channels);
  const members = useWorkspaceStore((state) => state.members);
  const memberActivity = useWorkspaceStore((state) => state.memberActivity);
  const setSidebarWidth = useWorkspaceStore((state) => state.setSidebarWidth);
  const syncWorkspace = useWorkspaceStore((state) => state.syncWorkspace);
  const setSelectedConversation = useWorkspaceStore((state) => state.setSelectedConversation);
  const appendChannel = useWorkspaceStore((state) => state.appendChannel);
  const appendMember = useWorkspaceStore((state) => state.appendMember);

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
      selectedConversation: initialConversation ?? defaultConversation,
    });
  }, [bootstrap.channels, bootstrap.members, defaultConversation, initialConversation, syncWorkspace]);

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
    if (!sameConversation(selected, urlConversation)) {
      setSelectedConversation(urlConversation);
    }
  }, [selected, setSelectedConversation, urlConversation]);

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
      return { type: "agent" as const, id: member.id, name: member.name };
    },
    [appendMember, bootstrap.organization?.id],
  );

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50 dark:bg-[#040712]">
      <div
        style={{ width: `${sidebarWidth}%`, minWidth: 220, maxWidth: "40%" }}
        className="shrink-0 h-full"
      >
        <WorkspaceSidebar
          bootstrap={bootstrap}
          rolePresets={rolePresets}
          channels={channels}
          members={members}
          memberActivity={memberActivity}
          selected={resolvedSelected}
          onSelect={handleSelect}
          onCreateChannel={handleCreateChannel}
          onCreateAgent={handleCreateAgent}
        />
      </div>
      <DragHandle onResize={setSidebarWidth} />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden h-full">
        <ChannelView
          key={`${resolvedSelected.type}:${resolvedSelected.id}`}
          bootstrap={bootstrap}
          conversation={resolvedSelected}
          members={members}
        />
      </main>
    </div>
  );
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
          onResize(Math.min(Math.max(rightPercent, 15), 45));
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
